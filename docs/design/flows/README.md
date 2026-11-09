# User flows

Deliverable 2 of the UI/UX design step (`../README.md`). One page, `index.html`, holds:
- the flows F1 to F7: first visit, open the sample, upload a replication package, run, Break, a crashed engine and
  Reset, and download everything. Each step is tagged as done in the proof of concept or still to build;
- the decisions taken along the way (2026-11-08, and iterations 2 and 3 of the hi-fi mockups);
- the states and messages the design must show.

The page follows the system's light or dark setting. It loads IBM Plex from `web/src/styles/fonts/`.

Renders (`flows-light.png`, `flows-dark.png`) are not committed. Rebuild (from `docs/design/`):

```bash
node shot.mjs flows/index.html flows/flows-light.png --width 1500 --full
node shot.mjs flows/index.html flows/flows-dark.png --width 1500 --full --dark
```
