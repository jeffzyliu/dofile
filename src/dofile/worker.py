"""One Stata session per child process, so a hang or crash only loses that session.

Worker: talks to one child over a pipe. On timeout or cancel the child is interrupted like Stata's Break
key: the call ends with rc 1 and the session keeps its data. If the child does not stop within GRACE
seconds, or it died, it is killed and the call returns rc 9998 ("session reset"); the next call starts a
fresh one.
WorkerPool: one Worker per session key (a start_session token), with idle reaping and a size cap.
"""
from __future__ import annotations

import itertools
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

from .engine import BREAK, LOG_KEEP, RC_BREAK, Result

RC_RESET = 9998
GRACE = 5.0  # seconds an interrupted call gets to stop before the child is killed
SNAPSHOT_MAX = 5000  # entries in the working folder above which run results leave `files` empty
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
    eng = Engine(workdir, log_keep=LOG_KEEP, hints=False)  # bounded log; no console hints for agents
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
        self._active = None  # the call running now (its threading.Event)
        self.closed = False  # close() was called: no new child may start (its workdir may be gone)

    def _start(self) -> None:
        parent, child = _ctx.Pipe()
        proc = _ctx.Process(target=_serve, args=(child, self.workdir, self.read_dirs, self.sandbox), daemon=True)
        try:
            proc.start()
        except BaseException:
            parent.close()
            raise
        finally:
            child.close()
        self._proc, self._conn = proc, parent  # only once started: _kill() needs a started process

    def _kill(self) -> None:
        if self._proc is not None:
            self._proc.kill()
            self._proc.join(5)
            self._conn.close()
        self._proc = self._conn = None

    def interrupt(self, call: threading.Event) -> None:
        """Stop `call` (from any thread): interrupt it if it is running, skip it if it has not started.
        The flag lives on the call itself, so a call that never runs leaves nothing behind."""
        call.set()
        if self._active is call:
            self._signal()

    def _signal(self) -> None:
        if self._proc is not None and self._proc.pid and sys.platform != "win32":
            try:
                os.kill(self._proc.pid, signal.SIGINT)
            except ProcessLookupError:
                pass
        # shortcut: Windows has no SIGINT for a child process, so an interrupt there waits for GRACE and kills

    def _call(self, op: str, *args: Any, timeout: float | None = None, call: threading.Event | None = None) -> Any:
        with self._lock:
            before = _snapshot(self.workdir) if op == "run" else None
            result = self._call_locked(op, args, timeout, call)
            if before is not None and isinstance(result, Result):
                result.files = _changes(before, _snapshot(self.workdir))
            return result

    def _call_locked(self, op: str, args: tuple, timeout: float | None, call: threading.Event | None) -> Any:
        self.last_used = time.monotonic()
        if self.closed:
            return _reset("the session was closed")
        if call is not None and call.is_set():  # cancelled while waiting for the lock
            return _broken("the call was cancelled before it started")
        if self._proc is not None and not self._proc.is_alive():
            self._kill()
            return _reset("the session process exited")
        if self._proc is None:
            try:
                self._start()
            except Exception as e:  # noqa: BLE001 - e.g. no processes left; the next call tries again
                return _reset(f"the session process could not start ({type(e).__name__}: {e})")
        limit = timeout or self.timeout
        self._active = call
        try:
            self._conn.send((op, args))
            deadline, why = time.monotonic() + limit, None
            while not self._conn.poll(_POLL):
                now = time.monotonic()
                cancelled = call is not None and call.is_set()
                if why is None and (now >= deadline or cancelled):
                    why = "was cancelled" if cancelled else f"did not finish within {limit:g} seconds"
                    self._signal()
                    deadline = now + GRACE
                elif why is not None and now >= deadline:
                    self._kill()
                    return _reset(f"the command {why} and did not stop when interrupted")
            result = self._conn.recv()
            if why is None and call is not None and call.is_set():  # interrupt() signalled before the loop saw it
                why = "was cancelled"
            if why and isinstance(result, Result) and result.rc == RC_BREAK and result.error == BREAK:
                result.error = f"{BREAK} (the command {why}; the session keeps its data)"
            return result
        except (EOFError, OSError, BrokenPipeError):
            self._kill()
            return _reset("the session process crashed")
        finally:
            self._active = None

    def run(self, code: str, timeout: float | None = None, images: bool = False,
            call: threading.Event | None = None) -> Result:
        """`call`: an Event identifying this call, for interrupt()."""
        return self._call("run", code, images, timeout=timeout, call=call)

    def data_summary(self, vars: str | None = None, offset: int = 0, limit: int | None = None) -> dict | Result:
        return self._call("data", vars, offset, limit)

    def matrix(self, name: str, rows: list[str] | None = None, cols: list[str] | None = None,
               max_cells: int | None = None) -> dict | Result:
        return self._call("matrix", name, rows, cols, max_cells)

    @property
    def busy(self) -> bool:
        return self._lock.locked()

    def stop(self) -> None:
        """End the child after any running call; the next call starts a fresh one (stdio's reset)."""
        with self._lock:
            self._kill()

    def close(self) -> None:
        """For good: later calls return rc 9998 instead of starting a child in a deleted workdir."""
        self.closed = True
        self.stop()
        if self.owns_workdir:
            shutil.rmtree(self.workdir, ignore_errors=True)


def _snapshot(workdir: str) -> dict[str, tuple[int, int]]:
    """Top-level files -> (mtime in ns, size); folders (such as the hidden .dofile/) are not listed.
    Empty for a folder with more than SNAPSHOT_MAX entries (stdio uses the launch folder, which can be a home
    folder): two scans per call would cost more than the file list is worth."""
    out = {}
    try:
        entries = list(itertools.islice(os.scandir(workdir), SNAPSHOT_MAX + 1))
    except FileNotFoundError:  # a closed session's temp workdir
        return out
    if len(entries) > SNAPSHOT_MAX:
        return out
    for e in entries:
        try:
            if e.is_file():
                st = e.stat()
                out[e.name] = (st.st_mtime_ns, st.st_size)
        except FileNotFoundError:  # gone meanwhile, e.g. a temporary file renamed by `save`
            pass
    return out


def _changes(before: dict, after: dict) -> list[dict[str, Any]]:
    return [{"name": n, "status": "modified" if n in before else "created", "bytes": after[n][1]}
            for n in sorted(after) if before.get(n) != after[n]]


def _broken(reason: str) -> Result:
    return Result(log=f"{BREAK}\nr({RC_BREAK});\n", rc=RC_BREAK, error=f"{BREAK} ({reason})")


def _reset(reason: str) -> Result:
    msg = f"session reset: {reason}; data, macros and results in memory were lost"
    return Result(log=f"{msg}\nr({RC_RESET});\n", rc=RC_RESET, error=msg)


class PoolFull(RuntimeError):
    """Every session slot is running code, so none can be evicted for a new one."""


class WorkerPool:
    """Workers keyed by session id. Each new session gets a fresh temp workdir unless `factory` says otherwise."""

    def __init__(self, factory: Callable[[], Worker] | None = None, *, max_workers: int = 8,
                 idle_seconds: float = 900.0, **worker_kw: Any):
        self.factory = factory or (lambda: Worker(tempfile.mkdtemp(prefix="dofile-"), owns_workdir=True, **worker_kw))
        self.max_workers = max_workers
        self.idle_seconds = idle_seconds
        self._workers: OrderedDict[str, Worker] = OrderedDict()
        self._lock = threading.Lock()

    # Workers are removed under the pool lock but closed after releasing it: close() waits for a running call,
    # and holding the pool lock meanwhile would stall every other session.

    def get(self, key: str) -> Worker:
        with self._lock:
            gone = self._reap_locked()
            w = self._workers.get(key)
            if w is None:
                while len(self._workers) >= self.max_workers:
                    # evict the least recently used session that isn't running code; never kill a running call
                    idle = next((k for k, v in self._workers.items() if not v.busy), None)
                    if idle is None:
                        break
                    gone.append(self._workers.pop(idle))
                if len(self._workers) < self.max_workers:
                    w = self._workers[key] = self.factory()
            if w is not None:
                self._workers.move_to_end(key)
        _close_all(gone)
        if w is None:
            raise PoolFull(f"all {self.max_workers} sessions are running code")
        return w

    def find(self, key: str) -> Worker | None:
        """The live worker for `key`, or None if it never existed or was reaped/evicted."""
        with self._lock:
            gone = self._reap_locked()
            w = self._workers.get(key)
            if w is not None:
                self._workers.move_to_end(key)
        _close_all(gone)
        return w

    def reap(self) -> None:
        with self._lock:
            gone = self._reap_locked()
        _close_all(gone)

    def _reap_locked(self) -> list[Worker]:
        """Remove idle workers and return them for closing. A worker running a call is not idle, however long
        ago the call started (a --timeout above idle_seconds)."""
        now = time.monotonic()
        idle = [k for k, w in self._workers.items() if now - w.last_used > self.idle_seconds and not w.busy]
        return [self._workers.pop(k) for k in idle]

    def close(self, key: str | None = None) -> None:
        with self._lock:
            keys = [key] if key is not None else list(self._workers)
            gone = [self._workers.pop(k) for k in keys if k in self._workers]
        _close_all(gone)

    def __len__(self) -> int:
        return len(self._workers)


def _close_all(workers: list[Worker]) -> None:
    for w in workers:
        w.close()
