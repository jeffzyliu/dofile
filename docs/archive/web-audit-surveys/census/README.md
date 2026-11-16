# Census scripts

The one-off scripts and the knip config behind `../04-census.md`, as the census agent wrote them: dense, not cleaned,
not maintained. Kept so the census can be run again after the audit and compared. Their output is not kept.

- Run each from `web/` with a scratch folder as its argument: `node <script>.mjs <scratch>`. `dom.mjs` writes
  `dom-matches.tsv` there. `docs.mjs` reads `<scratch>/files.txt`, the output of `git ls-files` at the repository root.
- `knip.json`: knip's default run fails here (`vite.config.ts` needs `DOFILE_URLS`). Run it with this config and
  `DOFILE_URLS=local`; it then reports `e2e/global-setup.ts` as unused, which is wrong.
- What each one counts: `cmt.mjs` comments and file headers, `css.mjs` CSS classes no file uses, `docs.mjs` paths and
  script names in the docs that no longer exist, `dom.mjs` direct DOM access, `fn.mjs` long functions, `lic.mjs`
  dependency licences.

The exact commands were not recorded beyond what report 04 says; check a script's first lines before trusting a number.
