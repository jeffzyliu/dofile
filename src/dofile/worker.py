"""One Stata session per child process, so a hang or crash only loses that session.

Worker: talks to one child over a pipe. On timeout or cancel the child is interrupted like Stata's Break
key: the call ends with rc 1 and the session keeps its data. If the child does not stop within GRACE
seconds, or it died, it is killed and the call returns rc 9998 ("session reset"); the next call starts a
fresh one.
WorkerPool: one Worker per session key (MCP session id), with idle reaping and a size cap.
"""
from __future__ import annotations

import multiprocessing as mp
import os
import shutil
import signal
import sys
import tempfile
import threading
import time
from collections import OrderedDict
from pathlib import Path
from typing import Any, Callable

from .engine import Result

RC_RESET = 9998
GRACE = 5.0  # seconds an interrupted call gets to stop before the child is killed
_POLL = 0.1  # seconds between checks for a cancel while waiting for the child


def _context():
    """forkserver where it exists: a clean process (no server threads, tokens or sockets) that has loaded the
    engine once, so each session forks ready in ~20 ms instead of ~0.7 s. Windows has only spawn."""
    if "forkserver" not in mp.get_all_start_methods():
        return mp.get_context("spawn")
    ctx = mp.get_context("forkserver")
    # each child re-runs the parent's main module unless the forkserver has it: "__main__" covers a script,
    # the module name covers `python -m` (multiprocessing itself skips `*.__main__` names)
    main = getattr(getattr(sys.modules.get("__main__"), "__spec__", None), "name", None)
    by_name = [main] if main and not main.endswith("__main__") else []
    ctx.set_forkserver_preload(["__main__", *by_name, "dofile._forkserver"])
    return ctx


_ctx = _context()


def warm_up() -> None:
    """Start the forkserver in the background now, so the first session doesn't wait ~1 s for it."""
    if _ctx.get_start_method() == "forkserver":
        from multiprocessing import forkserver
        threading.Thread(target=forkserver.ensure_running, daemon=True).start()


def _serve(conn, workdir: str, read_dirs: tuple[str, ...], sandboxed: bool) -> None:
    """Child process: optionally confine itself, then answer requests until the pipe closes."""
    if sandboxed:
        from . import sandbox
        sandbox.install(workdir, read_dirs)
    from .engine import Engine
    eng = Engine(workdir)
    busy = False

    def on_interrupt(signum, frame):  # the parent's interrupt: only stop running code, never the loop
        if busy:
            raise KeyboardInterrupt
    signal.signal(signal.SIGINT, on_interrupt)
    while True:
        try:
            op, args = conn.recv()
        except EOFError:
            return
        if op == "run":
            try:
                busy = True
                result = eng.run(*args)
                busy = False
            except KeyboardInterrupt:  # arrived after the engine's own handler (building the result)
                busy = False
                result = eng.break_result()
            conn.send(result)
        elif op == "data":
            conn.send(eng.data_summary(*args))
        elif op == "matrix":
            conn.send(eng.matrix(*args))


class Worker:
    def __init__(self, workdir: str | Path, read_dirs: tuple[str, ...] = (), *, sandbox: bool = True,
                 timeout: float = 60.0, owns_workdir: bool = False):
        self.workdir = str(workdir)
        self.read_dirs = tuple(read_dirs)
        self.sandbox = sandbox
        self.timeout = timeout
        self.owns_workdir = owns_workdir  # delete the workdir on close (per-session temp dirs)
        self.last_used = time.monotonic()
        self._proc = None
        self._conn = None
        self._lock = threading.Lock()  # one call at a time per session
        self._active = None  # id of the call running now
        self._cancelled: set = set()  # ids of calls to stop (also ones still waiting for the lock)

    def _start(self) -> None:
        parent, child = _ctx.Pipe()
        self._proc = _ctx.Process(target=_serve, args=(child, self.workdir, self.read_dirs, self.sandbox), daemon=True)
        self._proc.start()
        child.close()
        self._conn = parent

    def _kill(self) -> None:
        if self._proc is not None:
            self._proc.kill()
            self._proc.join(5)
            self._conn.close()
        self._proc = self._conn = None

    def interrupt(self, call: object) -> None:
        """Stop call `call` (from any thread): interrupt it if it is running, or skip it if it is waiting."""
        self._cancelled.add(call)
        if self._active is call:
            self._signal()

    def _signal(self) -> None:
        if self._proc is not None and self._proc.pid and sys.platform != "win32":
            try:
                os.kill(self._proc.pid, signal.SIGINT)
            except ProcessLookupError:
                pass
        # shortcut: Windows has no SIGINT for a child process, so an interrupt there waits for GRACE and kills

    def _call(self, op: str, *args: Any, timeout: float | None = None, call: object = None) -> Any:
        with self._lock:
            self.last_used = time.monotonic()
            if call is not None and call in self._cancelled:  # cancelled while waiting for the lock
                self._cancelled.discard(call)
                return _broken("the call was cancelled before it started")
            if self._proc is not None and not self._proc.is_alive():
                self._kill()
                return _reset("the session process exited")
            if self._proc is None:
                self._start()
            limit = timeout or self.timeout
            self._active = call
            try:
                self._conn.send((op, args))
                deadline, why = time.monotonic() + limit, None
                while not self._conn.poll(_POLL):
                    now = time.monotonic()
                    if why is None and (now >= deadline or call in self._cancelled):
                        why = "was cancelled" if call in self._cancelled else f"did not finish within {limit:g} seconds"
                        self._signal()
                        deadline = now + GRACE
                    elif why is not None and now >= deadline:
                        self._kill()
                        return _reset(f"the command {why} and did not stop when interrupted")
                result = self._conn.recv()
                if why is None and call in self._cancelled:  # interrupt() signalled before the loop saw it
                    why = "was cancelled"
                if why and isinstance(result, Result) and result.rc == 1 and result.error == "--Break--":
                    result.error = f"--Break-- (the command {why}; the session keeps its data)"
                return result
            except (EOFError, OSError, BrokenPipeError):
                self._kill()
                return _reset("the session process crashed")
            finally:
                self._active = None
                self._cancelled.discard(call)

    def run(self, code: str, timeout: float | None = None, images: bool = False, call: object = None) -> Result:
        """`call`: any object identifying this call, for interrupt()."""
        return self._call("run", code, images, timeout=timeout, call=call)

    def data_summary(self, vars: str | None = None, offset: int = 0, limit: int | None = None) -> dict | Result:
        return self._call("data", vars, offset, limit)

    def matrix(self, name: str, rows: list[str] | None = None, cols: list[str] | None = None) -> dict | Result:
        return self._call("matrix", name, rows, cols)

    def close(self) -> None:
        with self._lock:
            self._kill()
        if self.owns_workdir:
            shutil.rmtree(self.workdir, ignore_errors=True)


def _broken(reason: str) -> Result:
    msg = f"--Break-- ({reason})"
    return Result(log="--Break--\nr(1);\n", rc=1, error=msg)


def _reset(reason: str) -> Result:
    msg = f"session reset: {reason}; data, macros and results in memory were lost"
    return Result(log=f"{msg}\nr({RC_RESET});\n", rc=RC_RESET, error=msg)


class WorkerPool:
    """Workers keyed by session id. Each new session gets a fresh temp workdir unless `factory` says otherwise."""

    def __init__(self, factory: Callable[[], Worker] | None = None, *, max_workers: int = 8,
                 idle_seconds: float = 900.0, **worker_kw: Any):
        self.factory = factory or (lambda: Worker(tempfile.mkdtemp(prefix="dofile-"), owns_workdir=True, **worker_kw))
        self.max_workers = max_workers
        self.idle_seconds = idle_seconds
        self._workers: OrderedDict[str, Worker] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: str) -> Worker:
        with self._lock:
            self._reap_locked()
            w = self._workers.get(key)
            if w is None:
                while len(self._workers) >= self.max_workers:  # evict the least recently used session
                    self._workers.popitem(last=False)[1].close()
                w = self._workers[key] = self.factory()
            self._workers.move_to_end(key)
            return w

    def find(self, key: str) -> Worker | None:
        """The live worker for `key`, or None if it never existed or was reaped/evicted."""
        with self._lock:
            self._reap_locked()
            w = self._workers.get(key)
            if w is not None:
                self._workers.move_to_end(key)
            return w

    def reap(self) -> None:
        with self._lock:
            self._reap_locked()

    def _reap_locked(self) -> None:
        now = time.monotonic()
        for key in [k for k, w in self._workers.items() if now - w.last_used > self.idle_seconds]:
            self._workers.pop(key).close()

    def close(self, key: str | None = None) -> None:
        with self._lock:
            keys = [key] if key is not None else list(self._workers)
            for k in keys:
                if k in self._workers:
                    self._workers.pop(k).close()

    def __len__(self) -> int:
        return len(self._workers)
