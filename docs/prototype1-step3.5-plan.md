# Prototype 1, step 3.5: the engine code, made clear and auditable

The task proposal the maintainer approved on 2026-11-10, after reading the engine's data flow
([web-engine-data-flow.md](web-engine-data-flow.md)). It sits between step 3 (the app shell) and step 4 of
[prototype1-plan.md](prototype1-plan.md). Update the status table here at the end of every session.

To pick up: read this file, then `web/CLAUDE.md`, then `web-engine-data-flow.md` (how the code works **before** this
step; Part 3 lists the problems this step answers), then run `git status` and `git log --oneline -5` in the worktree.

## Why

The maintainer's standards for this code: **clarity, auditability, testability.** It is core code and must be robust
and plainly so. Today:

- The page mixes TypeScript (`.tsx` views) and JavaScript with JSDoc types (the controllers and `engine/`).
- The engine's state is spread over three files (`engine/client.js`, `app/engine.js`, `app/run.js`), each with its own
  flags and counters (`gen`, `errorRestarts`, `attempt`, `lockGen`, `downloading`, `taking`, `was`, `queued`). The
  states of SPEC section 5 are rebuilt from events; no file holds the transitions. The maintainer cannot follow it.
- Several rules hold only because a comment says so (the table in step C below).
- Three files each say what "the current build" is (`start-files.json`, the snapshot's `manifest.json`, the wheel hash
  compiled into the page), and three places compare different pairs of them.
- A page change reaches the worker's `/work` two ways (a message with a seq, and a bulk copy of the store), kept from
  doubling by a high-water mark (`upTo`).

## Where the work is

- Worktree `.claude/worktrees/agent-adc4512780de518ed`, branch `prototype1-step3`. Step 3 is committed there as a
  checkpoint and **is not merged**. Nothing merges into `main` until the maintainer approves step 3 and step 3.5.
- Work on that branch, one commit per step below, so each step is a diff the maintainer can review. Agents do not
  commit unless told to. No attribution lines in commit messages.
- Do not change what the step 4 parts rely on without saying so: SPEC section 8 ("As built in step 3") and the header
  of `web/src/app/App.tsx`. Where a name or a signature must change, update both in the same commit and list it in the
  step's report.

## Decisions (2026-11-10)

1. **TypeScript everywhere.** Node 26 (local and CI) runs `.ts` files as they are; checked with a `.ts` test under
   `node --test`. The Node tests keep running the real modules with no build step.
2. **One explicit state machine in one file**, with TypeScript types for the states, events, stages and error kinds.
3. **`start-files.json` stays** and becomes the one statement of the build. The worker stops fetching
   `snapshot/manifest.json` at start; the page gives it the build's identity.
4. **No offline start.** It does not work today (the worker needs the network) and is not built now. If it is wanted
   later, a PWA (a service worker) is the likely way. A failed download ends as `failed`; it no longer goes on to a
   start.
5. **The journal is the only channel** from the page's file changes to `/work` (the simpler design below).
6. **A run's changes are found by modification time alone.** The size comparison is dropped; the wait before each run
   (until the clock is past the newest file) stays, since it is what makes the time enough.
7. The IndexedDB code may stay detailed, as long as it is tested thoroughly against an in-memory database
   (`fake-indexeddb`, which the tests use already). Simpler is better.

## Steps

Status values: `not started`, `running`, `to review`, `done`.

| Step | Work | Status |
|---|---|---|
| 0 | Checkpoint: step 3 committed on `prototype1-step3` | done |
| A | Convert to TypeScript, no behaviour change | not started |
| B | One build identity; no offline; a failed download is `failed` | not started |
| C | The state machine in one file; the contracts enforced | not started |
| D | The journal as the only channel; mtime only | not started |
| E | Docs: SPEC sections 5 to 8, `web/CLAUDE.md`, `web-engine-data-flow.md` revised to the code as built | not started |

Run A first and alone (it touches every file). B, C and D in that order: each is smaller after the one before. After
each step: `npm run check`, `npm test`, `SNAPSHOT_QUALITY=5 npm run e2e` (the counts before this step: 144 tests; e2e 74
passed, 22 skipped), then a review in a fresh context.

### A. TypeScript

- `web/src/engine/*.js`, `web/src/app/*.js`, `web/src/app/editor/commands.js` and `web/test/*.mjs` become `.ts`. The
  JSDoc `@typedef` and `@param` types become real annotations. `engine/types.d.ts` and `app/types.d.ts` become ordinary
  modules that export their types. The build scripts in `web/scripts/` stay `.mjs` (they are not page code), except
  where a test imports one.
- Node runs `.ts` by removing the types, so: imports spell the `.ts` extension; only syntax that can be erased (no
  `enum`, no `namespace`, no constructor parameter properties). Set `erasableSyntaxOnly`, `verbatimModuleSyntax` and
  `allowImportingTsExtensions` in `tsconfig.json` so `npm run check` enforces it, and include `test/` in the check.
- `.tsx` cannot run in Node. That is fine: the tests load only controllers and `engine/`. Keep it so (no controller
  imports a `.tsx`).
- The worker is `new Worker(new URL("./engine/worker.ts", import.meta.url))`; `test/node-worker.mjs` runs the same
  file in a worker thread. Check both, and that `vite.config.ts` still builds the worker as one file.
- No behaviour change, no renames beyond the extension, no refactor. The diff should read as types added.
- Done when: the three checks pass with the same counts, and `grep -r "@typedef\|@param\|@type" web/src` finds nothing
  that an annotation could say.

### B. One build identity, no offline

- Today: `client.cached()` and `download()` read `start-files.json` (`built`, `wheelHash`, the files with sizes); the
  worker fetches `snapshot/manifest.json` itself, fresh, and compares its `wheel` and `wheelHash` with what the page
  has. Wanted: the page reads the one list and passes what the worker needs (the build id, the two snapshot files'
  names and sizes) in `mount`'s arguments. The worker fetches no manifest at start. Check what `scripts/start-files.mjs`
  must add to the list for that, and keep `manifest.json` only if the build scripts need it.
- One function compares the page's build with the list's (the wheel hash), in one place, and gives `updated`.
- A download that fails (not "Stop download", not `updated`) is `failed` with reason `download`. `start()` is not
  called after it. Remove the comments and the SPEC section 6 text that promise an offline start.
- Keep: `cached()` deciding whether to ask, `forgetDownload()` on `failed-twice`, the byte-count check of each file.
- Done when: a test shows the worker starts with no request for `manifest.json`; the stale-snapshot test still gives
  reason `updated`; a failed download gives `failed` with no worker created.

### C. The state machine

One file (suggested: `web/src/engine/machine.ts`) holds all of it:

- `State`: the section 5 states as a discriminated union, each with only its own fields.
- `Event`: everything that can happen, as a union: the visitor's actions (start, decline, stop download, run, break,
  keep waiting, reset, take over), the tab lock's answers, download progress and its end, the worker's messages (stage,
  started, run ended, crashed), the Break timer.
- `transition(state, event): { state, effects }`: a **pure** function. No timers, no worker, no signals, no `Date.now()`
  (the time comes in the event). An event that is not valid in a state returns the state unchanged, in one visible
  place.
- `Effect`: what the caller must then do, as a union (create a worker, end it, send an op, start or cancel the Break
  timer, clear what the old engine left, add the reset banner, say a line, delete the cache).
- **One guard for stale answers.** Each worker has a number; every event from a worker carries it; the transition
  function drops an event whose number is not the current worker's. This replaces `gen`, `attempt`, `lockGen`,
  `downloading === ac`, `taking` and the `worker !== this.worker` checks. A download and a take-over get the same
  treatment (a number in the state).
- The crash count ("failed twice") is state, not a field of the client.

Around it:

- `client.ts` shrinks to transport: create and end the worker, numbered calls, the interrupt buffer. No lifecycle
  decisions, no `restart()` that resolves pending calls with another promise.
- The controller (`app/engine.ts`) feeds events in, carries effects out, and writes the `engine` signal from `State`.
  `app/run.ts` keeps the log and the run's results; it no longer infers a new engine from state names.
- Tests: a table test of `transition` over every state and every event (the pairs that change nothing included), and
  the scenarios the reviews found as races, each as a short list of events: a reset during a start, the lock lost
  during a download, a crash while starting, two take-overs, Break then the result arriving, a second crash.

The contracts that hold by comment today, and what enforces each after this step:

| Today | After |
|---|---|
| `onRestart` must be called before the cut run's promise resolves | one event gives the run's cut result and the new state together |
| `run.js` learns of a new engine by comparing state names (`starting`, `other-tab`) | an explicit effect, "the engine was replaced" |
| A start-up stage is found by matching the worker's English status text (`STAGE_OF`) | the worker sends a typed stage id |
| Each signal has one writer | `state.ts` exports signals read-only (`ReadonlySignal`); only the owner module holds the setter |
| Views never call the client | the client is created in one module that views do not import; a test over the import graph checks it |
| Every error kind and every state is handled | discriminated unions and exhaustive `switch`es (`never`): a missed case fails `npm run check` |
| The worker protocol's ops and answers match on both sides | one typed map of ops, used by `client.ts` and `worker.ts` |
| `decline()` and the other actions are safe in any state | every action is an event; the transition function decides |

Done when: the checks pass; SPEC section 5's table and the transition function agree (a test builds one from the
other, or a reviewer checks them side by side); no counter or flag outside the machine decides a state.

### D. The journal as the only channel

How it works today: a page change writes the store and a `pending` row (a seq) in one transaction, then posts the op
with that seq to the worker, which applies it to `/work` and deletes the row. The worker also copies the store in bulk
(at `mount`, and after each run), which covers every change up to the highest seq then (`upTo`); a posted op at or
below `upTo` is skipped. So one change can arrive two ways, and `upTo` keeps it from applying twice.

Wanted: one way.

- A page change writes the store and a `pending` row, as now, then posts only `sync` (no arguments, no bytes).
- `sync` in the worker: in one transaction read the `pending` rows, take the store's version of those paths, clear the
  journal; then put that version into `/work`. This is what `applyRun([])` with `takePageVersion` does today as the
  error fallback of `mirror()`.
- After a run, `applyRun(changes)` does the same in the transaction that writes the run's files, as now.
- Removed: the `write`, `mkdir`, `remove` and `rename` ops, `mirror()`, `upTo`, the seq passed in messages, "each op is
  safe to apply twice", `MirrorError`, and the dependence on messages arriving in seq order.
- Cost, accepted: a large upload is read back from IndexedDB by the worker (one more copy), and a renamed folder is
  copied again where today it is renamed in place.
- Change detection after a run: modification time only. Remove the size comparison in `saveRun`; keep the wait before
  the run and say in one comment why it is enough.
- Tests (against `fake-indexeddb`): each kind of change alone; changes made during a run (the page's version wins;
  `skipped`); a change made with no worker, then a start; a `sync` when the journal is empty; the store closed by the
  browser; a run's write the store refuses (`unsaved`), then the next run.

Done when: the checks pass; `grep -n "upTo\|mirror" web/src/engine` finds nothing; SPEC section 7 describes the one
path.

### E. Docs

- SPEC sections 5 (states), 6 (protocol and types), 7 (the store) and 8 (as built) say what the code does.
- `web/CLAUDE.md`: TypeScript everywhere, the machine's file, the one journal path, no `manifest.json` fetch.
- `docs/web-engine-data-flow.md` is revised to the code as built, and its Part 3 keeps only what is still open.
- `docs/prototype1-plan.md`: step 3.5 `done`; next is the maintainer's approval and the merge, then step 4.

## Carried over, not part of this step

- The failed states show nothing yet (`states/banners.tsx` is step 4d's placeholder), so a failed start is seen only
  as "Stopped" on Run. Step 4d builds the banners.
- At load, while `cached()` is pending, the state is `none`; a Run pressed then opens the "to run code" prompt, which
  the plain prompt then replaces. Step C's machine should make this a state of its own (checking) or queue the run.
- `afterRun` lists the store after the tab lost the lock. Step C.
- Real-phone checks, the phone's "FILES" pane head (step 4a) and the toolbar at a 20 px font: in `prototype1-plan.md`.
