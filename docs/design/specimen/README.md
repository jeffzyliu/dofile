# Font specimen

Four candidate font pairs (monospace + UI font) in the moodboard's light and dark palette: open `index.html`, or render
`specimen.png` (below; renders are not committed). The log is dofile's own output on synthetic data.

The fonts (Latin subsets from Fontsource, SIL Open Font License) are gitignored until one is chosen and
`LICENSE-POLICY.md` allows OFL fonts. To fetch them (zsh):

```zsh
mkdir -p docs/design/specimen/fonts && cd docs/design/specimen/fonts
for spec in ibm-plex-mono:400,700 ibm-plex-sans:400,600 source-code-pro:400,700 source-sans-3:400,600 \
            jetbrains-mono:400,700 inter:400,600; do
  f=${spec%%:*}
  for w in ${(s:,:)${spec##*:}}; do
    curl -sfL -o $f-$w.woff2 "https://cdn.jsdelivr.net/fontsource/fonts/$f@latest/latin-$w-normal.woff2"
  done
done
```

Rebuild: `node docs/design/shot.mjs docs/design/specimen/index.html docs/design/specimen/specimen.png --width 1720 --full`
