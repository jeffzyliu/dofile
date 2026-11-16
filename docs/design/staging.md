# Staging `public/` (the R5 note)

Status: for the maintainer's approval before R5 (phase 2, item 2.15) starts. Written at f947053 from the code; where
report 10 (`docs/archive/web-audit-surveys/10-build-scripts.md`) and the code differ, the code is followed and the
difference is named. No code changes here.

## 1. What is staged, and who owns it today

Four kinds of file reach the editor's `public/` (all gitignored: `web/.gitignore`; `public/` itself is not in git):

| Staged file | Source | Written by | Today, when |
|---|---|---|---|
| the dofile wheel, `public/dofile-*.whl` | the newest `*.whl` in the repository's `dist/` (`npm run wheel` builds it) | `vite.config.ts:55-56` | every load of the config |
| extra wheels, `public/pyreadstat-*.whl` | `web/wheels/*.whl` (committed) | `vite.config.ts:57-58` | every load of the config |
| Pyodide's runtime, `public/pyodide/` (3 files, `RUNTIME_FILES`, `start-files.ts:14`) | `node_modules/pyodide/` | `vite.config.ts:63-68` | every load of the config |
| the snapshot, `public/snapshot/` (+ `manifest.json`) | built in Pyodide under Node | `scripts/make-snapshot.mjs` (`rmSync` of the folder first, then writes) | `npm run snapshot` |

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
| `snapshot` | `wheel`, `make-snapshot.mjs` | nothing: it reads W, X from `dist/`, `web/wheels/` (via `install-engine.ts`) and P from `node_modules` | S | the only writer of `public/snapshot/` |
| `check-snapshot` | `wheel`, `check-snapshot.mjs` | S, fresh (`:168-174`, rc 2 if stale); W, X from `dist/` | none | never reads staged W, X, P |
| `check-pytest`, `check-numeric` | `wheel`, the script | nothing | none | `installEngine` reads `dist/`, `web/wheels/` |
| `pretest` / `test` | `wheel`; `node --test` | nothing staged. `test/harness.ts:15-23` reads `dist/`, `web/wheels/`; `engine.test.ts:350`, `snapshot-native.test.ts` read `public/snapshot` and skip when it is missing or stale | none | 5 tests skip with no snapshot (G0's baseline) |
| `dev` | `wheel`, `build-id.ts --warn`, `together.ts dev`: two `vite` | W, X, P, S (S missing: the page says so; stale: a warning, the page "updated") | W, X, P (twice, racing) | serves `public/` at `/`; `devStartFiles()` (`:85`) lists `public/` and reads its manifest on every request |
| `build` | `wheel`, `vite build`, `vite build --mode site` | W, X, P, S fresh: the editor build copies all of `public/` into `dist/app/`, and `writeStartFiles` (`:362`) throws on a stale S; with no S it builds and the page fails "no snapshot in this build" | W, X, P (twice) | the site build needs only the wheel's file name (the landing page's version, `:138`) and `dist/app/start-files.json` |
| `build:local` | `DOFILE_URLS=local npm run build` | as `build` | as `build` | |
| `preview` | `together.ts preview`: two `vite preview` | nothing (serves `dist/`); needs the build made first | W, X, P (twice) | has no `wheel` step, yet fails without one in `dist/`: the config load only |
| `e2e` | `snapshot`, `build:local`, `playwright test` | as `build`; Playwright's two previews: nothing | W, X, P (twice in the build, twice per `webServer`) | `wheel` runs twice (report 10, F9) |
| `cf:dev` | `snapshot`, `build` with two localhost addresses, two `wrangler dev` | as `build` (S at quality 11: the quality-5 heap is refused by wrangler) | as `build` | `wheel` twice; wrangler reads `dist/` only |
| `deploy` | `lint:strict`, `snapshot`, `DOFILE_URLS=production npm run build`, `check-sizes.ts`, two `wrangler deploy` | as `build` | as `build` | `wheel` twice. A hand-made twin of build-web: no workflow runs it |
| `commands`, `sample`, `check`, `lint*`, `format`, `axe`... | | nothing | `src/` generated files | out of scope |
| `check-sizes.ts`, `smoke.ts`, `measure-startup.mjs` | | the built `dist/` (or the network) | none | read no staged file |

**Workflows and the action:**

| Where | Steps that touch staging | Needs staged |
|---|---|---|
| **deploy.yml** (`:54`, a push to `main`) | the `build-web` action, then `wrangler deploy` x2 | via the action: everything below. **This path comes first: a merge deploys.** |
| **build-web** (`action.yml:28`, `:33-44`, `:47-53`) | (1) `npm ci && npm run wheel`; (2) restore `web/public/snapshot` by a hash key (`:37`); on a hit, `node scripts/build-id.ts` says whether the cached S is of this wheel, else `npm run snapshot` (quality 11); (3) `npm run build && check-sizes.ts` | (3): W, X, P (staged by the config, so by the build itself), S (cache or built). The wheel is built **twice** (1, then inside `build`). A cache hit passes step 2 against wheel 1 and step 3 against wheel 2: it is safe only because the rebuilt wheel has the same bytes, and a difference fails the build (closed, never a stale deploy) |
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
no script is that. Today N7 would have to spell `npm run snapshot && npm run build:local` itself, wheel twice. With R5 it
calls one script (`e2e:prepare` in section 3), and its compare mode, in the checkout under test, calls the same one.

## 3. The design

**One writer.** `scripts/stage.ts` owns W, X, P; `make-snapshot.mjs` keeps S. Disjoint paths: stage never touches
`public/snapshot/`, snapshot never touches the rest, so build-web's cache of S stays valid across a stage. Stage:
(1) takes the inputs from `inputs()` (S9's `wheels()`), (2) deletes every `*.whl` and `public/pyodide/` in `public/` first
(this ends problem 2), (3) copies, (4) writes `public/stage.json`: the inputs record (`BuildInputs`: wheel name and hash, extra
wheels' hashes, Pyodide version). That file follows the precedent of S's `manifest.json`: Vite copies it, and the build
removes it from `dist/app/` in the same `closeBundle` that removes the manifest (`start-files.ts:105`).

**The config only reads.** A `staged()` function, next to `staleness()` in `build-id.ts`, compares `stage.json` with
`inputs()` and returns the reason or null, in the words `staleness()` uses ("the staged files are stale: the dofile wheel
differs ...; run `npm run stage`"). The editor's `build` and `serve` check it and throw; **`preview` and the site build do
not look at `public/` at all** (the landing page's version comes from the wheel's name, via `inputs()`; if S9 wants none of
`dist/` there, `stage.json` carries the name). A site build or a preview made without a wheel then works. Cost: the dev server
checks once at start, not per request. "Stale" has then four named states, each with its fix: staged (`npm run stage`),
snapshot (`npm run snapshot`), page (reload), dev server (restart).

**Entry points call stage once.** `stage` = `npm run wheel` then `node scripts/stage.ts`. The user-facing scripts keep their
names and effects, but compose raw steps, so `wheel` runs once:

| Script after R5 | Runs |
|---|---|
| `stage` | `wheel`, `stage.ts` |
| `snapshot` | `wheel`, `make-snapshot` (S does not need a stage; keeping `wheel` only) |
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
the checks' own files (`check-snapshot.mjs`, `snapshot-node.ts`), which the key rightly lacks. A script `make-snapshot.mjs` starts to import is in neither unless someone remembers (`make-snapshot.mjs`
imports `src/engine/snapshot.ts`, `build-id.ts`, `install-engine.ts`; the key names all three by file, the regex names
the last two by file and `snapshot.ts` only through the directory `web/src/engine/`). The one table: `web/scripts/snapshot-inputs.txt`, git pathspecs one per line, in two
sections: `build` (what makes S: `src/dofile/**`, `pyproject.toml`, `uv.lock`, `README.md`, `LICENSE`, `web/package-lock.json`,
`web/wheels/*.whl`, `web/scripts/make-snapshot.mjs`, `install-engine.ts`, `build-id.ts`, `web/src/engine/snapshot.ts`, and
`stage.ts` only if S9/R5 make it matter to S) and `check` (the rest the snapshot job reads: `tests/conformance`,
`tests_opendta`, `web/src/engine/`, `check-snapshot.mjs`, `snapshot-node.ts`, the two tests and `harness.ts`,
`web/package.json`, `web.yml`). Readers, in shell, so the `changes` job needs no Node: `git diff --name-only
"origin/$BASE...HEAD" -- <both sections>` for ENGINE, and `git ls-files -- <build section> | xargs sha256sum | sha256sum`
for the key (an output of a first step in build-web, then `actions/cache`'s `key:`). A unit test (new, small) fails when a
relative import of `make-snapshot.mjs` (and its imports, one level) is in neither section: drift ends there, not in a review.
Against: `hashFiles` is what GitHub documents for keys and a shell hash of tracked files is ours to keep right; the key is also
more exact (tracked files only: a file the runner generates cannot change it). The `web.yml:57` "code" pattern and
`preview.yml`'s `paths` list are different questions (what needs the tests; what changes the build) and stay as they are.

**Staleness afterwards.** One function per record, one message each. Today only S is told. After R5: `staged()` (the new
`stage.json`) and `staleness()` (S's manifest) both compare with `inputs()`; build-web's step 3 can only fail with a reason that
names its fix. S9 puts the snapshot's other knobs (quality, no-mpl, ...) in the manifest; that stays S9's and the plan's
(`web-audit-plan.md` section 4), not here.

## 4. Changes R5 makes (so the sections above can be checked)

`scripts/stage.ts` (new), `snapshot-inputs.txt` (new) with its test; `build-id.ts` (`staged()`); `vite.config.ts` loses
`:47-68` and the editor's `build` and `serve` check instead; `package.json` (table in section 3); `web.yml:50` and
`action.yml:28-44,53` (read the table; one `stage` step; no second `wheel`); `.gitignore` (`public/stage.json`);
`web/CLAUDE.md`, `web/README.md` (scripts table; `public/` row), `docs/deploying.md` (the build-web line),
`docs/test-map.md` if a test file is added. Checked by: `npm test`, `npm run e2e` (all four projects: one build per job now), and
two things nobody has checked: **the wheel is byte-identical across two builds** (the first acceptance step of R5: `sha256` of
two `npm run wheel`; build-web's cache-hit path already relies on it, see section 2; a hash that differs would already make `npm run snapshot` followed by `npm run build` stale today), and a local `npm run deploy` dry run (`wrangler deploy --dry-run`) shows no second wheel in
`dist/app/`.

## 5. For the maintainer

| # | Choice | Recommendation | Against |
|---|---|---|---|
| 1 | `stage` includes the wheel build (`wheel` then copy), or only copies | **includes it**: one command to type, and `stage.ts` still fails with the old "run `npm run wheel`" if called alone with no wheel | a hand-built wheel (a changed `DOFILE_WHEEL_DIR`, say) is staged only by calling `node scripts/stage.ts` directly |
| 2 | the one table is a plain pathspec file read by shell, or a `.ts` module read by Node steps | **the pathspec file**: the `changes` job stays free of Node, and `build-id.ts` need not know CI | a second format next to `urls.ts`; the test above is what keeps it honest |
| 3 | `dev` stages at start only (above), or the config re-stages on a `stage.json` change | **at start only**: the same as today in effect, and no writer in the config | a dev server that outlives a wheel change needs a restart (it says so) |
| 4 | `preview` and the site build stop reading `public/` and `dist/` | **yes** | a preview of a folder no build wrote fails on the missing folder, not on the wheel: the clearer failure |
| 5 | `deploy` and `cf:dev` | **keep**, rebuilt on the same pieces | a third copy of the chain (build-web, `deploy`, `cf:dev`) remains; deleting `npm run deploy` is out of R5's scope (no workflow runs it; the docs name it) |

Not verified: no build, snapshot or e2e was run for this note (G0 runs them elsewhere); the wheel's byte-identity (section 4);
that a bare `vite` is used by no one (only `web/CLAUDE.md` and `README.md` were read for it); `docs/deploying.md` beyond
its table. Report 10's other claims were not re-read for this note.
