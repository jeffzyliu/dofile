import os
import shutil
import time
from pathlib import Path

import pytest

from dofile.worker import RC_RESET, Worker, WorkerPool

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
    assert r.rc == 0 and r.results["e"]["N"] == 1000
    assert worker.data_summary()["nobs"] == 1000


def test_timeout_resets_the_session(worker):
    worker.run("use panel, clear")
    r = worker.run("while 1 {\n}", timeout=2)
    assert r.rc == RC_RESET and "did not finish within 2 seconds" in r.error
    after = worker.run("count")  # a fresh session: the data is gone, but it works
    assert after.rc == 0 and after.results["r"]["N"] == 0


def test_dead_process_is_reported_then_restarted(worker):
    worker.run("display 1")
    os.kill(worker._proc.pid, 9)
    worker._proc.join(5)
    r = worker.run("display 2")
    assert r.rc == RC_RESET and "exited" in r.error
    assert worker.run("display 3").rc == 0


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
        assert b.run("count").results["r"]["N"] == 0  # b does not see a's data
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
