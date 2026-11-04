"""One Stata session per child process, so a hang or crash only loses that session.

Worker: talks to one child over a pipe. Each call has a timeout; on timeout or if the child died,
the child is killed and the call returns rc 9998 ("session reset"). The next call starts a fresh one.
WorkerPool: one Worker per session key (MCP session id), with idle reaping and a size cap.
"""
from __future__ import annotations

import multiprocessing as mp
import shutil
import tempfile
import threading
import time
from collections import OrderedDict
from pathlib import Path
from typing import Any, Callable

from .engine import Result

RC_RESET = 9998
_ctx = mp.get_context("spawn")  # a clean interpreter: no state or audit hooks inherited from the parent


def _serve(conn, workdir: str, read_dirs: tuple[str, ...], sandboxed: bool) -> None:
    """Child process: optionally confine itself, then answer requests until the pipe closes."""
    if sandboxed:
        from . import sandbox
        sandbox.install(workdir, read_dirs)
    from .engine import Engine
    eng = Engine(workdir)
    while True:
        try:
            op, args = conn.recv()
        except EOFError:
            return
        if op == "run":
            conn.send(eng.run(*args))
        elif op == "data":
            conn.send(eng.data_summary())


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

    def _call(self, op: str, *args: Any, timeout: float | None = None) -> Any:
        with self._lock:
            self.last_used = time.monotonic()
            if self._proc is not None and not self._proc.is_alive():
                self._kill()
                return _reset("the session process exited")
            if self._proc is None:
                self._start()
            try:
                self._conn.send((op, args))
                if not self._conn.poll(timeout or self.timeout):
                    self._kill()
                    return _reset(f"the command did not finish within {timeout or self.timeout:g} seconds")
                return self._conn.recv()
            except (EOFError, OSError, BrokenPipeError):
                self._kill()
                return _reset("the session process crashed")

    def run(self, code: str, timeout: float | None = None) -> Result:
        return self._call("run", code, timeout=timeout)

    def data_summary(self) -> dict | Result:
        return self._call("data")

    def close(self) -> None:
        with self._lock:
            self._kill()
        if self.owns_workdir:
            shutil.rmtree(self.workdir, ignore_errors=True)


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
