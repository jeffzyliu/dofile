# High-fidelity mockups

Deliverable 4 of the UI/UX design step (`docs/design/README.md`): the landing page and the editor, light and dark, on
the tokens in `web/src/styles/tokens.css` and the components in `web/src/styles/ui.css` (deliverable 5; the component sheet is `../system/`). Each page follows the
system's light or dark setting; `?theme=light` or `?theme=dark` forces one. Iteration 2 (2026-11-09) applied the UX crit in
`ux-analysis.md`; what changed is listed in `../README.md`. The toolbar's theme button (System, then
Light, then Dark) is drawn but not wired up.

| File | Renders |
|---|---|
| `editor.html` | `editor-{light,dark}.png` (desktop B, split: log above, graph below, after a run that ended on an error); `?running` gives `editor-running-{light,dark}.png` (Run selection in progress, Break live, the log's startup lines at the top) |
| `landing.html` | `landing-{light,dark}.png` (1440 x 900), `landing-phone-{light,dark}.png` (390 wide, full page) |
| `phone-log.html` | `phone-log-{light,dark}.png` (390 x 844, the Log tab); `?running` gives `phone-log-running-{light,dark}.png` (Break in Run's place) |
| `panels.html` | `panels-{light,dark}.png` (1440 wide, full page): the Data, Results and Help tabs; opening a .dta, .csv or .log; the full-size graph; the name clash, upload report, reset and memory notices, delete confirm |
| `states.html` | `states-{light,dark}.png` (1440 wide, full page): iteration 2's new states: the engine download prompt and progress, loading stages, later visits, Not now, did not start, failed twice, Break (countdown, stopped, not isolated), the ⋯ menus, Reset's confirm, the nested-do note, empty tabs |
| `ux-analysis.md` | the UX crit of round 3, with the maintainer's answers (`dev:`) and the resolution table (iteration 2) |
| `ux-analysis-2.md` | the UX crit of iteration 2 (which iteration-1 findings are fixed; new findings UX-027 to UX-037) and its resolution (iteration 3) |
| `ascii.html` | `ascii-{light,dark}.png` (1440 wide, full page): banner candidates A to E, on the landing page and as the Log pane's head |

`art.js` holds the banner candidates and fills `[data-art]`. D is pyfiglet output; A1 ("lower") is drawn by hand in
ANSI Shadow's style; the B series ("book", "thin") is lowercase on half-line pixels (▀ ▄ █), so a horizontal stroke is
half a line thick. Flags after the name: `+drop` adds a one-pixel drop shadow and `+skew` a 12 degree slant, both
CSS (`.art-drop`, `.art-skew` in `ui.css`). The mockups use B2, `book+drop+skew` (round 3), the final pick (2026-11-09).

The `.png` renders are not committed (only `img/`); open the HTML, or rebuild them. Content is dofile's own output: `sample.do` run with `dofile run` (CLI, sandboxed) on synthetic data; `img/scatter.png`
is its `graph export`. Every command and claim on the landing page is true today, or labeled ("with the first release").

Glyphs: the fonts in `web/src/styles/fonts/` are Latin subsets plus the complete, unmodified IBM Plex files, which are loaded only for
arrows, box drawing and block elements (`unicode-range` in `tokens.css`; the banner needs them). Plex has no
⌘ ▶ ■ ● ▾ ⋯, so the UI draws those as SVG icons (`.ico` in `ui.css`). Don't type them as text.
The complete files came from IBM's npm packages (`@ibm/plex-mono` 2.5.0, `@ibm/plex-sans` 1.1.0, on 2026-11-09):

```bash
cd web/src/styles/fonts
b=https://cdn.jsdelivr.net/npm
curl -sfL -o ibm-plex-mono-400-complete.woff2 $b/@ibm/plex-mono@2.5.0/fonts/complete/woff2/IBMPlexMono-Regular.woff2
curl -sfL -o ibm-plex-mono-700-complete.woff2 $b/@ibm/plex-mono@2.5.0/fonts/complete/woff2/IBMPlexMono-Bold.woff2
curl -sfL -o ibm-plex-sans-400-complete.woff2 $b/@ibm/plex-sans@1.1.0/fonts/complete/woff2/IBMPlexSans-Regular.woff2
curl -sfL -o ibm-plex-sans-600-complete.woff2 $b/@ibm/plex-sans@1.1.0/fonts/complete/woff2/IBMPlexSans-SemiBold.woff2
```

Accessibility (axe-core through `@axe-core/playwright`, a `web/` dev dependency): `cd web && npm run axe` checks every mockup
in light and dark, at 1440 and 390 wide (and `?running`), against WCAG 2.x A/AA and axe's best practices; exit code 1 on any
violation. `npm run axe -- <page.html> [--json out.json] [--browser firefox]` picks pages (paths from `web/`).
`npm run tabwalk [-- --verbose]` presses Tab through the landing page, the editor and the phone Log tab and fails if focus
lands on something a sighted user can't see (axe can't check that).

Rebuild (from `docs/design/`):

```bash
for m in light dark; do f=$([ $m = dark ] && echo --dark)
  node shot.mjs mockups/editor.html mockups/editor-$m.png --width 1440 --height 900 $f
  node shot.mjs mockups/editor.html mockups/editor-running-$m.png --width 1440 --height 900 --query running $f
  node shot.mjs mockups/landing.html mockups/landing-$m.png --width 1440 --height 900 $f
  node shot.mjs mockups/landing.html mockups/landing-phone-$m.png --width 390 --height 844 --full $f
  node shot.mjs mockups/phone-log.html mockups/phone-log-$m.png --width 390 --height 844 $f
  node shot.mjs mockups/phone-log.html mockups/phone-log-running-$m.png --width 390 --height 844 --query running $f
  node shot.mjs mockups/states.html mockups/states-$m.png --width 1440 --full $f
  node shot.mjs mockups/panels.html mockups/panels-$m.png --width 1440 --full $f
  node shot.mjs mockups/ascii.html mockups/ascii-$m.png --width 1440 --full $f
done
```
