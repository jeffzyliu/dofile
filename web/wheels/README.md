# Wheels for the web demo that PyPI and Pyodide do not have

`pyreadstat-*.whl`: [pyreadstat](https://github.com/Roche/pyreadstat) (BSD-3) built for Pyodide (`wasm32`, Emscripten),
which wraps the ReadStat C library (MIT). The page and the web scripts install every `*.whl` in this folder after the
dofile wheel. It gives the web demo SAS transport (`import`/`export sasxport`), SPSS and Stata 7 and older `.dta` files (newer `.dta` files have their own reader).
The wheel is committed so that CI and a fresh checkout need no Emscripten build (a choice, not a limit: `build.sh` rebuilds it in about a minute with Emscripten cached; the rebuilt wheel differs from the committed one only in zip metadata such as timestamps, so compare the files inside, not the bytes). Its licences are inside it (`*.dist-info/licenses/`).

Rebuild with `sh pyreadstat/build.sh` after a Pyodide upgrade (the wheel's tag must match the page's Pyodide) or a
`pyreadstat` upgrade; the recipe and its one patch (`pyreadstat/emscripten.patch`: no `-lz`/`-liconv` for a wasm
target) are in `pyreadstat/`. Then rebuild the snapshot (`npm run snapshot`), since it holds the installed packages.

The page does not load pandas, so `export sasxport` (the only command that needs it) stops with rc 199 (`export sasxport is not available: it needs
the pandas package`, ODT-32); every read works. Pandas would add about 7 MB to the snapshot (docs/pyodide-snapshot.md, "Packages added").
