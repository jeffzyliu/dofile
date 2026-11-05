"""Vendor OpenDTA (MIT) into dofile at a pinned commit.

Usage: python scripts/vendor_opendta.py [COMMIT]

- src/opendta -> src/dofile/_vendor/opendta, without the Qt GUI (gui/) and __main__.py.
  cli.py and updater.py stay: their only GUI imports are lazy (inside functions), and
  run_batch() / ssl_context() are used by compare.py and by webuse/copy.
- OpenDTA's own test suite and its Stata 14 reference logs -> tests_opendta/{tests,tools,compat},
  mirroring the upstream layout so their relative paths keep working.
- Imports of `opendta` (statements and "opendta.x" strings) are rewritten to dofile._vendor.opendta.
"""
from __future__ import annotations

import re
import shutil
import subprocess
import sys
import tempfile
from datetime import date
from pathlib import Path

REPO = "https://github.com/yaskepalhares/opendta.git"
COMMIT = "0c3f3a2d65654bc95b495f56a8e8b8fff4e02a57"
DROP = ["gui", "__main__.py"]
# tests that need the Qt GUI (imported at module level) cannot run without it
DROP_TESTS = ["test_gui.py", "test_settings_window.py", "test_rules.py"]
NEW = "dofile._vendor.opendta"
ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "src" / "dofile" / "_vendor"
TESTS = ROOT / "tests_opendta"
IGNORE = shutil.ignore_patterns("__pycache__", "*.pyc")

REWRITES = [
    (re.compile(r"""(["'])opendta\."""), rf"\1{NEW}."),                          # "opendta.x" strings
    (re.compile(r"^(\s*)import opendta\s*$", re.M), rf"\1import {NEW} as opendta"),  # bare import
    (re.compile(r"^(\s*)(from|import) opendta\b", re.M), rf"\1\2 {NEW}"),           # from opendta..., import opendta.x
]


def rewrite(tree: Path) -> int:
    count = 0
    for py in tree.rglob("*.py"):
        text = py.read_text(encoding="utf-8")
        for pat, repl in REWRITES:
            text, n = pat.subn(repl, text)
            count += n
        py.write_text(text, encoding="utf-8")
    return count


def leftovers(tree: Path) -> list[str]:
    """Module-level imports of the old name or of the dropped GUI (lazy ones inside functions are fine)."""
    bad = re.compile(r"^(from|import)\s+opendta\b|^from\s+\.+gui\b|^\s*(from|import)\s+opendta\b")
    return [f"{py.relative_to(tree)}:{i}: {line.strip()}"
            for py in tree.rglob("*.py")
            for i, line in enumerate(py.read_text(encoding="utf-8").splitlines(), 1)
            if bad.search(line)]


def main(commit: str = COMMIT) -> None:
    target = DEST / "opendta"
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "opendta"
        subprocess.run(["git", "clone", "-q", REPO, str(src)], check=True)
        subprocess.run(["git", "-C", str(src), "checkout", "-q", commit], check=True)
        for d in (target, TESTS):
            if d.exists():
                shutil.rmtree(d)
        shutil.copytree(src / "src" / "opendta", target, ignore=IGNORE)
        shutil.copy(src / "LICENSE", target / "LICENSE")
        shutil.copy(src / "packaging" / "THIRD_PARTY_NOTICES.md", target / "THIRD_PARTY_NOTICES.md")
        shutil.copy(src / "docs" / "clean-room-policy.md", target / "CLEAN_ROOM_POLICY.md")
        shutil.copytree(src / "tests", TESTS / "tests", ignore=IGNORE)
        (TESTS / "tools").mkdir()
        shutil.copy(src / "tools" / "compare.py", TESTS / "tools" / "compare.py")
        for part in ("do", "expected", "known_differences.txt", "gerar_esperados.do"):
            p = src / "compat" / part
            (shutil.copytree(p, TESTS / "compat" / part) if p.is_dir() else shutil.copy(p, TESTS / "compat" / part))
        shutil.copy(src / "LICENSE", TESTS / "LICENSE")

    for name in DROP:
        p = target / name
        shutil.rmtree(p) if p.is_dir() else p.unlink()
    for name in DROP_TESTS:
        (TESTS / "tests" / name).unlink()

    n_pkg, n_tests = rewrite(target), rewrite(TESTS)
    patches = sorted((ROOT / "scripts" / "patches").glob("*.patch"))  # dofile's own changes, kept small
    for patch in patches:  # before the import check, so a patch can't bring old imports back unnoticed
        if subprocess.run(["git", "apply", str(patch)], cwd=ROOT).returncode:
            sys.exit(f"{patch.name} does not apply to opendta@{commit[:7]}. The vendored copy is now UNPATCHED: "
                     f"update the patch and re-run, or `git checkout -- {target.relative_to(ROOT)} "
                     f"{TESTS.relative_to(ROOT)}` to restore the previous version.")
    left = leftovers(target) + leftovers(TESTS)
    if left:
        sys.exit("unvendorable imports remain:\n" + "\n".join(left))

    (DEST / "__init__.py").write_text('"""Third-party code vendored into dofile. Do not edit; re-run scripts/vendor_opendta.py (changes go in scripts/patches/)."""\n')
    stamp = (f"source: {REPO}\ncommit: {commit}\nvendored: {date.today()}\n"
             f"removed: {', '.join(DROP)}; tests removed: {', '.join(DROP_TESTS)}\n"
             f"imports rewritten: package {n_pkg}, tests {n_tests}\n"
             f"patches: {', '.join(p.name for p in patches) or 'none'}\n")
    (target / "VENDORED").write_text(stamp)
    (TESTS / "VENDORED").write_text(stamp)
    print(f"vendored opendta@{commit[:7]}: package -> {target.relative_to(ROOT)}, tests -> {TESTS.relative_to(ROOT)}\n{stamp}")


if __name__ == "__main__":
    main(*sys.argv[1:])
