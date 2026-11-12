"""Regenerate the sample project's dataset, data/wages.dta (docs/prototype1-plan.md, step 5).

The data are synthetic: drawn here from numpy's PCG64 generator with a fixed seed, so the same file comes out every time.
No real person's record, no dataset of Stata's. The engine itself writes the .dta (import delimited, label, save), so
the file is in the format the page reads.

    uv run python web/sample/make_sample.py          # from the repository root; rewrites web/sample/data/wages.dta
    uv run python web/sample/make_sample.py --check  # exit 1 if the committed file differs from what this makes

Afterwards run `npm run sample` in web/ to refresh src/app/sample-files.ts, which the page loads.
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

import numpy as np

from dofile.engine import Engine

SEED = 2026
N = 500
OUT = Path(__file__).resolve().parent / "data" / "wages.dta"

REGIONS = {1: "North", 2: "East", 3: "South", 4: "West"}
REGION_SHIFT = {1: 0.0, 2: 0.6, 3: -0.4, 4: 1.1}


def draw() -> str:
    """The rows, as CSV text."""
    rng = np.random.default_rng(SEED)
    age = rng.integers(22, 65, N)
    educ = rng.integers(10, 21, N)
    female = rng.integers(0, 2, N)
    region = rng.integers(1, 5, N)
    shift = np.array([REGION_SHIFT[int(r)] for r in region])
    wage = 4.0 + 0.11 * age + 0.85 * educ - 1.1 * female + shift + rng.normal(0, 2.8, N)
    wage = np.round(np.maximum(wage, 4.0), 2)
    rows = ["id,age,educ,female,region,wage"]
    rows += [f"{i + 1},{age[i]},{educ[i]},{female[i]},{region[i]},{wage[i]:.2f}" for i in range(N)]
    return "\n".join(rows) + "\n"


def build(folder: Path) -> bytes:
    (folder / "wages.csv").write_text(draw())
    eng = Engine(str(folder))
    labels = " ".join(f'{k} "{v}"' for k, v in REGIONS.items())
    r = eng.run(
        f"""
import delimited wages.csv, clear
label variable id "Person number"
label variable age "Age in years"
label variable educ "Years of schooling"
label variable female "Female (1) or not (0)"
label variable region "Region"
label variable wage "Hourly wage"
label define regions {labels}
label values region regions
compress
save wages, replace
"""
    )
    if r.rc != 0:
        raise SystemExit(f"the engine stopped with rc {r.rc}: {r.error}\n{r.log}")
    return (folder / "wages.dta").read_bytes()


def main() -> int:
    with tempfile.TemporaryDirectory() as d:
        data = build(Path(d))
    if "--check" in sys.argv:
        same = OUT.exists() and OUT.read_bytes() == data
        print("wages.dta is up to date" if same else "wages.dta differs from what this script makes")
        return 0 if same else 1
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_bytes(data)
    print(f"wrote {OUT} ({len(data)} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
