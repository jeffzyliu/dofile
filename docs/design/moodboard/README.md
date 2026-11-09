# Moodboard

Deliverable 1 of the UI/UX design step in `docs/phase2-plan.md`. Open `index.html` in a browser (it follows the
system's light or dark mode), or render `moodboard-light.png` and `moodboard-dark.png` (below; renders are not
committed).

- `img/`: frames from the legacy OpenStata GIFs (`legacy/openstata/docs/img/`, our own work) and OpenDTA's README
  screenshot (MIT, https://github.com/yaskepalhares/opendta). Frames that showed a sign-in email or a personal file
  dialog are not used.
- `refs/`: screenshots of the third-party pages below, and `stata-gui.png`, a frame of Stata's window from the legacy
  `stata-commands.gif`. They are gitignored: they are not ours to publish, and Stata's graphics stay out of the repo
  (`LICENSE-POLICY.md`). Its layout and workflow may be referenced, as OpenDTA's policy allows; its colors, fonts,
  icons and text are not copied. Without `refs/`, open `index.html?norefs`: the notes without these screenshots.

| Reference | URL | What to take |
|---|---|---|
| webR REPL | https://webr.r-wasm.org/latest/ | the closest product (a language runtime in WebAssembly with an editor, console and files); plain text toolbar; dark mode |
| DuckDB Web Shell | https://shell.duckdb.org/ | terminal-first page, thin top bar, startup line with the version |
| Pyodide console | https://pyodide.org/en/stable/console.html | the banner as the first lines of output |
| marimo playground | https://marimo.app/ | a quiet empty state with a few starting actions |
| arXiv abstract page | https://arxiv.org/abs/1706.03762 | the academic register: dense small type, plain links, a side column of facts |

## Rebuild

```bash
# from the repo root; Playwright comes from web/node_modules
for mode in light dark; do
  flag=$([ $mode = dark ] && echo --dark)
  node docs/design/shot.mjs docs/design/moodboard/index.html docs/design/moodboard/moodboard-$mode.png --width 1664 --full --query norefs $flag
  node docs/design/shot.mjs docs/design/moodboard/index.html docs/design/moodboard/refs/moodboard-full-$mode.png --width 1664 --full $flag
done
```

To refresh `refs/`, screenshot each URL above at 1440x900 and resize it to 1200 px wide; `stata-gui.png` is frame
140 of `legacy/openstata/docs/img/stata-commands.gif`.
