"""The web demo's sample dataset, web/sample/data/wages.dta, is what web/sample/make_sample.py makes (its `--check`).

The script draws the data with a fixed seed and writes the file with dofile's own engine and a fixed header time, so
the bytes repeat. A change to the engine's .dta writer or a numpy that draws otherwise fails here: then run
`uv run python web/sample/make_sample.py` and `npm run sample` in web/, and check the landing page's sample output
(web/test/sample-run.test.ts).
"""

import importlib.util
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parent.parent / "web" / "sample" / "make_sample.py"


def _script():
    if not SCRIPT.exists():  # not in an sdist: the web demo's folder is left out of it (pyproject.toml)
        pytest.skip("web/sample/make_sample.py is not in this checkout")
    spec = importlib.util.spec_from_file_location("make_sample", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_committed_sample_data_is_what_the_script_makes(tmp_path):
    script = _script()
    assert script.build(tmp_path) == script.OUT.read_bytes(), "run `uv run python web/sample/make_sample.py`"


def test_two_builds_make_the_same_bytes(tmp_path):
    script = _script()
    (tmp_path / "a").mkdir()
    (tmp_path / "b").mkdir()
    assert script.build(tmp_path / "a") == script.build(tmp_path / "b")
