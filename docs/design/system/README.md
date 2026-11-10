# Design system

Deliverable 5 of the design step (`../README.md`). Three parts:

| What | Where |
|---|---|
| Tokens: colors (light and dark), type, weights, spacing, radius, shadows | `web/src/styles/tokens.css` (fonts and their license in `web/src/styles/fonts/`) |
| Components | `../../../web/src/styles/ui.css` |
| The component sheet: every token and component in its states, with the rules for each | `index.html` |
| The crit of the design system: what was fixed and what is open | `critique.md` |

The sheet follows the system's light or dark setting; `?theme=light` or `?theme=dark` forces one. Renders are not
committed. Rebuild (from `docs/design/`):

```bash
for m in light dark; do f=$([ $m = dark ] && echo --dark)
  node shot.mjs system/index.html system/system-$m.png --width 1440 --full $f
done
node shot.mjs system/index.html system/system-forced.png --width 1440 --full --forced   # Windows High Contrast
```

Checks (from `web/`; each exits 1 on a failure):

| Script | Checks |
|---|---|
| `npm run contrast [-- --matrix]` | The tokens as the browser resolves them in four modes (system light and dark, `[data-theme]` forcing each): a forced theme must equal the system one, and every foreground/background pair the components use must reach 4.5:1 (text) or 3:1 (edges, bars, the focus ring). Add a pair to the list in `contrast.mjs` when a component uses a new one. `--matrix` prints every token on every background. |
| `npm run fonts [-- --browser firefox]` | Every font face loads, and no visible text asks for a weight we don't ship (Sans 400/600, Mono 400/700, no italics). |
| `npm run axe` | axe-core over the mockups and this sheet, light and dark, desktop and phone (WCAG 2.x A/AA and best practices). |
| `npm run tabwalk` | Tab through the landing page, the editor and the phone Log tab; every focus stop must be visible. |

When adding a component: use tokens, not literals (icon sizes and one-off sizes excepted); bold is
`var(--w-bold-ui)` in Sans and `var(--w-bold-mono)` in Mono; draw it in `index.html` with its states; run the four checks.
