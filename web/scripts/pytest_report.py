"""Run pytest and write one outcome per test to a JSON file. The same file runs on CPython (the baseline) and inside
Pyodide (web/scripts/check-pytest.mjs), so the two can be compared test by test.

    python pytest_report.py OUT.json [pytest args ...]

OUT.json: {"exit": int, "tests": {nodeid: {"outcome": passed|failed|skipped|xfailed|xpassed, "s": seconds, "why": text}}}
A failure in setup or teardown is "failed" with "why" starting "setup:" or "teardown:". A collection error is recorded
under the module's id as "failed" with "why" starting "collect:".
"""

import json
import sys

sys.dont_write_bytecode = True  # the Pyodide runs mount the repo's test folders: leave no .pyc behind

import pytest  # noqa: E402


class Report:
    def __init__(self):
        self.tests = {}

    def _entry(self, nodeid):
        return self.tests.setdefault(nodeid, {"outcome": "passed", "s": 0.0, "why": ""})

    def pytest_runtest_logreport(self, report):
        e = self._entry(report.nodeid)
        e["s"] = round(e["s"] + report.duration, 3)
        if report.failed:
            msg = getattr(getattr(report.longrepr, "reprcrash", None), "message", None) or str(report.longrepr)[-300:]
            e["outcome"] = "failed"
            e["why"] = (("" if report.when == "call" else report.when + ": ") + msg)[:400]
        elif report.skipped and e["outcome"] != "failed":
            e["outcome"] = "xfailed" if hasattr(report, "wasxfail") else "skipped"
            if e["outcome"] == "skipped" and isinstance(report.longrepr, tuple):
                e["why"] = str(report.longrepr[2])[:200]
        elif report.passed and report.when == "call" and hasattr(report, "wasxfail"):
            e["outcome"] = "xpassed"

    def pytest_collectreport(self, report):
        if report.failed:
            e = self._entry(report.nodeid)
            e["outcome"] = "failed"
            e["why"] = (
                "collect: "
                + (
                    getattr(getattr(report.longrepr, "reprcrash", None), "message", None) or str(report.longrepr)[-300:]
                )[:400]
            )


# The repo's pyproject.toml deselects these (OpenDTA tests that import the Qt GUI, which is not vendored). The Pyodide
# runs have no pyproject, and the baseline passes -o addopts= too, so both sides get the same selection from here.
DESELECT = [
    f"--deselect=tests_opendta/tests/test_i18n.py::{t}"
    for t in ("test_dialog_commands", "test_dialog_commands_run", "test_graph_editor_edits")
]


def run(out, args):
    rep = Report()
    code = int(pytest.main(list(args) + DESELECT, plugins=[rep]))
    with open(out, "w") as f:
        json.dump({"exit": code, "tests": rep.tests}, f)
    return code


if __name__ == "__main__":
    sys.exit(run(sys.argv[1], sys.argv[2:]))
