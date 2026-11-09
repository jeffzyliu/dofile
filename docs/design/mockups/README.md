# High-fidelity mockups

Deliverable 4 of the UI/UX design step in `docs/phase2-plan.md`: the landing page and the editor, light and dark, on
the tokens in `../tokens.css` and the components in `ui.css` (the start of deliverable 5). Each page follows the
system's light or dark setting; `?theme=light` or `?theme=dark` forces one. The toolbar's theme button (System, then
Light, then Dark) is drawn but not wired up.

| File | Renders |
|---|---|
| `editor.html` | `editor-{light,dark}.png` (desktop B, split: log above, graph below, after a run that ended on an error); `?running` gives `editor-running-{light,dark}.png` (Run selection in progress, Break live, the log's startup lines at the top) |
| `landing.html` | `landing-{light,dark}.png` (1440 x 900), `landing-phone-{light,dark}.png` (390 wide, full page) |
| `phone-log.html` | `phone-log-{light,dark}.png` (390 x 844, the Log tab) |
| `panels.html` | `panels-{light,dark}.png` (1440 wide, full page): the Data, Results and Help tabs; opening a .dta, .csv or .log; the full-size graph; the name clash, upload report, reset and memory notices, delete confirm |
| `ascii.html` | `ascii-{light,dark}.png` (1440 wide, full page): banner candidates A to E, on the landing page and as the Log pane's head |

`art.js` holds the banner candidates and fills `[data-art]`. D is pyfiglet output; A1 ("lower") is drawn by hand in
ANSI Shadow's style; the B series ("book", "thin") is lowercase on half-line pixels (▀ ▄ █), so a horizontal stroke is
half a line thick. Flags after the name: `+drop` adds a one-pixel drop shadow and `+skew` a 12 degree slant, both
CSS (`.art-drop`, `.art-skew` in `ui.css`). The mockups use B2, `book+drop+skew` (round 3).

The `.png` renders are not committed (only `img/`); open the HTML, or rebuild them. Content is dofile's own output: `sample.do` run with `dofile run` (CLI, sandboxed) on synthetic data; `img/scatter.png`
is its `graph export`. Every command and claim on the landing page is true today, or labeled ("with the first release").

Glyphs: the fonts in `../fonts/` are Latin subsets plus the complete, unmodified IBM Plex files, which are loaded only for
arrows, box drawing and block elements (`unicode-range` in `../tokens.css`; the banner needs them). Plex has no
⌘ ▶ ■ ● ▾ ⋯, so the UI draws those as SVG icons (`.ico` in `ui.css`). Don't type them as text.
The complete files came from IBM's npm packages (`@ibm/plex-mono` 2.5.0, `@ibm/plex-sans` 1.1.0, on 2026-11-09):

```bash
cd docs/design/fonts
b=https://cdn.jsdelivr.net/npm
curl -sfL -o ibm-plex-mono-400-complete.woff2 $b/@ibm/plex-mono@2.5.0/fonts/complete/woff2/IBMPlexMono-Regular.woff2
curl -sfL -o ibm-plex-mono-700-complete.woff2 $b/@ibm/plex-mono@2.5.0/fonts/complete/woff2/IBMPlexMono-Bold.woff2
curl -sfL -o ibm-plex-sans-400-complete.woff2 $b/@ibm/plex-sans@1.1.0/fonts/complete/woff2/IBMPlexSans-Regular.woff2
curl -sfL -o ibm-plex-sans-600-complete.woff2 $b/@ibm/plex-sans@1.1.0/fonts/complete/woff2/IBMPlexSans-SemiBold.woff2
```

Rebuild (from `docs/design/`):

```bash
for m in light dark; do f=$([ $m = dark ] && echo --dark)
  node shot.mjs mockups/editor.html mockups/editor-$m.png --width 1440 --height 900 $f
  node shot.mjs mockups/editor.html mockups/editor-running-$m.png --width 1440 --height 900 --query running $f
  node shot.mjs mockups/landing.html mockups/landing-$m.png --width 1440 --height 900 $f
  node shot.mjs mockups/landing.html mockups/landing-phone-$m.png --width 390 --height 844 --full $f
  node shot.mjs mockups/phone-log.html mockups/phone-log-$m.png --width 390 --height 844 $f
  node shot.mjs mockups/panels.html mockups/panels-$m.png --width 1440 --full $f
  node shot.mjs mockups/ascii.html mockups/ascii-$m.png --width 1440 --full $f
done
```
