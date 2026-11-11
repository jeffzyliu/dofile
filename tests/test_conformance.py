"""dofile's own conformance corpus (from docs/engine-evaluation.md), run through Engine.

Each corpus .do prints `CHECK name=value`; values must match ref.json (independent statsmodels /
linearmodels results) to 1e-6 relative. Known OpenDTA gaps are strict xfails, so a fix shows up; their IDs
(ODT-n, GAP-n) are in docs/opendta-issues.md.
"""

import json
import re
import shutil
from functools import cache
from pathlib import Path

import pytest

from dofile.engine import Engine

HERE = Path(__file__).parent / "conformance"
REF = json.loads((HERE / "data" / "ref.json").read_text())
CHECK = re.compile(r"^CHECK (\w+)=\s*(\S+)", re.MULTILINE)
KNOWN_GAPS = {
    "hdfe_b_x1": "GAP-1: reghdfe is a community command, not in OpenDTA",
}
CASES = [
    (f.name, k) for f in sorted((HERE / "corpus").glob("*.do")) for k in re.findall(r'"CHECK (\w+)=', f.read_text())
]


@cache
def run_corpus_file(name: str, workdir: str) -> dict[str, str]:
    eng = Engine(workdir)
    return dict(CHECK.findall(eng.run((HERE / "corpus" / name).read_text()).log))


@pytest.fixture(scope="module")
def workdir(tmp_path_factory):
    d = tmp_path_factory.mktemp("conformance")
    for f in (HERE / "data").glob("*.dta"):
        shutil.copy(f, d)
    return str(d)


@pytest.mark.parametrize("dofile,key", CASES, ids=[f"{f[:-3]}:{k}" for f, k in CASES])
def test_check_matches_reference(dofile, key, workdir, monkeypatch, request):
    if key in KNOWN_GAPS:
        request.applymarker(pytest.mark.xfail(strict=True, reason=KNOWN_GAPS[key]))
    monkeypatch.chdir(workdir)
    got = run_corpus_file(dofile, workdir)
    assert key in got, f"{key} not printed (command failed earlier in {dofile})"
    x, ref = float(got[key]), REF[key]
    assert abs(x - ref) <= max(1e-6 * abs(ref), 1e-12), f"{key}: {x} vs reference {ref}"


PROBE_GAPS = {
    "p06_esttab.do": "GAP-1: esttab (community command)",
    "p07_outreg2.do": "GAP-1: outreg2 (community command)",
}
PROBES = sorted(p.name for p in (HERE / "probe").glob("*.do"))


@pytest.mark.parametrize("probe", PROBES, ids=[p[:-3] for p in PROBES])
def test_probe_runs(probe, workdir, monkeypatch, request):
    if probe in PROBE_GAPS:
        request.applymarker(pytest.mark.xfail(strict=True, reason=PROBE_GAPS[probe]))
    monkeypatch.chdir(workdir)
    r = Engine(workdir).run((HERE / "probe" / probe).read_text())
    assert r.rc == 0, r.error
