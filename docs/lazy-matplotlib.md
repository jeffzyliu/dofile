# dofile web demo: experiment, loading matplotlib lazily

An experiment that is not done: whether the snapshot should load matplotlib on the first plot.
Moved out of [phase2-plan.md](phase2-plan.md) on 2026-11-10; the text is unchanged.

## Experiment: loading matplotlib lazily

Status: **not done**; nothing in the repo implements it (the snapshot build still imports matplotlib, draws one graph, and
bundles matplotlib's files). Findings and conjectures recorded 2026-11-07, while working on the snapshot
([pyodide-snapshot.md](pyodide-snapshot.md)).

**The question.** Matplotlib is about 28% of the site-packages files and about 23 MB of the snapshot's raw heap, and it is
needed only when a program draws a graph. Should it be loaded on demand in the snapshot flow (left out of the heap and the
main download), in the regular flow (which already imports it at the first plot), or both? The first plot should not take
about a second, as it does in the regular flow today. The snapshot's eager import is worth keeping unless lazy loading saves
**significant** time at a cold and a warm start without bringing that delay back.

### Measured

Pyodide 314.0.7 under Node, a normal boot, an M-series Mac, 3 runs each; the first plot is `scatter y x` in a fresh `Engine`
after numpy, scipy and `dofile.engine` were loaded. `browser.start()` itself takes 1.8 s (numpy and scipy); matplotlib and PIL
come with the first graph. Not yet measured in a browser.

| Part of the first plot | Time | Share |
|---|---|---|
| Compiling matplotlib's 147 `.py` files to bytecode (no `.pyc` exists for any) | 0.59–0.61 s | about 68% |
| Running the modules' code (173 modules) | about 0.2 s | about 25% |
| Fonts and first-use drawing | about 0.03 s | about 3% |
| The plot itself | 0.04–0.05 s | about 5% |
| **First plot** | **0.87–0.89 s** | |

- **With unchecked-hash `.pyc` files written for those 147 modules beforehand, the first plot took 0.29 s** (the one experiment
  behind "0.9 s to 0.3 s": `.pyc` files written just before the plot, standing in for a build step).
- **Fonts are not the delay:** the font list loads in 0.001 s (Pyodide's matplotlib ships a prebuilt list). On CPython a cold
  font cache cost 11.2 s (scanning 1,070 system fonts), which does not exist in the browser.
- **In the snapshot flow the first plot is already fast** (the sample program took 0.11 s against 0.87 s in the regular flow),
  because matplotlib is imported and compiled before the heap is saved.
- **The engine already imports matplotlib lazily** (`graphics/render.py` imports it inside functions), so neither flow needs an
  engine change. The profile showed no `pyplot` import during the first plot (read off the profile, not checked in the source).
- **What matplotlib is worth in the snapshot** (stage-by-stage build, brotli 5, and the bundle): importing it adds 23 MB of raw
  heap and **4.5 MB** compressed; its files and dependencies (pillow, fonttools, kiwisolver, contourpy, pyparsing, dateutil,
  pytz, six) are 1,052 of the 3,884 files, 26–27 MB of 93 MB raw, **7.4 MB** compressed. Only 16 of the 136 native libraries
  are graphics-only.
- **No `.pyc` anywhere in the bundle**, so the regular flow compiles everything it imports on every page load. Pyodide's
  package loader does not write `.pyc` files.

### Conjectures (not measured)

**Snapshot flow, lazy graphics.**
1. The build's warm-up draws nothing, so matplotlib is never imported (assert `'matplotlib' not in sys.modules`). The bundle is
   split into a core part and a graphics part (matplotlib, mpl_toolkits, pylab, PIL, pillow, kiwisolver, contourpy, fontTools,
   cycler, pyparsing, dateutil, pytz, six) with its own file index and `.pyc` files for the modules a plot imports. The 16
   graphics libraries leave the re-link list and link normally at their first import.
2. The page restores the core snapshot as today, so the engine is ready sooner.
3. After "ready" the worker fetches the graphics part (Cache API, brotli), decompresses it and writes it into site-packages.
4. `run` waits for those files, because any command can draw. Optionally the worker imports matplotlib right after, so the
   first plot pays no import.

| Estimate, brotli 11 (from the 42.3 MB build, before docstring stripping) | Now (eager) | Lazy: core, before "ready" | Lazy: graphics, after |
|---|---|---|---|
| Heap | 22.2 MB (measured) | about 18.6 MB | |
| Files | 20.0 MB (measured) | about 13.8 MB | about 6.2 MB, plus about 2 MB of `.pyc` (a guess) |
| Total | 42.3 MB | **about 32–33 MB** | **about 8 MB** |

The graphics shares are the brotli 5 figures scaled by the ratios measured between brotli 5 and 11 (0.77 heap, 0.84 files). A
visitor who plots downloads about the same in all; the gain is about 9.7 MB less before "ready". Timing guesses: a warm start
about 1.05 s instead of 1.2 s; the first plot after a warm start about 0.4 s with `.pyc` or about 1.0 s without; a cold start
about 0.8 s faster at 100 Mbps and 2.6 s faster at 30 Mbps, which would bring the snapshot at 30 Mbps from 13.9 s to about
11.3 s, ahead of the regular boot's 13.9 s.

**Regular flow.**
- **(a) Import matplotlib in the background once the engine is ready.** It moves the 0.9 s off the click and changes no
  download. A Run issued during that import waits up to about 0.9 s (Python is single-threaded in the worker).
- **(b) Ship precompiled `.pyc` files for the graphics packages.** The first plot at about 0.3 s. Matplotlib comes from
  Pyodide's CDN without `.pyc` files, so this needs our own repackaged bundle, tied to this Python build.
- **(c) The same compile cost probably applies to the whole stack** (scipy import 1.65 s, matplotlib 0.94 s, numpy 0.22 s,
  engine 0.51 s). If about two thirds is compiling, `.pyc` for everything could cut several seconds from the regular boot.
  Not measured.
- **(d) Keep compiled bytecode between visits** (IndexedDB). An idea only: `.pyc` files are checked against the source's
  modification time, which differs on every page load.

### The experiment

1. **Build the lazy snapshot** (a build option): warm-up without drawing, the assertion, the split bundle, `.pyc` for the
   modules a first plot imports (found by diffing `sys.modules` around it). Measure the raw, q5 and q11 sizes of the heap, the
   core files, the graphics files, and the graphics files with `.pyc`. This replaces the estimate table.
2. **Time it under Node:** the core restore, loading the graphics part, and the first plot with and without `.pyc` and with a
   pre-import, against the eager first program (0.11 s).
3. **Time it in the browser** with `web/scripts/measure-startup.mjs`: unthrottled, 100 and 30 Mbps, cold and warm, plus a plot
   started one second after "ready".
4. **Decide the gating:** whether `run` waits for the graphics files for every program, and what the status line says.
5. **Regular flow:** measure (a), (b) and (c), including the compile-versus-import split for numpy, scipy and dofile.
6. **Correctness:** `npm run check-snapshot` on the lazy variant, and the native-library test; core code must not import a
   graphics package (`pytz`, `dateutil` and `six` are the doubtful ones).

**Decision rule.** Adopt lazy graphics in the snapshot flow only if, measured, a cold first visit at 30 Mbps is about 2 s
faster, a warm start is at least about 0.2 s faster, and the first plot stays at or under about 0.5 s. Otherwise keep it eager.
For the regular flow, take the cheapest of (a) and (b) that brings the first plot well under a second without making Run wait
noticeably.

**Risks.** A plot started in the first moments waits for the graphics download on a slow network. A second file to keep in sync
with the manifest. `.pyc` files tie the graphics part to this exact Python build. Core code that quietly imports a graphics
package would fail only on the lazy path.
