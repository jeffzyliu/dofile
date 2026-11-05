import multiprocessing
import os
import shutil
import sys
import threading
import time
from pathlib import Path

import pytest

from dofile.worker import GRACE, RC_RESET, PoolFull, Worker, WorkerPool

PANEL = Path(__file__).parent / "conformance" / "data" / "panel.dta"


@pytest.fixture
def worker(tmp_path):
    shutil.copy(PANEL, tmp_path)
    w = Worker(tmp_path, timeout=30)
    yield w
    w.close()


def test_state_persists_between_calls(worker):
    assert worker.run("use panel, clear").rc == 0
    r = worker.run("quietly regress y x1 x2")
    assert r.rc == 0 and r.results["e"]["scalars"]["N"] == 1000
    assert worker.data_summary()["nobs"] == 1000


def test_errors_have_no_console_hints(worker):
    # OpenDTA's "→ ... How to fix ... help" lines are for people; MCP sessions turn them off
    r = worker.run("nosuchcommand")
    assert r.rc == 199 and r.log == ". nosuchcommand\ncommand nosuchcommand is unrecognized\nr(199);\n"


def test_timeout_interrupts_and_keeps_the_data(worker):
    worker.run("use panel, clear")
    t = time.monotonic()
    r = worker.run("while 1 {\n}", timeout=2)
    assert r.rc == 1 and "did not finish within 2 seconds" in r.error and "keeps its data" in r.error
    assert "--Break--" in r.log and time.monotonic() - t < 2 + GRACE
    after = worker.run("count")  # same session: the data is still there
    assert after.rc == 0 and after.results["r"]["scalars"]["N"] == 1000


def test_code_that_ignores_the_interrupt_is_killed(worker, monkeypatch):
    worker.run("use panel, clear")
    monkeypatch.setattr(Worker, "_signal", lambda self: None)  # as if stuck in C code
    monkeypatch.setattr("dofile.worker.GRACE", 0.5)
    r = worker.run("while 1 {\n}", timeout=1)
    assert r.rc == RC_RESET and "did not stop when interrupted" in r.error
    assert worker.run("count").results["r"]["scalars"]["N"] == 0  # a fresh session


def test_cancel_interrupts_the_running_call_and_skips_waiting_ones(worker):
    import threading
    worker.run("use panel, clear")
    running, waiting, out = object(), object(), {}
    a = threading.Thread(target=lambda: out.update(a=worker.run("while 1 {\n}", call=running)))
    a.start()
    time.sleep(1)
    b = threading.Thread(target=lambda: out.update(b=worker.run("display 1", call=waiting)))
    b.start()  # waits for the lock
    worker.interrupt(waiting)
    worker.interrupt(running)
    a.join(GRACE + 5)
    b.join(5)
    assert out["a"].rc == 1 and "cancelled" in out["a"].error
    assert out["b"].rc == 1 and "before it started" in out["b"].error and "1" not in out["b"].log.split("--")[0]
    assert worker.run("count").results["r"]["scalars"]["N"] == 1000


def test_dead_process_is_reported_then_restarted(worker):
    worker.run("display 1")
    os.kill(worker._proc.pid, 9)
    worker._proc.join(5)
    r = worker.run("display 2")
    assert r.rc == RC_RESET and "exited" in r.error
    assert worker.run("display 3").rc == 0


def test_failed_start_is_reported_then_retried(tmp_path, monkeypatch):
    from dofile import worker as wmod
    real = wmod._ctx

    class FailFirstStart:  # the real context, except that the first process refuses to start
        failed = False

        def __getattr__(self, name):
            return getattr(real, name)

        def Process(self, *a, **kw):
            p = real.Process(*a, **kw)
            if not FailFirstStart.failed:
                FailFirstStart.failed = True

                def refuse():
                    raise OSError("no processes left")
                p.start = refuse
            return p
    monkeypatch.setattr(wmod, "_ctx", FailFirstStart())
    w = Worker(tmp_path, timeout=30)
    try:
        r = w.run("display 1")
        assert r.rc == RC_RESET and "could not start" in r.error and "no processes left" in r.error
        assert w.run("display 2").rc == 0  # not stuck: the next call starts a process
    finally:
        w.close()


def test_sandbox_is_on_by_default(worker):
    r = worker.run("shell echo hi")
    assert r.rc == 199 and "sandbox" in r.error


def test_unsandboxed_worker_allows_shell(tmp_path):
    w = Worker(tmp_path, sandbox=False, timeout=30)
    try:
        r = w.run("shell echo unsandboxed-ok")
        assert r.rc == 0 and "unsandboxed-ok" in r.log
    finally:
        w.close()


def test_pool_isolates_sessions_evicts_and_reaps():
    pool = WorkerPool(max_workers=2, idle_seconds=3600, timeout=30)
    try:
        a, b = pool.get("a"), pool.get("b")
        assert a.workdir != b.workdir and pool.get("a") is a
        a.run("clear\nset obs 3")
        assert b.run("count").results["r"]["scalars"]["N"] == 0  # b does not see a's data
        b_dir = b.workdir
        pool.get("a")  # a is now the most recently used
        pool.get("c")  # cap of 2: evicts b
        assert len(pool) == 2 and not os.path.exists(b_dir)  # b's temp workdir is deleted
        pool.idle_seconds = 0.01
        time.sleep(0.05)
        pool.reap()
        assert len(pool) == 0
    finally:
        pool.close()


def test_pool_neither_reaps_nor_waits_on_a_running_call():
    pool = WorkerPool(max_workers=4, idle_seconds=3600, timeout=30)
    try:
        a = pool.get("a")
        assert a.run("display 1").rc == 0  # process started
        long_call = threading.Thread(target=a.run, args=("sleep 2500",))
        long_call.start()
        time.sleep(0.5)
        pool.idle_seconds = 0.01  # by last_used, a now looks idle
        t = time.perf_counter()
        pool.get("b")  # reaps; must not wait for a's call
        assert time.perf_counter() - t < 1.0
        assert pool.find("a") is a  # a running call is not idle
        long_call.join()
        time.sleep(0.05)
        pool.reap()
        assert pool.find("a") is None  # idle once its call ended
    finally:
        pool.close()


def test_full_pool_evicts_only_idle_sessions_and_refuses_when_all_are_busy():
    pool = WorkerPool(max_workers=2, idle_seconds=3600, timeout=30)
    try:
        a, b = pool.get("a"), pool.get("b")  # a is the least recently used
        assert a.run("display 1").rc == 0 and b.run("display 1").rc == 0
        pool.get("b")
        busy_a = threading.Thread(target=a.run, args=("sleep 2000",))
        busy_a.start()
        time.sleep(0.5)
        pool.get("c")  # full: evicts idle b, not a (least recently used, but running code)
        assert pool.find("a") is a and pool.find("b") is None
        assert pool.get("c").run("display 1").rc == 0
        busy_c = threading.Thread(target=pool.find("c").run, args=("sleep 2000",))
        busy_c.start()
        time.sleep(0.5)
        with pytest.raises(PoolFull):  # every session is running code: refuse, evict nothing
            pool.get("d")
        assert pool.find("a") is a and pool.find("c") is not None
        busy_a.join()
        busy_c.join()
        pool.get("d")  # idle again: one is evicted
        assert len(pool) == 2
    finally:
        pool.close()


@pytest.mark.skipif(sys.platform == "win32", reason="Windows has only spawn")
def test_sessions_fork_from_a_preloaded_forkserver(tmp_path, monkeypatch):
    import subprocess
    from dofile import worker as wmod
    assert wmod._ctx.get_start_method() == "forkserver"
    # the forkserver silently skips preload modules that fail to import, so check it imports here
    p = subprocess.run([sys.executable, "-c", "import sys, dofile._forkserver; "
                        "assert 'dofile._vendor.opendta.commands' in sys.modules"], capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    wmod.warm_up()
    first = Worker(tmp_path, timeout=30)
    try:
        assert first.run("display 1").rc == 0  # waits for the forkserver if warm_up hasn't finished
    finally:
        first.close()

    def first_call_seconds(ctx):
        monkeypatch.setattr(wmod, "_ctx", ctx)
        w = Worker(tmp_path, timeout=60)
        try:
            t = time.perf_counter()
            assert w.run("display 1").rc == 0
            return time.perf_counter() - t
        finally:
            w.close()
    forked = first_call_seconds(wmod._ctx)
    spawned = first_call_seconds(multiprocessing.get_context("spawn"))
    # relative, not a fixed limit, so slow CI machines pass: here ~0.02 s vs ~0.7 s
    assert forked < spawned / 2, (forked, spawned)
