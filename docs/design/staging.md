# Staging `public/` (the R5 note)

Status: **approved by the maintainer 2026-11-17: choices 1 to 5 as recommended, choice 3 amended** (section 5). Before R5 (phase 2, item 2.15) starts it was for the maintainer's approval. Written at f947053 from the code; where
report 10 (`docs/archive/web-audit-surveys/10-build-scripts.md`) and the code differ, the code is followed and the
difference is named. No code changes here.

## 1. What is staged, and who owns it today

Four kinds of file reach the editor's `public/` (all gitignored: `web/.gitignore`; `public/` itself is not in git):

| Staged file | Source | Written by | Today, when |
|---|---|---|---|
| the dofile wheel, `public/dofile-*.whl` | the newest `*.whl` in the repository's `dist/` (`npm run wheel` builds it) | `vite.config.ts:55-56` | every load of the config |
| extra wheels, `public/pyreadstat-*.whl` | `web/wheels/*.whl` (committed) | `vite.config.ts:57-58` | every load of the config |
| Pyodide's runtime, `public/pyodide/` (3 files, `RUNTIME_FILES`, `start-files.ts:14`) | `node_modules/pyodide/` | `vite.config.ts:63-68` | every load of the config |
| the snapshot, `public/snapshot/` (+ `manifest.json`) | built in Pyodide under Node | `scripts/make-snapshot.ts` (`rmSync` of the folder first, then writes) | `npm run snapshot` |

"Every load of the config" is every `vite` command of either mode: `vite.config.ts` calls `readInputs()` (`:47`) and copies
at module load, before `defineConfig` (`:396`) decides what the command is. Report 10 (F2) says the pages-only mode "needs
no wheel"; the code disagrees: `--mode site`, `vite preview` and both Playwright `webServer`s (`playwright.config.ts:19-25`)
all throw "no wheel in ../dist" when the root `dist/` has none, and all write `public/`, though none of them serves `public/`
(the site build has `publicDir: false`, `:245`; a preview serves `dist/`). Three problems follow, each seen in the code:

1. A command that only reads (`preview`, the site build) writes, and `npm run dev` starts two `vite` processes that write the
   same files at the same moment.
2. Nothing ever removes a staged file. After a version change `public/` holds two `dofile-*.whl`; `vite build` copies the whole
   of `public/` into `dist/app/`, so the old wheel is deployed. CI is spared (a fresh checkout); a local `npm run deploy` is not.
   (Not in report 10.) The staged copies carry no record, so nothing can say they are stale.
3. Staleness is told for the snapshot only (`staleness()`, `build-id.ts:75`), by comparing the manifest's hashes with
   `inputs()`. The staged wheel is correct by accident of the config running last.

## 2. Every reader and writer, and what it needs staged

Key: W the dofile wheel, X extra wheels, P Pyodide's three files, S the snapshot. "Stage" means `public/` holds W, X, P of the
current inputs. Wheel = a wheel in the root `dist/` (`npm run wheel`, `package.json:8`). Reads of `dist/`, `web/wheels/` and
`node_modules/pyodide/` directly are not staging (they stay as they are).

**npm scripts** (`package.json`):

| Script | Runs (today) | Needs staged | Writes | Notes |
|---|---|---|---|---|
| `wheel` | `rm -f dist/dofile-*.whl`, `uv build --wheel` | nothing | root `dist/` | S9 changes where it writes (clause: stops deleting the release wheels); R5 reads the place from S9's one `wheels()` helper, never spells it |
| `snapshot` | `wheel`, `make-snapshot.ts` | nothing: it reads W, X from `dist/`, `web/wheels/` (via `install-engine.ts`) and P from `node_modules` | S | the only writer of `public/snapshot/` |
| `check-snapshot` | `wheel`, `check-snapshot.ts` | S, fresh (`:168-174`, rc 2 if stale); W, X from `dist/` | none | never reads staged W, X, P |
| `check-pytest`, `check-numeric` | `wheel`, the script | nothing | none | `installEngine` reads `dist/`, `web/wheels/` |
| `pretest` / `test` | `wheel`; `node --test` | nothing staged; one test loads the config: `test/site.test.ts:304-309` spawns `vite build` and `vite build --mode site` with no URLs and expects "Say which addresses ..." (`:398`), on a checkout where nothing is staged (the CI `unit` job runs `npm test` before any build), so `staged()` must not run at module load or before the URLs check. `test/harness.ts:15-23` reads `dist/`, `web/wheels/`; `engine.test.ts:350`, `snapshot-native.test.ts` read `public/snapshot` and skip when it is missing or stale | none | 5 tests skip with no snapshot (G0's baseline) |
| `dev` | `wheel`, `build-id.ts --warn`, `together.ts dev`: two `vite` | W, X, P, S (S missing: the page says so; stale: a warning, the page "updated") | W, X, P (twice, racing) | serves `public/` at `/`; `devStartFiles()` (`:85`) lists `public/` and reads its manifest on every request |
| `build` | `wheel`, `vite build`, `vite build --mode site` | W, X, P, S fresh: the editor build copies all of `public/` into `dist/app/`, and `writeStartFiles` (`:362`) throws on a stale S; with no S it builds and the page fails "no snapshot in this build" | W, X, P (twice) | the site build needs only the wheel's file name (the landing page's version, `:138`) and `dist/app/start-files.json` |
| `build:local` | `DOFILE_URLS=local npm run build` | as `build` | as `build` | |
| `preview` | `together.ts preview`: two `vite preview` | nothing (serves `dist/`); needs the build made first | W, X, P (twice) | has no `wheel` step, yet fails without one in `dist/`: the config load only |
| `e2e` | `snapshot`, `build:local`, `playwright test` | as `build`; Playwright's two previews: nothing | W, X, P (twice in the build, twice per `webServer`) | `wheel` runs twice (report 10, F9) |
| `cf:dev` | `snapshot`, `build` with two localhost addresses, two `wrangler dev` | as `build` (S at quality 11: the quality-5 heap is refused by wrangler) | as `build` | `wheel` twice; wrangler reads `dist/` only |
| `deploy` | `lint:strict`, `snapshot`, `DOFILE_URLS=production npm run build`, `check-sizes.ts`, two `wrangler deploy` | as `build` | as `build` | `wheel` twice. A hand-made twin of build-web: no workflow runs it |
| `commands`, `sample`, `check`, `lint*`, `format`, `axe`... | | nothing | `src/` generated files | out of scope |
| `check-sizes.ts`, `smoke.ts`, `measure-startup.ts` | | the built `dist/` (or the network) | none | read no staged file |

**Workflows and the action:**

| Where | Steps that touch staging | Needs staged |
|---|---|---|
| **deploy.yml** (`:54`, a push to `main`) | the `build-web` action, then `wrangler deploy` x2 | via the action: everything below. **This path comes first: a merge deploys.** |
| **build-web** (`action.yml:28`, `:33-44`, `:47-53`) | (1) `npm ci && npm run wheel`; (2) restore `web/public/snapshot` by a hash key (`:37`); on a hit, `node scripts/build-id.ts` says whether the cached S is of this wheel, else `npm run snapshot` (quality 11); (3) `npm run build && check-sizes.ts` | (3): W, X, P (staged by the config, so by the build itself), S (cache or built). On a cache miss the wheel is built **three times** (1; `npm run snapshot` runs `wheel`; then inside `build`), on a hit twice. A cache hit passes step 2 against wheel 1 and step 3 against wheel 2: it is safe only because the rebuilt wheel has the same bytes, and a difference fails the build (closed, never a stale deploy) |
| **preview.yml** (`:60`) | the same action, with two workers.dev addresses; then `wrangler versions upload` x2 | as build-web |
| **web.yml `unit`** (`:77-82`) | `npm test` (wheel), `npm run build` with `DOFILE_URLS=production` | W, X, P by the build; **no snapshot**: the build passes with `built: null`. `npm run build` is the only check that the production addresses build |
| **web.yml `e2e`** x4 (`:134`) | `npm run e2e` at quality 5, per project | as `e2e` above |
| **web.yml `snapshot`** (`:160-166`) | `npm run snapshot` (quality 5), `npm test`, `check-snapshot` | S only |
| web.yml `lint`, lint.yml, ci.yml, release.yml | none (release builds its own wheel from the repository root with `uv build`) | nothing |

**N7's baseline command** (N7 is being designed in this phase; it builds a commit in a worktree of its own). In that worktree
it needs: node_modules (`npm ci`, or a symlink: the config already tolerates one, `:293`), a wheel in that worktree's own
root `dist/` (never a shared one: `wheel` deletes there), W, X, P staged, S at `SNAPSHOT_QUALITY=5` (pixels do not depend on
the quality; G0's `g0-snapshot.log` shows 13 s), and a build with `DOFILE_URLS=local` made under the same `E2E_PORT` the previews
will listen on (`global-setup.ts` refuses a build for other ports, `:21-25`). That is today's `e2e` without `playwright test`;
no script is that. N7 runs in phase 0, and its baselines are built at the start of phase 2, before R5 (item 2.15), so the commits it builds
have no `e2e:prepare`. N7 therefore spells `SNAPSHOT_QUALITY=5 E2E_PORT=<p> npm run snapshot && DOFILE_URLS=local npm run
build` (or `npm run build:local`). R5 keeps those names and effects, so the same text works before and after it (the wheel
is built twice, harmless by byte-identity). `e2e:prepare` (section 3) is a tidy-up for R5's own scripts, not something N7
depends on.

## 3. The design

**One writer.** `scripts/stage.ts` owns W, X, P; `make-snapshot.ts` keeps S. Disjoint paths: stage never touches
`public/snapshot/`, snapshot never touches the rest, so build-web's cache of S stays valid across a stage. Stage:
(1) takes the inputs from `inputs()` (S9's `wheels()`), (2) deletes `public/stage.json` first, then every `*.whl` and `public/pyodide/` in `public/`
(this ends problem 2), (3) copies, (4) writes `public/stage.json` **last**, so a stage that died half-way leaves no record: the inputs record (`BuildInputs`: wheel name and hash, extra
wheels' hashes, Pyodide version). That file follows the precedent of S's `manifest.json`: Vite copies it, and the build
removes it from `dist/app/` in the same `closeBundle` that removes the manifest (`start-files.ts:105`).

**The config only reads.** A `staged()` function, next to `staleness()` in `build-id.ts`, compares `stage.json` with
`inputs()` **and checks that every file the record names exists with the recorded size** (the wheels and the three Pyodide
files; the wasm is about 9 MB, so a size check is cheap and a hash is not needed), and returns the reason or null, in the
words `staleness()` uses ("the staged files are stale: the dofile wheel differs ...; run `npm run stage`"). A unit test
covers it: a deleted `pyodide.asm.wasm` and a record of other inputs each give a reason. Without the file check, a deleted
file under a matching record would ship, which the config's copy-at-every-load never allowed.

Which consumer reads what, since the config today calls `readInputs()` at module load (`:47`), which throws without a
wheel (`build-id.ts:33`): **`inputs()` becomes lazy**, called where it is used, not at module load. The editor (`build`
and `serve`) needs it for the defines (`__WHEEL__`, `__BUILD_ID__`, `__ABOUT__`, `:299-303`) and calls `staged()`, **inside
`editor()`, after the URLs check** (`:398`), never at module load. The editor preview (`editorPreview()`) needs neither: it
serves `dist/`. The site build needs only the wheel's version (`about(inputs).dofile`, `:138`), so it calls `inputs()` in
`fillSite`, and **still needs a wheel in `dist/`**; it does not read `public/` (the site has `publicDir: false`).
Report 10's "no wheel needed" for the pages-only mode stays untrue. A preview made without a wheel then works; a site build
does not. Cost: the dev server
checks once at start, not per request. "Stale" has then four named states, each with its fix: staged (`npm run stage`),
snapshot (`npm run snapshot`), page (reload), dev server (restart).

**Entry points call stage once.** `stage` = `npm run wheel` then `node scripts/stage.ts`. The user-facing scripts keep their
names and effects, but compose raw steps, so `wheel` runs once:

| Script after R5 | Runs |
|---|---|
| `stage` | `wheel`, `stage.ts` |
| `snapshot` | `wheel`, `snapshot:make` (internal: the node script; S does not need a stage). `snapshot:make` is what `e2e:prepare`, `cf:dev`, `deploy` and build-web run after `stage`, so none rebuilds the wheel |
| `build`, `build:local` | `stage`, then `build:vite` (new, internal: the two `vite build`s) |
| `dev` | `stage`, `build-id.ts --warn`, `together.ts dev` |
| `e2e:prepare` (new; N7 uses it) | `stage`, `snapshot:make` (internal: the node script), `DOFILE_URLS=local` `build:vite` |
| `e2e` | `e2e:prepare`, `playwright test` |
| `cf:dev`, `deploy` | `stage`, `snapshot:make`, `build:vite`, then what they run today (`deploy` and `cf:dev` stop re-spelling the chain; `deploy` keeps its `lint:strict` first) |
| `preview`, the `webServer`s | no wheel, no stage: they serve the folders the last `build` wrote |
| `check-*`, `pretest` | unchanged (`wheel` only: they read `dist/` and `web/wheels/`, not `public/`) |

**Answer to report 10's worry** (it "would break the one command feel of `npm run dev` unless `dev` and `build` call
`stage` first"). They do, as they call `wheel` today, and it costs the same: a person types `npm run dev` or `npm run build`
and gets what they got. What changes is bare `vite`, `npx vite preview` and Playwright's `webServer`: they no longer write
`public/`; a bare `vite` that needs a stage fails fast with the `staged()` message instead of silently staging. A bare `vite`
is not a documented path (`web/CLAUDE.md` lists the npm scripts). Cost the other way: `dev` stages once per start, not per
config load, so a wheel rebuilt by hand while `dev` runs is not picked up until `npm run stage` and a restart.

**The two CI file lists.** Today: `web.yml:50` (ENGINE, a regex: the snapshot job's inputs and its checks' inputs) and the
cache key (`action.yml:37`, a `hashFiles` list: what makes S). They differ on purpose in part (the key lacks the tests and
corpora) and by drift in part: the key has README.md and LICENSE (both go into the wheel), which the regex lacks; the regex has
the checks' own files (`check-snapshot.ts`, `snapshot-node.ts`), which the key rightly lacks. A script `make-snapshot.ts` starts to import is in neither unless someone remembers (`make-snapshot.ts`
imports `src/engine/snapshot.ts`, `build-id.ts`, `install-engine.ts`; the key names all three by file, the regex names
the last two by file and `snapshot.ts` only through the directory `web/src/engine/`). The one table: `web/scripts/snapshot-inputs.txt`, git pathspecs one per line, in two
sections: `build` (what makes S: `src/dofile/**`, `pyproject.toml`, `uv.lock`, `README.md`, `LICENSE`, `web/package-lock.json`,
`web/wheels/*.whl`, `web/scripts/make-snapshot.ts`, `install-engine.ts`, `build-id.ts`, `web/src/engine/snapshot.ts`, and
`stage.ts` only if S9/R5 make it matter to S) and `check` (the rest the snapshot job reads: `tests/conformance`,
`tests_opendta`, `web/src/engine/`, `check-snapshot.ts`, `snapshot-node.ts`, the two tests and `harness.ts`,
`web/package.json`, `web.yml`). Readers, in shell, so the `changes` job needs no Node: `git diff --name-only
"origin/$BASE...HEAD" -- <both sections>` for ENGINE, and `git ls-files -- <build section> | xargs sha256sum | sha256sum`
for the key (an output of a first step in build-web, then `actions/cache`'s `key:`). A unit test (new, small) fails when a
relative import of `make-snapshot.ts` (and its imports, one level) is in neither section: drift ends there, not in a review. A second test: every pathspec matches at least one tracked file (a typo matches nothing and `git ls-files` still succeeds, giving a weaker key silently).
Against: `hashFiles` is what GitHub documents for keys and a shell hash of tracked files is ours to keep right; the key is also
more exact (tracked files only: a file the runner generates cannot change it). The `web.yml:57` "code" pattern and
`preview.yml`'s `paths` list are different questions (what needs the tests; what changes the build) and stay as they are.

**Staleness afterwards.** One function per record, one message each. Today only S is told. After R5: `staged()` (the new
`stage.json`) and `staleness()` (S's manifest) both compare with `inputs()`; build-web's step 3 can only fail with a reason that
names its fix. S9 puts the snapshot's other knobs (quality, no-mpl, ...) in the manifest; that stays S9's and the plan's
(`web-audit-plan.md` section 4), not here.

## 4. Changes R5 makes (so the sections above can be checked)

This note reads pre-S9 code (S9 comes first: `scripts/lib`, the config split into plugin modules, `wheel` no longer deleting old
wheels). R5's builder re-maps every `vite.config.ts`, `build-id.ts` and `wheel` line reference below at the start. Once `wheel`
stops deleting `dist/dofile-*.whl`, "the newest by `sort().at(-1)`" (`build-id.ts:31`) may pick a release wheel, so S9's
`wheels()` must return the wheel just built.

`scripts/stage.ts` (new), `snapshot-inputs.txt` (new) with its test; `build-id.ts` (`staged()`); `vite.config.ts` loses
the copies (`:54-68`), makes `inputs()` lazy (`:47-49`) and the editor's `build` and `serve` check `staged()` instead; `package.json` (table in section 3); `web.yml:50` (the `.md` filter at `:56` stays unless the new `git diff -- <pathspecs>` replaces it; while it stays, a README-only change does not run the snapshot job though README goes into the wheel: say which, and drop README.md from the drift claim if it stays) and
`action.yml:28-44,53` (read the table; the action runs `stage`, then (the cache-hit check with `build-id.ts`, else) `snapshot:make`, then `build:vite` and `check-sizes.ts`: the wheel is built once, by `stage`, never again); `.gitignore` (`public/stage.json`);
`web/CLAUDE.md`, `web/README.md` (scripts table; `public/` row; the ENGINE description at `README.md:164`), `docs/deploying.md` (the build-web line),
`docs/test-map.md` if a test file is added. Checked by: `npm test`, `npm run e2e` (all four projects: one build per job now), and
two things nobody has checked: **the wheel is byte-identical across two builds** (the first acceptance step of R5: `sha256` of
two `npm run wheel`; build-web's cache-hit path already relies on it, see section 2; a hash that differs would already make `npm run snapshot` followed by `npm run build` stale today), and a local `npm run deploy` dry run (`wrangler deploy --dry-run`) shows no second wheel in
`dist/app/`.

## 5. For the maintainer

| # | Choice | Recommendation | Against |
|---|---|---|---|
| 1 | `stage` includes the wheel build (`wheel` then copy), or only copies | **includes it**: one command to type, and `stage.ts` still fails with the old "run `npm run wheel`" if called alone with no wheel | none beyond one more command to type for a hand-copied wheel (`node scripts/stage.ts` alone). `DOFILE_WHEEL_DIR` is read only by `test/harness.ts:15`; no staging path honors it today |
| 2 | the one table is a plain pathspec file read by shell, or a `.ts` module read by Node steps | **the pathspec file**: the `changes` job stays free of Node, and `build-id.ts` need not know CI | a second format next to `urls.ts`; the test above is what keeps it honest |
| 3 | `dev` stages at start only (above), or the config re-stages on a `stage.json` change | **at start only**: the same as today in effect, and no writer in the config | a dev server that outlives a wheel change needs a restart (it says so) |
| 4 | `preview` and the site build stop reading `public/` and `dist/` | **yes** | a preview of a folder no build wrote fails on the missing folder, not on the wheel: the clearer failure |
| 5 | `deploy` and `cf:dev` | **keep**, rebuilt on the same pieces | a third copy of the chain (build-web, `deploy`, `cf:dev`) remains; deleting `npm run deploy` is out of R5's scope (no workflow runs it; the docs name it) |

**Approved 2026-11-17** (the maintainer: "approve R5 recommendations with warn-only for 2a"): choices 1, 2, 4 and 5 as recommended. **Choice 3 is amended:** `dev` stages at start and also re-runs the read-only `staged()` check on each page load; a stale stage warns "restart npm run dev". No watcher, and no writer in the config.

Not verified: no build, snapshot or e2e was run for this note (G0 runs them elsewhere); the wheel's byte-identity (section 4);
that a bare `vite` is used by no one (only `web/CLAUDE.md` and `README.md` were read for it); `docs/deploying.md` beyond
its table. Report 10's other claims were not re-read for this note.
