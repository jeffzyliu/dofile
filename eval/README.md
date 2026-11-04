# Engine evaluation kit

Reproduces `docs/engine-evaluation.md`. Expects this layout under a working dir `$S`:

- `$S/src/opendta/repo` and `$S/src/openstat/repo`: clones, each with its own `.venv` (`uv venv -p 3.12`, `uv pip install ./repo`)
- `$S/work/`: copy `corpus/`, `make_data.py`, `reference.py`, `run_eval.py` here

```bash
python -I make_data.py $S/work/data          # synthetic panel + copy of the CPS extract
python -I reference.py $S/work/data $S/work/ref.json   # needs pandas, statsmodels, linearmodels
python -I run_eval.py $S                     # runs corpus in both engines, prints scores
```

`probe/` holds the 12 pass/fail breadth checks (graphs, tabstat, svy, xtlogit, mixed, esttab, ...).
`pyodide_run.mjs` runs one .do file inside Pyodide under Node: `node pyodide_run.mjs opendta <src> <datadir> <file.do>`.
Each corpus file prints `CHECK name=value` lines; `run_eval.py` compares them to `ref.json` at 1e-6 relative tolerance.
