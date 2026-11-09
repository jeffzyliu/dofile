# Wireframes

Deliverable 3 of the UI/UX design step (`docs/design/README.md`): low fidelity, grayscale, light only, built from the
user flows (`../flows/`). Content (the log, the variables) is dofile's own output on synthetic data.

| File | What |
|---|---|
| `desktop-a.html` / `.png` | A: everything visible. Files, editor over a Data/Results/Help pane, log (with the command line) over the graph. |
| `desktop-b.html` / `.png` | B (chosen): files, editor, and one output pane with tabs (Log, Graph, Data, Results, Help); a new graph shows as a preview. |
| `desktop-b-split.png` | B split (`desktop-b.html?split`): Log above, the other tabs below, Graph first. |
| `phone.html` / `.png` | Phone (390 x 844): tabs Files, Editor, Log, Data, Results; Run turns into Break in place; the command line over the keyboard; Help and the graph as sheets. |
| `states.html` / `.png` | The states that change the layout: starting, Break pressed, reset notice, name clash, upload report, another tab, memory warning, failed twice. |

`wf.css` and `content.js` are shared. Red numbers are the focus order. The `.png` files are renders, not committed:
open the HTML in a browser, or rebuild them.

Rebuild (from `docs/design/`):

```bash
for v in a b; do node shot.mjs wireframes/desktop-$v.html wireframes/desktop-$v.png --width 1440 --full; done
node shot.mjs wireframes/desktop-b.html wireframes/desktop-b-split.png --width 1440 --full --query split
node shot.mjs wireframes/phone.html wireframes/phone.png --width 1400 --full
node shot.mjs wireframes/states.html wireframes/states.png --width 1450 --full
```
