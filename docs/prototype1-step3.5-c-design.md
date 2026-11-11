# Prototype 1, step 3.5 C: the engine state machine (design)

The design of step C of [prototype1-step3.5-plan.md](prototype1-step3.5-plan.md): one explicit state machine for the web
demo's engine, in one file, with the contracts around it enforced by the compiler or by a test. The diagrams drawn from
it are in [prototype1-step3.5-c-diagrams.md](prototype1-step3.5-c-diagrams.md); the two documents use the same names and
the same table cells.

- **Status:** approved by the maintainer on 2026-11-11, with the five additions listed under "Decisions".
- **Date:** 2026-11-10, revised 2026-11-11.
- **Paths** are relative to the repository root. A citation such as `web/src/engine/client.ts:268-356` is to the code
  at commit a11033d (step B2), which is what step C starts from.
- **Scope:** documents only. Step C's code follows this design and was built in commit 22b614e; step D changed the file ops (marked where they appear); step E made SPEC section 5's transition table the machine's matrix, which `web/test/machine.test.ts` compares with it.

Contents: Decisions; 1 State; 2 Event; 3 Effect; 4 The transition tables; 5 The stale guard and the tickets;
6 The contracts, enforced; 7 Module boundaries (7.4 Single instances); 8 Race scenarios; 9 What changes for step 4;
10 Still open.

---

## Decisions

**The maintainer's rulings** (final):

| # | Ruling | Where |
|---|---|---|
| 1 | `transition` takes a `Machine`: the state, the issuing counter, the crash count and the fixed environment. | item 1 |
| 2 | The crash count keeps today's behaviour: it survives a failed start and "Try again". | item 1, scenario 6 |
| 3 | The signal shows the page load as states of its own (`checking-lock`, `checking-cache`), not as `none`. | items 1, 9 |
| 4 | Run pressed during the page load (`checking-lock`, `checking-cache`) is refused. | table E |
| 5 | The machine starts a queued run itself, in the `started` cell (`starting-worker` to `running`). | table D |
| 6 | The Node tests that drive a real worker get a small helper in `web/test/harness.ts`. | item 7 |
| 7 | `cached()`, `download()` and `forgetDownload()` stay in `web/src/engine/client.ts`. | item 7 |
| 8 | Single-owner signals are exported as `ReadonlySignal`, with one writer object per owner, checked by the import test. | item 6 |
| 9 | Every exit from `breaking` cancels the Break timer, and a property test says so. | item 5 |
| 10 | In step E, SPEC section 5's transition table is replaced by the matrix the machine test builds; the test compares the two. | item 6 |
| 11 | The `about` signal is dropped in step C. What views show of it becomes a build-time constant. | item 9 |
| 12 | One set of state names: the `engine` signal has the machine's sixteen tags, and `view(state)` maps no names. | items 1, 9 |

**Hand-written, not a library** (the maintainer's ruling, 2026-11-11). XState 5 and 6 and the smaller state machine
libraries were evaluated before any code was written. XState's runtime drops a stopped actor's late reply without a
ticket, but its pure transition function accepts the same stale event, the drop leaves no record, and the worker would
need a compound state, so views would no longer see sixteen flat names. The machine stays as designed here. Five
additions came out of that evaluation:

| # | Addition | Where |
|---|---|---|
| A1 | Every exit from `downloading` that is not that download's own end aborts it, and a property test says so. | item 6 |
| A2 | A `reply` of an earlier wiring does nothing: it captures its wiring and compares it before it enqueues. | items 5.1, 7.1, 7.4 |
| A3 | `run()` called while a step is in progress throws, before it enqueues anything. | item 7.1 |
| A4 | A controller test with a simulated clock pins the Break timer across two runs on one worker. | items 5.2, 7.1 |
| A5 | `EngineState` is written out by hand; no text calls it derived. | item 9 |

Where SPEC section 5 and the code disagreed (before step E, which made SPEC section 5 say what the machine does), the machine followed the code in three places: Run in `none` queues the run
and asks; Reset acts only in `ready`, `running`, `breaking` and `waiting`; the reset banner is added only when the engine
being replaced had been ready.

**Break and the run's return code** (the maintainer's ruling; detail in item 4.3):

- **After Break, the run's result stands as the engine gave it.** The engine takes a Break only between commands, never
  inside one, because the engine in the browser cannot roll a half-done command back. So the result is rc 1 when the
  engine took the Break at a safe point, and the run's own rc (0, or a Stata error) when the run had ended before one.
  `transition` rewrites nothing.
- **A Break whose grace time runs out stays rc 9998, kind `break`.** rc 1 means "Break, the data kept"; rc 9998 means
  "the session was reset, the data is gone", the same meaning as in the CLI and the MCP server.

**Answers to the questions** (recommendations, built into this design):

| Question | Answer | Main alternative, and why not |
|---|---|---|
| A. The right ticket on every event | A `Ticket` is a branded type that only the machine can make. A performer never writes one: it gets a `reply` function bound to its effect's ticket and typed to the events that effect may be answered with. Every event that changes nothing is recorded, and the tests assert the record (item 5). | A branded type per kind (`WorkerNo`, `DownloadNo`): with bound replies a performer cannot choose a ticket at all, so the kinds add types and no safety. |
| B. Operations outside the machine | The op map is three sets: `LifecycleOps`, `ReadOps`, `JournalOps` (since step D the one op `sync`). The transport's `query` takes only `ReadOps`; the lifecycle ops leave the transport only through its `Lifecycle` interface, which only the effect performer holds. The compiler proves who can send what; that a read op changes nothing is declared and tested, not proved (item 7.2). A read op with no worker is rejected with kind `no-engine`; during a run it waits in the worker's queue, as today. | Reject a read op during a run with a new kind: the worker's queue already gives the right answer (the data as the run left it), and every view would have to ask again. |
| C. Does a failed save reach the machine? | Only one does, as today: the browser closing the database, as `crashed` with cause `storage`, because its remedy is a new worker. Every other store failure stays with the caller, the run's result or the transport; the machine has no event for it (item 7.3). | A `save-failed` event and a flag in the state: no transition would read it. |
| D. Should `break` and `keep-waiting` move to `web/src/app/run.ts`? | No: one machine. The run's events are grouped in one table (table E), which reads as the run's own small machine (item 4.4). | A second machine nested under `ready`: every engine event during a run (a crash, a reset, the lock lost) would need a protocol between the two, with an order to keep, which is the kind of contract this step removes. |
| The list fetch in a snapshot start | The machine owns it as a step of a restart, with a ticket: the state `starting-list`, the effect `fetch-list`, the events `list-checked` and `list-failed`. A start the visitor begins reuses the list `download()` has just checked. The transport's `start` has no hidden `await` (items 1, 4). | Keep the fetch inside the transport's `start`: the transport would then decide, after an `await`, whether to make a worker, with its own counter. |
| The name of the branded type | `Ticket`: the machine issues one for each asynchronous request, a state holds at most one, an answer presents it. The field on events and effects stays `n`; `ticketOf(state)` gives a state's ticket (item 5). | `Num`: it reads as a general number type. |
| How the table's rows are named | Each row is one member of `State` with its own literal tag `s`: sixteen tags, so `RowName` is `State["s"]`, computed, and no function maps a state to a row. Three states that SPEC section 5 names once have two tags each (`checking-lock`, `checking-cache`; `starting-list`, `starting-worker`; `other-tab-idle`, `other-tab-taking`) (items 1, 4.2). | One tag `s` and a sub-tag `phase`: the row's name must then be put together from two fields, by a template type and a function with a cast of its own. |
| What views see | The same sixteen tags. `EngineState` is written out, one line per state, without the tickets and the queued run, with `forRun` and `message` added. Three compiler checks keep it in step with `State`: the same tags, no ticket or queued run in any field, and `view(state)`, one exhaustive `switch` with no cast (item 1). | A second set of names for views (SPEC's thirteen and `checking`): every reader would need the mapping, and SPEC's table could not be compared with the machine's directly. |
| Can the counter be forged? | No. `Machine.issued` is a `Ticket`, the last one issued. One private function, `mint()`, holds the only cast in `web/`; `initial()` issues ticket 1, so the counter has no zero. Tests get every machine by driving `initial()` with events, and every ticket from an effect (items 1, 5.1). | A test-only builder of machines: it would be a second way to make a ticket. |
| Is the `Answers` map checked? | Yes, both ways, by the compiler: one row for each effect with a ticket (`never` for those that are not answered) and no other row; only events with a ticket; every such event under exactly one effect (item 3). | A map that is only written: a misspelt row would pass. |
| A cast in `reply`? | None. An answer's type is taken from the union of all answers without a ticket, so adding the ticket type-checks as it stands. `reply` is not single-use (item 5.1). | A cast to the effect's own answers: it does not compile for a generic effect without going through `unknown`. |
| One provider of read ops | The controller's exported `call`. `run.ts` and the views are both its callers. "Show 50 more" moves into `run.ts` (`moreRows()`), so `rows` has one writer and is read-only like the others; views call only `matrix` and `describe_file` (item 7.2). | Leave the append to step 4c: the two-writer exception and its identity check would stay in a view. |
| The wording of the `end-run` property | "A transition from `running`, `breaking` or `waiting` to a state that is none of those three has exactly one `end-run`, as its last effect. No other transition has one." (item 6) | |
| `Ending` and `CutKind` | Two types. `Ending` says why a worker is ended: `reset`, `stopped`, `failed`, `failed-twice`. `CutKind` is the `kind` of an rc 9998 run result: `break`, `crash`, `user`, `stopped`, `run-failed` (item 3). | |
| Who calls `initial()` | `open()` in `web/src/app/engine.ts`, and it performs the first effect through the same function that `dispatch` uses (item 7). | |
| Where `lock-lost` is valid | In every state except `other-tab-idle`. In `checking-lock` and `other-tab-taking` it cancels the lock request in progress, so the late answer is stale (table B). | |
| Are single instances enforced? | Yes, where it matters, without singleton classes. `web/src/main.tsx` is the only module that constructs or connects, by a source-text test. One live worker per tab is a property of the table and a runtime check in the transport: `start` with a worker still live throws (item 7.4). | Private constructors and `getInstance`: the Node tests make many transports and machines, and must be able to. |
| Effect lists in the scenarios | Every scenario lists every effect of every step, in order (item 8). | |
| Who performs `own-files` and `block-store` | `web/src/app/files.ts` performs them (`own()`, `block()`). The cache check is its own effect, `check-cache`, performed on the transport (item 3). | |

---

## 1. `State`

```ts
// web/src/engine/types.ts. Stage, FailReason and RunHead move here from web/src/app/types.ts (which re-exports them),
// so that engine/ never imports app/.
export type Stage = "download" | "unpack" | "python" | "files" | "packages" | "engine";
export type FailReason = "no-wasm" | "download" | "memory" | "updated" | "unknown";
export interface RunHead { kind: "file" | "selection" | "command"; path?: string; lines?: [number, number]; fresh_locals: boolean }
/** What `mount` needs of the build's list for a snapshot start. null: the normal start (?snapshot=0). */
export type Build = { built: number; files: SnapshotFiles };

// web/src/engine/machine.ts
declare const brand: unique symbol;
/** The number of one asynchronous request. The machine issues it, a state holds at most one, an answer presents it.
 *  Only mint() in this file makes one; all other code copies it from an effect, a state or a machine. */
export type Ticket = number & { readonly [brand]: true };
/** THE ONE CAST that makes a ticket. Not exported. */
const mint = (n: number): Ticket => n as Ticket;
/** The next ticket of a machine: every new ticket is issued + 1. */
const issue = (m: Machine): Ticket => mint(m.issued + 1);

export interface Env {            // fixed at load; given once to initial()
  snapshot: boolean;              // the snapshot start: the first stage is "download" (a cache read), else "python"
  canInterrupt: boolean;          // SharedArrayBuffer exists; without it Break resets at once
  graceMs: number;                // 5000: how long Break waits before the engine is reset
  engineBytes: number | null;     // the total shown before the first progress event
  manual: boolean;                // ?test=manual: no start until start() is called
}
export interface QueuedRun { code: string; head: RunHead }

/** Sixteen members, one per row of the transition table. Each has its own literal tag and only its own fields. */
export type State =
  | { s: "checking-lock"; id: Ticket }
  | { s: "checking-cache"; id: Ticket }
  | { s: "none" }
  | { s: "asking"; queued: QueuedRun | null }
  | { s: "declined" }
  | { s: "downloading"; download: Ticket; received: number; total: number; t0: number; queued: QueuedRun | null }
  | { s: "starting-list"; worker: Ticket; stage: Stage; t0: number; done: Partial<Record<Stage, number>>; queued: QueuedRun | null }
  | { s: "starting-worker"; worker: Ticket; stage: Stage; t0: number; done: Partial<Record<Stage, number>>; queued: QueuedRun | null }
  | { s: "ready"; worker: Ticket }
  | { s: "running"; worker: Ticket; run: RunHead; t0: number }
  | { s: "breaking"; worker: Ticket; run: RunHead; t0: number; resetAt: number }
  | { s: "waiting"; worker: Ticket; run: RunHead; t0: number }
  | { s: "failed"; reason: FailReason; detail: string }
  | { s: "failed-twice"; reason: FailReason; detail: string }
  | { s: "other-tab-idle" }
  | { s: "other-tab-taking"; take: Ticket };

/** The rows of the table are the tags of State: computed, never written out. */
export type RowName = State["s"];
/** One member of State, by its tag. */
export type StateOf<R extends RowName> = Extract<State, { s: R }>;

export interface Machine {
  readonly env: Env;
  readonly state: State;
  readonly issued: Ticket;        // the last ticket issued; a Ticket itself, so it cannot be written as a literal
  readonly crashes: 0 | 1;        // worker crashes since an engine was last ready
}
/** One step: the machine after it, what the caller must do, and whether the event did anything. */
export interface Step { machine: Machine; effects: Effect[]; outcome: "taken" | "stale" | "not-valid" }

export function initial(env: Env): Step {
  const first = mint(1);           // the first ticket: the counter never has a zero
  return { machine: { env, state: { s: "checking-lock", id: first }, issued: first, crashes: 0 },
    effects: [{ do: "take-lock", n: first, steal: false }], outcome: "taken" };
}
export function transition(machine: Machine, event: Event): Step
```

**Neither a ticket nor the counter can be forged.** `issued` is a `Ticket`, so `{ ...m, issued: 0 }` does not compile
anywhere, and a machine whose counter is below a ticket its state still holds, which would issue that ticket twice and
defeat the stale guard, cannot be written outside `machine.ts`. `mint()` is the one function with the cast; `issue()`
and `initial()` go through it. The rule is one: *a ticket, or a machine's counter, cannot be written as a literal
outside `mint()`*, and a source-text test holds it (`as Ticket` occurs once in the whole of `web/`). The property
tests add: no state holds a ticket greater than `issued`, and `issued` never goes down (item 6). How the tests get
machines without minting is in item 7.1.

**The rows are the tags.** Every member of `State` is told from the others by the literal `s` alone, so a row of the
transition table is a member of the union, and the table's row names are a type the compiler computes:

- `State["s"]` (an indexed access) is the union of all sixteen tags. `keyof State` is not: it gives only the keys that
  every member has, which is `"s"`.
- `Extract<State, { s: K }>` is the one member with tag `K`.

A new state cannot exist without a row: `TABLE` is `{ [R in RowName]: Row<R> }` (item 4.2), so adding a member to `State`
fails `npm run check` until its row is written. No function maps a state to its row, and no field is nullable to mark a
variant: `other-tab-idle` has no ticket at all.

**Why sixteen tags, not thirteen with a sub-tag.** Three things come in two forms: the page load (the lock, then the
cache check), a start (the list, then the worker) and another tab owning the files (idle, or a take-over in progress).
The alternative gives each one name in `s` (`checking`, `starting`, `other-tab`) and adds a literal `phase`. Then a
row's name must be put together from two fields: `RowName` becomes a template-literal type over the members, and
`row(state)` a function whose result TypeScript cannot check without a cast (the three names and the six phases
combine to eighteen strings, of which six are rows). With one tag for each row there is nothing to put together:
`RowName` is `State["s"]`, and the lookup is `TABLE[state.s]`. The signal uses the same sixteen tags (below), so
nothing maps one set of names to another.

The sixteen rows, always in this order: `checking-lock`, `checking-cache`, `none`, `asking`, `declined`, `downloading`,
`starting-list`, `starting-worker`, `ready`, `running`, `breaking`, `waiting`, `failed`, `failed-twice`,
`other-tab-idle`, `other-tab-taking`.

**Where the tickets live.** One counter, `Machine.issued`, issues every ticket, so no two requests ever have the same
one. A state holds at most one.

| Ticket of | Lives in |
|---|---|
| The page load's lock request | `checking-lock.id` |
| The cache check | `checking-cache.id` |
| A download | `downloading.download` |
| A start: the list fetch of a restart, then the worker it makes | `worker` of `starting-list`, `starting-worker`, `ready`, `running`, `breaking`, `waiting` |
| A take-over | `other-tab-taking.take` |

`issued` and `crashes` are outside the union because they outlive states. A queued run is in the field `queued`,
which is a different thing from the `run` of `running`, `breaking` and `waiting` (the head of the run in progress). The crash count survives a failed start on
purpose (`web/src/engine/client.ts:352`), so it must pass through `failed`, `declined`, `asking` and `downloading`.

**`starting-list` exists** because step B put an awaited step before the worker exists: a snapshot start fetches the
build's list first (`web/src/engine/client.ts:274-285`).

- `starting-list`: a restart is fetching the build's list, fresh. No worker exists yet; `worker` is the ticket the
  worker will have.
- `starting-worker`: worker `worker` exists and is starting.

A start the visitor begins never passes through `starting-list`: `download()` has just fetched and checked the list,
and `download-done` hands it on. A restart must fetch it again, because the Cache may have been evicted since the first
start, and the worker would then fetch the files of whatever build the site has now. Since step B2 the list of another
deploy is always `updated`, so a page that was open says "reload" at its next restart; that cost was accepted with B2.

**Mapping to SPEC section 5 as it is today.** Step E rewrites section 5 with these sixteen states.

| Machine and signal | Section 5 today | Difference and why |
|---|---|---|
| `checking-lock`, `checking-cache` | part of `none` | **Added (split).** The page load: waiting for the tab lock, then for the cache check. Today that time is `none` (`web/src/app/state.ts:22`, `web/src/app/engine.ts:77-88`), where Run opens a prompt. This is the plan's carried-over item. |
| `none` | `none` | Narrowed: only the rest state of `?test=manual` (`web/src/app/engine.ts:83-84`). |
| `asking` | `asking` | In the machine, `forRun` becomes `queued`, the queued run itself, moved in from `web/src/app/run.ts:23`. |
| `declined` | `declined` | The same. |
| `downloading` | `downloading` | Gains its ticket and the queued run. |
| `starting-list`, `starting-worker` | `starting` | **Split.** A restart fetches the build's list before a worker exists. |
| `ready`, `running`, `breaking`, `waiting` | the same | Gain the worker's ticket. |
| `failed`, `failed-twice` | the same | No `message` in the machine: `view` adds the visitor's words. |
| `other-tab-idle`, `other-tab-taking` | `other-tab` | **Split.** The second holds the take-over's ticket. |

**What views see: the same sixteen tags.** The `engine` signal holds an `EngineState`. It is written out, one line
per state, so that it can be read; three compiler checks keep it in step with `State`:

```ts
// web/src/app/types.ts
import type { Equal, Expect, QueuedRun, State, Ticket } from "../engine/machine.ts";

/** The engine's state as views see it: State's sixteen tags, without the tickets and without the queued run. */
export type EngineState =
  | { s: "checking-lock" }
  | { s: "checking-cache" }
  | { s: "none" }
  | { s: "asking"; forRun: boolean }                                          // forRun: a run is queued
  | { s: "declined" }
  | { s: "downloading"; received: number; total: number; t0: number }
  | { s: "starting-list"; stage: Stage; t0: number; done: Partial<Record<Stage, number>> }
  | { s: "starting-worker"; stage: Stage; t0: number; done: Partial<Record<Stage, number>> }
  | { s: "ready" }
  | { s: "running"; run: RunHead; t0: number }
  | { s: "breaking"; run: RunHead; t0: number; resetAt: number }
  | { s: "waiting"; run: RunHead; t0: number }
  | { s: "failed"; reason: FailReason; detail: string; message: string }      // message: the visitor's words
  | { s: "failed-twice"; reason: FailReason; detail: string; message: string }
  | { s: "other-tab-idle" }
  | { s: "other-tab-taking" };
export type EngineStateName = EngineState["s"];

// Check 1: the same tags as the machine's State. A state added to one and not the other does not compile.
type _sameTags = Expect<Equal<EngineState["s"], State["s"]>>;
// Check 2: no field of any member is a ticket or a queued run.
type FieldOf<T> = T extends unknown ? T[keyof T] : never;                     // the type of every field, over every member
type _nothingHidden = Expect<Equal<Extract<FieldOf<EngineState>, Ticket | QueuedRun>, never>>;
// Check 3 is view() below: its return type is EngineState, so each case must build exactly that member's fields.

// web/src/app/engine.ts: the one writer of the signal. It drops and adds fields; it maps no names.
function view(state: State): EngineState {
  switch (state.s) {
    case "checking-lock": case "checking-cache": case "none": case "declined": case "ready":
    case "other-tab-idle": case "other-tab-taking":
      return { s: state.s };
    case "asking": return { s: "asking", forRun: state.queued !== null };
    case "downloading": return { s: "downloading", received: state.received, total: state.total, t0: state.t0 };
    case "starting-list": case "starting-worker":
      return { s: state.s, stage: state.stage, t0: state.t0, done: state.done };
    case "running": case "waiting": return { s: state.s, run: state.run, t0: state.t0 };
    case "breaking": return { s: "breaking", run: state.run, t0: state.t0, resetAt: state.resetAt };
    case "failed": return { s: "failed", reason: state.reason, detail: state.detail, message: FAILED[state.reason] };
    case "failed-twice": return { s: "failed-twice", reason: state.reason, detail: state.detail, message: FAILED_TWICE };
  }
}
```

- `EngineState` is written by hand on purpose: a type computed from `State` says the same in three lines that few can
  read. The cost is that a field added to `State` is not seen by views until it is added here too, which is the safe
  way round: hidden unless shown.
- What the checks catch: a tag in one type and not the other (check 1); a ticket or a queued run in a view's state
  (check 2); a case of `view` that builds the wrong fields, a missing case, or `{ s: "ready", worker: … }` (check 3:
  the object does not fit the member). `web/test/machine.test.ts` keeps a `@ts-expect-error` line for each.
- `view` is an exhaustive `switch` with no cast.
- This type and this function were compiled as written, with a `stateWords` over the sixteen tags.

**Is there a reason to keep two sets of names?** None was found. SPEC section 5's table gives each of the three pairs the
same status words and the same Run and Break columns, so a view groups two `case`s where it had one. A name that is no
longer a state (`"starting"`, `"other-tab"`) fails `npm run check` wherever TypeScript compares it. The one place that
it cannot check is CSS: `web/src/styles/app.css:30` hides the Run controls by `[data-engine="other-tab"]` (item 9).

**The names `starting-list` and `starting-worker`** stay. They are not words the visitor reads: the status bar and the
dialog draw their words from the stage, and both tags give the same. Like `checking-lock` and `checking-cache`, each
says what the state is waiting for: the build's list, the worker. `restarting` was considered for the first and
rejected: it would read as the whole restart, of which it is only the beginning.

---

## 2. `Event`

```ts
type Happening =
  // the visitor's actions (no ticket)
  | { type: "start" } | { type: "ask" } | { type: "decline" } | { type: "stop-download" }
  | { type: "reset" } | { type: "take-over" }
  | { type: "run"; code: string; head: RunHead } | { type: "break" } | { type: "keep-waiting" }
  // the tab lock and the cache check
  | { type: "lock-answered"; n: Ticket; owned: boolean }
  | { type: "lock-lost" }
  | { type: "cache-checked"; n: Ticket; cached: boolean }
  // the download and the build's list
  | { type: "download-progress"; n: Ticket; received: number; total: number }
  | { type: "download-done"; n: Ticket; build: Build | null }
  | { type: "download-failed"; n: Ticket; reason: "download" | "updated"; detail: string }
  | { type: "list-checked"; n: Ticket; build: Build | null }
  | { type: "list-failed"; n: Ticket; reason: "download" | "updated" | "unknown"; detail: string }
  // the worker
  | { type: "stage"; n: Ticket; stage: Stage }
  | { type: "started"; n: Ticket }
  | { type: "start-failed"; n: Ticket; reason: "no-wasm" | "download" | "memory" | "unknown"; detail: string }
  | { type: "crashed"; n: Ticket; cause: "error" | "storage"; reason: "download" | "memory" | "unknown"; detail: string }
  // a run's answer, and the Break timer
  | { type: "run-ended"; n: Ticket; result: RunResult }
  | { type: "run-failed"; n: Ticket; message: string }
  | { type: "break-timeout"; n: Ticket };
export type Event = Happening & { at: number };   // at: Date.now(), stamped once, where the controller queues the event

/** The events that present a ticket, and those that do not. */
export type TicketedEvent = Extract<Happening, { n: Ticket }>;
export type PlainEvent = Exclude<Happening, { n: Ticket }>;
```

Twenty-four events. Fourteen present a ticket, in the field `n`, and pass through the stale guard (item 5); the nine
visitor events and `lock-lost` have none.

| Event | Raised by | `n` is the ticket of |
|---|---|---|
| `start`, `ask`, `decline`, `stop-download`, `reset`, `take-over`, `run`, `break`, `keep-waiting` | the actions of `web/src/app/engine.ts`, with today's names | none |
| `lock-answered` | the `take-lock` performer, from `lock.take()` (`web/src/engine/tab.ts:13-27`) | the lock request |
| `lock-lost` | `lost()`, the tab lock's `onLost` (`web/src/engine/tab.ts:23`, `web/src/main.tsx:56`) | none (item 5) |
| `cache-checked` | the `check-cache` performer, from `client.cached()` | the check |
| `download-progress`, `download-done`, `download-failed` | the `start-download` performer, from `client.download()`. An `AbortError` raises nothing. `download-done` also covers `download()` resolving `{cached: false}`. | the download |
| `list-checked`, `list-failed` | the `fetch-list` performer, from `client.build()`: the list fetched fresh and checked (`checkBuild`). The normal start has no list: it answers `list-checked` with `build: null` at once. | the start |
| `stage`, `started`, `start-failed`, `crashed` | the transport, through the `reply` it was given with `start-worker`. `start-failed`: a `mount`, `boot` or `startup` error, a worker that cannot be made, no WebAssembly. `crashed`: `worker.onerror` (cause `error`) or the store's `onClosed` (cause `storage`). | the worker |
| `run-ended`, `run-failed` | the `send-run` performer: the `run` op's result, or the worker's `{id, error}` answer to it (today `web/src/engine/client.ts:302`) | the worker |
| `break-timeout` | the `start-break-timer` performer | the worker |

Each failure event carries a `reason` that its raiser has already worked out from the error's `kind`, `reason` and
`name` (`reasonOf`, `web/src/engine/client.ts:48-52`, and `web/src/app/engine.ts:224`); the machine matches no text.
`download-failed` has only two reasons because a download that fails for any cause other than another build is
`failed` with reason `download`, as step B decided (`web/src/app/engine.ts:172-177`).

Log chunks are not events: they change no state. Read ops (item 7.2) raise no event either.

---

## 3. `Effect`

```ts
/** Why a worker is ended: what its pending queries reject with (ClientError's kind). */
export type Ending = { kind: "reset"; reset: ResetKind; reason: string }
                   | { kind: "stopped" | "failed" | "failed-twice"; reason: string };
export type Line = "ready" | "reset" | "download-stopped" | "failed" | "failed-twice" | { stage: Stage };
export type Effect =
  | { do: "take-lock"; n: Ticket; steal: boolean }
  | { do: "own-files" }
  | { do: "block-store" }
  | { do: "check-cache"; n: Ticket }
  | { do: "start-download"; n: Ticket }
  | { do: "abort-download"; n: Ticket }
  | { do: "fetch-list"; n: Ticket }
  | { do: "forget-download" }
  | { do: "start-worker"; n: Ticket; build: Build | null }
  | { do: "end-worker"; n: Ticket; ending: Ending }
  | { do: "send-run"; n: Ticket; code: string; head: RunHead }
  | { do: "interrupt"; n: Ticket }
  | { do: "start-break-timer"; n: Ticket; ms: number }
  | { do: "cancel-break-timer" }
  | { do: "end-run"; result: RunResult }
  | { do: "engine-ready" }
  | { do: "engine-gone" }
  | { do: "show-dialog"; dialog: "download"; forRun: boolean } | { do: "show-dialog"; dialog: "other-tab" }
  | { do: "close-dialog"; dialog: "download" | "other-tab"; focusEditor: boolean }
  | { do: "add-reset-banner"; reason: string; kind: ResetKind }
  | { do: "say"; line: Line }
  | { do: "warn"; text: string };

/** The effects that carry a ticket. */
export type TicketedEffect = Extract<Effect, { n: Ticket }>;

/** The events each effect with a ticket may be answered with; `never`: it is not answered. */
export interface Answers {
  "take-lock": "lock-answered";
  "check-cache": "cache-checked";
  "start-download": "download-progress" | "download-done" | "download-failed";
  "fetch-list": "list-checked" | "list-failed";
  "start-worker": "stage" | "started" | "start-failed" | "crashed";
  "send-run": "run-ended" | "run-failed";
  "start-break-timer": "break-timeout";
  "abort-download": never;
  "end-worker": never;
  "interrupt": never;
}
```

**`Answers` is checked by the compiler, both ways.** It is not only written down: three facts about it are types that
must come out `true`, next to it in `machine.ts`.

```ts
export type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
export type Expect<T extends true> = T;
type IsUnion<U, V = U> = U extends unknown ? ([V] extends [U] ? false : true) : never;
/** The effects whose row in A names the event type T. */
type AskedBy<A, T> = { [K in keyof A]: T extends A[K] ? K : never }[keyof A];
/** The event types that sit under two effects in A. */
type Twice<A> = { [T in TicketedEvent["type"]]: IsUnion<AskedBy<A, T>> extends false ? never : T }[TicketedEvent["type"]];

/** 1. One row for each effect with a ticket, and no other row. */
export type RowsMatchEffects<A> = Equal<keyof A, TicketedEffect["do"]>;
/** 2. Only events with a ticket, and every one of them. */
export type AnswersMatchEvents<A> = Equal<A[keyof A], TicketedEvent["type"]>;
/** 3. No event under two effects. */
export type NoEventTwice<A> = Equal<Twice<A>, never>;

/** true when A is a right answers map for this machine: all three hold. */
export type AnswersOk<A> =
  RowsMatchEffects<A> extends true
    ? AnswersMatchEvents<A> extends true
      ? NoEventTwice<A>
      : false
    : false;

/** Each fails `npm run check` on its own line if its rule does not hold for Answers. */
export type RowsOk = Expect<RowsMatchEffects<Answers>>;
export type EventsOk = Expect<AnswersMatchEvents<Answers>>;
export type NoDuplicates = Expect<NoEventTwice<Answers>>;

/** The effects that are answered: their performers get a reply (item 5.1). */
export type Answered = { [K in keyof Answers]: [Answers[K]] extends [never] ? never : K }[keyof Answers];
```

| What goes wrong | Which check fails |
|---|---|
| A new effect carries a ticket and has no row | 1: it must be given its answers, or `never` |
| A row for an effect that has no ticket, or a misspelt effect | 1 |
| A row names an event without a ticket, or a misspelt event | 2 |
| A new event with a ticket is under no effect | 2 |
| One event is under two effects | 3 |

So every event with a ticket is the answer of exactly one effect, and every effect with a ticket is classified. The test
file keeps the checks from being lost: each of these lines must fail to compile (item 5.1 has the lines for tickets and
replies).

```ts
// web/test/machine.test.ts
// @ts-expect-error an effect with a ticket and no row
type _1 = Expect<AnswersOk<Omit<Answers, "interrupt">>>;
// @ts-expect-error a row for an effect without a ticket
type _2 = Expect<AnswersOk<Answers & { "own-files": never }>>;
// @ts-expect-error an event without a ticket as an answer
type _3 = Expect<AnswersOk<Omit<Answers, "take-lock"> & { "take-lock": "lock-answered" | "lock-lost" }>>;
// @ts-expect-error an event with a ticket that no effect is answered with
type _4 = Expect<AnswersOk<Omit<Answers, "start-break-timer"> & { "start-break-timer": never }>>;
// @ts-expect-error an event under two effects
type _5 = Expect<AnswersOk<Omit<Answers, "interrupt"> & { interrupt: "started" }>>;
// @ts-expect-error a misspelt event
type _6 = Expect<AnswersOk<Omit<Answers, "take-lock"> & { "take-lock": "lock-answerd" }>>;
```

**`Ending` and `CutKind` are two types.** `Ending` travels in `end-worker` and tells the transport what the ended
worker's pending queries reject with. `CutKind` (`web/src/engine/types.ts:45`) is the `kind` of an rc 9998 run result;
after this step it is `ResetKind | "stopped" | "run-failed"`. It loses `failed`, `failed-twice` and `no-engine`: a run
exists only in `running`, `breaking` and `waiting`, and no transition from those three leads to a failed state or to
none.

Grouped by who performs it. `perform(effect)` in `web/src/app/engine.ts` is one exhaustive `switch`; the fourth
column is the effect's row in `Answers`: what the performer may say back through its `reply` (item 5).

| Performed on | Effect | What is done | Answered with |
|---|---|---|---|
| Tab lock (`web/src/engine/tab.ts`) | `take-lock {n, steal}` | `lock.take({steal})` | `lock-answered` |
| Files (`web/src/app/files.ts`) | `own-files` | `own()`: `store.blocked = false`, `keep(storage)`, `refresh()`. Not awaited. | none |
| Files | `block-store` | `block()`: `store.blocked = true` | none |
| Build and download (the transport's cache methods) | `check-cache {n}` | `client.cached()` | `cache-checked` |
| Build and download | `start-download {n}` | make an `AbortController` kept with `n`; `client.download()` | `download-progress`, `download-done`, `download-failed`; nothing after an abort |
| Build and download | `abort-download {n}` | abort the controller kept with `n` | none |
| Build and download | `fetch-list {n}` | `client.build()` | `list-checked`, `list-failed` |
| Build and download | `forget-download` | `client.forgetDownload()` | none |
| Worker (the transport's lifecycle interface) | `start-worker {n, build}` | `client.start(n, build, reply)` | `stage`, `started`, `start-failed`, `crashed` |
| Worker | `end-worker {n, ending}` | `client.end(n, ending)`: terminate, detach the store, reject the pending calls | none |
| Worker and `web/src/app/run.ts` | `send-run {n, code, head}` | tell `run.ts` the run began (head, theme), then `client.run(n, …, onLog)` | `run-ended`, `run-failed` |
| Worker | `interrupt {n}` | `client.interrupt(n)`: SIGINT into the shared buffer | none |
| Break timer | `start-break-timer {n, ms}` | `setTimeout` | `break-timeout` |
| Break timer | `cancel-break-timer` | `clearTimeout` | none |
| `web/src/app/run.ts` | `end-run {result}` | hand the result over. Always the last effect of its step. | none |
| `web/src/app/run.ts` | `engine-ready` | ask `memory` (today `web/src/app/run.ts:37-39`) | none |
| `web/src/app/run.ts` | `engine-gone` | clear `results`, `macros`, `data`, `rows`, `memory`, `lastRun`, `sessionRuns` (today `web/src/app/run.ts:30-36`). This is the plan's "the engine was replaced". | none |
| Signals (`web/src/app/state.ts`) | `show-dialog` | write `dialog` | none |
| Signals | `close-dialog {dialog, focusEditor}` | close it only if that kind is open; with `focusEditor`, focus the editor after (today `web/src/app/engine.ts:216-219`) | none |
| Signals | `add-reset-banner {reason, kind}` | `addBanner({b: "reset", reason, kind})` | none |
| Signals | `say {line}` | `say(SAY[line])`; the words stay in `web/src/app/engine.ts` | none |
| Console | `warn {text}` | `console.warn` (today `web/src/app/engine.ts:229`) | none |

`own-files` and `check-cache` are two effects where the code today is one function (`owned()`,
`web/src/app/engine.ts:77-88`): the file list and the cache check do not depend on each other, so the check no longer
waits for the list.

The controller keeps two handles: the Break timer's id and the download's `AbortController`. Each is made by one effect
and released by another; neither decides a state.

---

## 4. The transition tables

### 4.1 How to read them

- `·` : the event is not valid in this state. Nothing changes and there are no effects (outcome `not-valid`). All
  such cells are one line of code, the last line of `transition`.
- **STALE** : the state holds no ticket, so the stale guard drops every event that presents one (outcome `stale`).
- In every other cell of an event with a ticket the guard runs first: an `n` that is not the state's ticket changes
  nothing (outcome `stale`). The cell says what happens when `n` matches.
- A cell reads "new state; effects in order". A state is written as its tag and the fields that matter:
  `starting-worker {worker: next, …}`.
- `next` is a new ticket, `issued + 1`, and `issued` becomes `next`. `first` is the first stage: `download` on a snapshot
  start, else `python`. `at` is the event's time. `worker`, `download`, `queued`, `run` and `t0` without a value are
  the old state's. In ASK(run), `run` is the event's code and head.

Shorthand:

| Name | New state | Effects, in order |
|---|---|---|
| **DOWNLOAD(queued)** | `downloading {download: next, received: 0, total: env.engineBytes or 0, t0: at, queued}` | `start-download {next}` |
| **ASK(queued)** | `asking {queued}` | `show-dialog download`, with `forRun` true when a run is queued |
| **STOP** | `declined` | `abort-download {download}`, `close-dialog download`, `say download-stopped` |
| **OWN** | Manual mode: `none`. Otherwise `checking-cache {id: next}` | Manual mode: `own-files`. Otherwise `own-files`, `check-cache {next}` |
| **BREAK** | Interrupt possible: `breaking {worker, run, t0, resetAt: at + env.graceMs}`. Not possible: RESET(break), with the reason that the page is not cross-origin isolated | `interrupt {worker}`, `start-break-timer {worker, env.graceMs}` |
| **END(result)** | `ready {worker}` | `cancel-break-timer` (only from `breaking`), `end-run {result}`. The result is passed on as it is, whatever its rc (4.3) |
| **FAIL(reason, detail)** | `failed {reason, detail}`; `crashes` unchanged | `end-worker {worker, failed}` (only from `starting-worker`), `close-dialog download`, `say failed`, `warn` |
| **TWICE(reason, detail)** | `failed-twice {reason, detail}`; `crashes` 0 | `end-worker {worker, failed-twice}`, `forget-download` (unless the reason is `memory` or `no-wasm`), `close-dialog download`, `say failed-twice`, `warn` |
| **RESET(kind)** | `starting-list {worker: next, stage: first, t0: at, done: {}, queued}`. `queued` is kept from `starting-worker`, null otherwise. `crashes` becomes 1 for kind `crash`, else 0 | `cancel-break-timer` (only from `breaking`); `end-worker {old worker, reset}`; `fetch-list {next}`; only from `ready`, `running`, `breaking`, `waiting`: `add-reset-banner {reason, kind}`, `say reset`, `engine-gone`; only from `running`, `breaking`, `waiting`: `end-run {cutResult(lost(reason), kind)}` |
| **LOST** | `other-tab-idle`; `crashes` 0 | `abort-download {download}` (only from `downloading`); `cancel-break-timer` (only from `breaking`); `end-worker {worker, stopped}` (only from `starting-worker`, `ready`, `running`, `breaking`, `waiting`); `block-store`; `engine-gone`; `show-dialog other-tab`; only from `running`, `breaking`, `waiting`: `end-run {cutResult(lost("another tab took over"), "stopped")}` |

RESET kinds and their reasons, which are today's strings:

| Kind | From | Reason |
|---|---|---|
| `user` | `reset` | "reset by you" (`web/src/app/engine.ts:289`) |
| `break` | `break-timeout` | "the code did not stop at Break" (`web/src/engine/client.ts:401`) |
| `break` | `break` without `SharedArrayBuffer` | "Break reset the engine, because this page is not cross-origin isolated and cannot ask a run to stop" (`web/src/engine/client.ts:393`) |
| `crash` | `crashed`, cause `error` | "the engine crashed (`detail`)" (`web/src/engine/client.ts:319`) |
| `crash` | `crashed`, cause `storage` | "the browser closed the file storage" (`web/src/engine/client.ts:328`) |

`lost(reason)` is today's sentence, "session reset: `reason`. Data in memory is gone; your files are kept."
(`web/src/engine/client.ts:41`). `cutResult(error, kind)` is today's rc 9998 result (`web/src/engine/client.ts:44-45`).
TWICE's `detail` is today's "the engine's worker failed twice (`detail`); reload the page"
(`web/src/engine/client.ts:315`).

### 4.2 The tables

Five tables, sixteen rows each, twenty-four columns in all: every state by every event. The rows are the tags of
`State`, in the order of item 1.

**A. The visitor's engine actions**

| State | start | ask | decline | stop-download | reset | take-over |
|---|---|---|---|---|---|---|
| checking-lock | · | · | · | · | · | · |
| checking-cache | · | · | · | · | · | · |
| none | DOWNLOAD(null) | ASK(null) | · | · | · | · |
| asking | DOWNLOAD(state.queued) | · | `declined`; `close-dialog download` | · | · | · |
| declined | DOWNLOAD(null) | ASK(null) | · | · | · | · |
| downloading | · | · | STOP | STOP | · | · |
| starting-list | · | · | · | · | · | · |
| starting-worker | · | · | · | · | · | · |
| ready | · | · | · | · | RESET(user) | · |
| running | · | · | · | · | RESET(user) | · |
| breaking | · | · | · | · | RESET(user) | · |
| waiting | · | · | · | · | RESET(user) | · |
| failed | DOWNLOAD(null) | · | · | · | · | · |
| failed-twice | · | · | · | · | · | · |
| other-tab-idle | · | · | · | · | · | `other-tab-taking {take: next}`; `take-lock {next, steal: true}` |
| other-tab-taking | · | · | · | · | · | · |

**B. Tab lock and cache check**

| State | lock-answered {n, owned} | lock-lost (no ticket) | cache-checked {n, cached} |
|---|---|---|---|
| checking-lock | Owned: OWN. Not owned: `other-tab-idle`; `show-dialog other-tab` | LOST | · |
| checking-cache | · | LOST | Cached: DOWNLOAD(null). Not cached: ASK(null) |
| none | **STALE** | LOST | **STALE** |
| asking | **STALE** | LOST | **STALE** |
| declined | **STALE** | LOST | **STALE** |
| downloading | · | LOST | · |
| starting-list | · | LOST | · |
| starting-worker | · | LOST | · |
| ready | · | LOST | · |
| running | · | LOST | · |
| breaking | · | LOST | · |
| waiting | · | LOST | · |
| failed | **STALE** | LOST | **STALE** |
| failed-twice | **STALE** | LOST | **STALE** |
| other-tab-idle | **STALE** | · | **STALE** |
| other-tab-taking | Owned: `close-dialog other-tab`, then OWN. Not owned: `other-tab-idle`; no effects | `other-tab-idle`; no effects | · |

**C. Download and the build's list**

| State | download-progress {n, received, total} | download-done {n, build} | download-failed {n, reason, detail} | list-checked {n, build} | list-failed {n, reason, detail} |
|---|---|---|---|---|---|
| checking-lock | · | · | · | · | · |
| checking-cache | · | · | · | · | · |
| none | **STALE** | **STALE** | **STALE** | **STALE** | **STALE** |
| asking | **STALE** | **STALE** | **STALE** | **STALE** | **STALE** |
| declined | **STALE** | **STALE** | **STALE** | **STALE** | **STALE** |
| downloading | `downloading` with the new `received` and `total` | `starting-worker {worker: next, stage: first, t0: at, done: {download: (at − t0) / 1000}, queued}`; `start-worker {next, build}`, `say {stage: first}` | FAIL(reason, detail) | · | · |
| starting-list | · | · | · | `starting-worker`, with the fields of `starting-list` unchanged; `start-worker {worker, build}` | FAIL(reason, detail) |
| starting-worker | · | · | · | · | · |
| ready | · | · | · | · | · |
| running | · | · | · | · | · |
| breaking | · | · | · | · | · |
| waiting | · | · | · | · | · |
| failed | **STALE** | **STALE** | **STALE** | **STALE** | **STALE** |
| failed-twice | **STALE** | **STALE** | **STALE** | **STALE** | **STALE** |
| other-tab-idle | **STALE** | **STALE** | **STALE** | **STALE** | **STALE** |
| other-tab-taking | · | · | · | · | · |

**D. Worker start and crash**

| State | stage {n, stage} | started {n} | start-failed {n, reason, detail} | crashed {n, cause, reason, detail} |
|---|---|---|---|---|
| checking-lock | · | · | · | · |
| checking-cache | · | · | · | · |
| none | **STALE** | **STALE** | **STALE** | **STALE** |
| asking | **STALE** | **STALE** | **STALE** | **STALE** |
| declined | **STALE** | **STALE** | **STALE** | **STALE** |
| downloading | · | · | · | · |
| starting-list | · | · | · | · |
| starting-worker | The same stage: no change, no effects. Another: `starting-worker {stage, t0: at, done: done plus the old stage's seconds}`; `say {stage}` | `crashes` 0. No queued run: `ready {worker}`; `close-dialog download` (focus the editor), `say ready`, `engine-ready`. Queued run: `running {worker, run: head, t0: at}`; the same three effects, then `send-run {worker, code, head}` | FAIL(reason, detail) | `crashes` 0: RESET(crash). `crashes` 1: TWICE(reason, detail) |
| ready | · | · | · | RESET(crash) |
| running | · | · | · | RESET(crash) |
| breaking | · | · | · | RESET(crash) |
| waiting | · | · | · | RESET(crash) |
| failed | **STALE** | **STALE** | **STALE** | **STALE** |
| failed-twice | **STALE** | **STALE** | **STALE** | **STALE** |
| other-tab-idle | **STALE** | **STALE** | **STALE** | **STALE** |
| other-tab-taking | · | · | · | · |

**E. Runs**

| State | run {code, head} | break | keep-waiting | run-ended {n, result} | run-failed {n, message} | break-timeout {n} |
|---|---|---|---|---|---|---|
| checking-lock | · | · | · | · | · | · |
| checking-cache | · | · | · | · | · | · |
| none | ASK(run) | · | · | **STALE** | **STALE** | **STALE** |
| asking | · | · | · | **STALE** | **STALE** | **STALE** |
| declined | ASK(run) | · | · | **STALE** | **STALE** | **STALE** |
| downloading | · | · | · | · | · | · |
| starting-list | · | · | · | · | · | · |
| starting-worker | · | · | · | · | · | · |
| ready | `running {worker, run: head, t0: at}`; `send-run {worker, code, head}` | · | · | · | · | · |
| running | · | BREAK | · | END(result) | END(cutResult(message, "run-failed")) | · |
| breaking | · | · | `waiting {worker, run, t0}`; `cancel-break-timer` | END(result) | END(cutResult(message, "run-failed")) | RESET(break) |
| waiting | · | · | · | END(result) | END(cutResult(message, "run-failed")) | · |
| failed | · | · | · | **STALE** | **STALE** | **STALE** |
| failed-twice | · | · | · | **STALE** | **STALE** | **STALE** |
| other-tab-idle | · | · | · | **STALE** | **STALE** | **STALE** |
| other-tab-taking | · | · | · | · | · | · |

In code the table is data. Its types make every row exist and give every cell its own state and its own event:

```ts
// web/src/engine/machine.ts
export type EventOf<T extends Event["type"]> = Extract<Event, { type: T }>;
/** One cell: this row's state and this column's event, both narrowed already. */
type Cell<R extends RowName, T extends Event["type"]> = (m: Machine & { state: StateOf<R> }, e: EventOf<T>) => Step;
/** One row: a cell for each event that is valid in it. An event with no cell is not valid there. */
type Row<R extends RowName> = { [T in Event["type"]]?: Cell<R, T> };

const TABLE: { [R in RowName]: Row<R> } = {
  // …
  "starting-list": {
    "lock-lost": LOST,
    "list-checked": (m, e) => step({ ...m, state: { ...m.state, s: "starting-worker" } },      // m.state is starting-list
      [{ do: "start-worker", n: m.state.worker, build: e.build }]),                             // e is list-checked
    "list-failed": (m, e) => FAIL(m, e.reason, e.detail),
  },
  ready: {
    run: (m, e) => step({ ...m, state: { s: "running", worker: m.state.worker, run: e.head, t0: e.at } },
      [{ do: "send-run", n: m.state.worker, code: e.code, head: e.head }]),
    reset: m => RESET(m, "user", "reset by you"),
    crashed: (m, e) => RESET(m, "crash", crashReason(e)),
    "lock-lost": LOST,
  },
  // …
};

export function transition(m: Machine, e: Event): Step {
  if ("n" in e && e.n !== ticketOf(m.state)) return same(m, "stale");                   // the one stale guard
  const cell = TABLE[m.state.s][e.type] as Cell<RowName, Event["type"]> | undefined;    // THE ONE CAST of the table
  return cell ? cell(m, e) : same(m, "not-valid");     // the one place an event that is not valid changes nothing
}
```

- **No cell casts.** In the cell `"starting-list"` × `"list-checked"`, `m.state` is the `starting-list` member and `e` is
  the `list-checked` event, so `m.state.worker` and `e.build` type-check and `m.state.take` or `e.result` do not.
- **Every row exists.** `TABLE`'s type is mapped over `RowName`, which is `State["s"]`. A member added to `State` has no
  row until one is written.
- **The one cast** is in the lookup, and it cannot be avoided: `m.state.s` and `m.state` vary together, and so do
  `e.type` and `e`, but TypeScript does not follow two values that vary together through an index. `TABLE[m.state.s]` is
  to it a union of sixteen rows, and the cell a union of functions that each want one state and one event. The cast says
  what the mapped types already ensure: the cell found under this state's tag and this event's type takes this state and
  this event. The shorthands that serve several rows (LOST, RESET, FAIL, END) take the machine with the union of the
  states they are used from and `switch` on `m.state.s`.
- The only other cast in `machine.ts` is in `mint()`, which makes a `Ticket` (item 1).

These types were compiled as written here (TypeScript 7.0.2, the project's options), with sample cells.

### 4.3 Break and the run's return code

**The rule.** After Break, the run's result stands as the engine gave it. END passes it on unchanged; `transition`
never rewrites an rc.

**Why the rc is not always 1.** The engine never cuts a command half-way, because in the browser it cannot roll back a
command that has changed part of the data (an `append` with some columns extended and others not). So a Break is a
request, and the engine takes it at the next safe point:

1. The `interrupt` effect stores SIGINT in the shared buffer (today `web/src/engine/client.ts:396`).
2. Pyodide runs the handler `_on_interrupt` (`src/dofile/browser.py:28-30`), which calls `request_break()` only while
   a run is on.
3. The interpreter takes the request before a command or a loop pass, never inside a command or under `by`
   (`brk.at_command`, `src/dofile/_vendor/opendta/core/brk.py:31-34`), and inside the long computations that leave the
   data as they found it (`brk.check`). That raises `KeyboardInterrupt`, which `Engine.run` turns into rc 1, the error
   "--Break--" and the log lines "--Break--" and "r(1);" (`src/dofile/engine.py:425-428`). The data is as the last
   complete command left it.
4. If the command that was running when Break was asked is the run's last, no safe point follows: the run ends by
   itself, with its own rc and its whole log. The request that was left over is dropped before the next run
   (`src/dofile/browser.py:60`, `web/src/engine/worker.ts:425`).

| After `break`, what happens | The result | rc | Next state | Data in memory |
|---|---|---|---|---|
| The engine takes the Break at a safe point | the engine's | 1 | `ready` | kept |
| The run ends before a safe point, without an error | the engine's | 0 | `ready` | kept |
| The run ends before a safe point, with a Stata error | the engine's | that error's rc | `ready` | kept |
| The run op fails in the worker (`run-failed`) | the machine's | 9998, kind `run-failed` | `ready` (the worker stays) | kept |
| The grace time runs out (`break-timeout`) | the machine's | 9998, kind `break` | `starting-list` | gone |
| The worker crashes | the machine's | 9998, kind `crash` | `starting-list` | gone |
| Reset, or "Reset now" | the machine's | 9998, kind `user` | `starting-list` | gone |
| Another tab takes the lock | the machine's | 9998, kind `stopped` | `other-tab-idle` | gone |
| No `SharedArrayBuffer`: Break cannot ask | the machine's | 9998, kind `break` | `starting-list`, at once | gone |

rc 1 always means "stopped by Break, the data kept". rc 9998 always means "the session was reset, the data is gone"
(kind `run-failed` excepted: the worker stays). Both meanings are the CLI's and the MCP server's, which is why a Break
that runs out of time stays 9998 and does not become 1.

Tests today: a long command with a command after it ends rc 1 once it has finished
(`web/test/files.test.ts:446`); a loop stops with rc 1 (`web/test/files.test.ts:492`,
`web/test/engine.test.ts:75`); a run that answers rc 0 after Break and "Don't reset" keeps rc 0
(`web/test/client.test.ts:484-493`); a command that does not stop is reset with rc 9998, kind `break`
(`web/test/files.test.ts:472`). Scenario 5 (item 8) has all three endings.

For step E: SPEC section 5's row "`breaking` | the run ends with rc 1" becomes "the run ends: rc 1 when the engine took
the Break, the run's own rc when it had already finished".

One limit stays as it is. The worker clears the buffer when a run starts (`web/src/engine/worker.ts:425`), so a Break
that is asked after `send-run` and before the worker reaches the `run` op is lost; the run goes on and `break-timeout`
resets the engine. The window is the read ops queued before the run, a few milliseconds.

### 4.4 Why the run's states are in this machine

`running`, `breaking` and `waiting` stay states of the one machine, and `break` and `keep-waiting` stay its events.
The alternative is a second machine in `web/src/app/run.ts`, nested under `ready`: the engine has a worker or not, the
run is idle, running, breaking or waiting.

| Concern | One machine (this design) | A run machine in `run.ts` |
|---|---|---|
| A crash, a reset or the lock lost during a run | One transition gives the new state and the cut run's result together (the first contract of the plan's table). | The engine machine must tell the run machine to cut the run: two steps, with an order to keep, and a moment where the engine is `starting` and the run still `running`. |
| The Break timer running out | `breaking` × `break-timeout` is RESET(break), one cell. | A run event that must raise an engine event. |
| The stale guard | A run's answers present the worker's ticket, which the state holds. | The run machine needs the worker's ticket too, or tickets of its own that every new worker must reset. |
| A queued run (ruling 5) | `started` goes straight to `running`. | The engine machine hands the run back to `run.ts`: a second dispatch. |
| "No counter or flag outside the machine decides a state" | Holds. | The run's state is outside. |
| What views read | One `engine` signal with SPEC section 5's one list of states. | A projection of two states, or two signals. |
| Size | 16 rows by 24 events. | About 13 by 18 and 4 by 8, plus the cells where the two must agree. |

What the split is after, a reader seeing the run's life cycle in one place, is given by the tables' grouping: **table
E holds every run event** (`run`, `break`, `keep-waiting`, `run-ended`, `run-failed`, `break-timeout`), and only four
of its rows are not empty of changes. `web/src/app/run.ts` keeps what a run leaves: the log, the results, the graphs.

The other design would be right if a run could outlive its worker or if several runs could exist at once (a queue of
runs, more than one engine), or if the run gained states of its own (paused, stepping) that multiplied this table.

---

## 5. The stale guard and the tickets

```ts
/** The ticket of what this state waits on or uses; null when it has none. */
export function ticketOf(state: State): Ticket | null {
  switch (state.s) {
    case "checking-lock": case "checking-cache": return state.id;
    case "downloading": return state.download;
    case "starting-list": case "starting-worker": case "ready": case "running": case "breaking": case "waiting":
      return state.worker;
    case "other-tab-taking": return state.take;
    case "none": case "asking": case "declined": case "failed": case "failed-twice": case "other-tab-idle": return null;
  }
}
```

- Every answer presents the ticket of the request it answers, in one field, `n`.
- A state holds at most one ticket.
- Tickets come from one counter, so a download's never equals a worker's.
- The check is the first line of `transition`.

### 5.1 How the right ticket gets onto every event

The guard is only as good as the tickets on the events. Three mechanisms make a wrong ticket impossible to write, and a
fourth makes a dropped event visible.

**1. A ticket cannot be made up.** `Ticket` is a branded type. The only expression of that type that does not come from
another `Ticket` is in `mint()` in `web/src/engine/machine.ts`, which is not exported. A performer that writes `n: 5`
or `n: count++` fails `npm run check`, and so does `{ ...machine, issued: 0 }`: the counter is a `Ticket` too.

**2. A performer never writes a ticket.** `perform` hands each performer of an answered effect a `reply` function
already bound to its effect's ticket:

```ts
// web/src/engine/machine.ts
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** Every event with a ticket, without the ticket: all that any performer could say. */
export type AnyAnswer = DistributiveOmit<TicketedEvent, "n">;
/** What the performer of effect K may say: one of K's answers, without the ticket. */
export type Answer<K extends Answered> = Extract<AnyAnswer, { type: Answers[K] }>;
export type Reply<K extends Answered> = (answer: Answer<K>) => void;

// web/src/app/engine.ts
function dispatch(event: PlainEvent): Step | null       // the actions and lost(): no event with a ticket fits.
                                                        // null: the event had to wait for a step in progress
const reply = <K extends Answered>(effect: TicketedEffect & { do: K }): Reply<K> => {
  const mine = wiring;                                   // the wiring that performed this effect
  return answer => {
    if (mine !== wiring) return;                         // a reply of an earlier wiring does nothing
    const said: AnyAnswer = answer; enqueue({ ...said, n: effect.n });   // THE ONE PLACE a ticket is put on an event
  };
};

// in perform(effect):
//   case "start-download": return download(effect, reply(effect));     // download(effect, reply: Reply<"start-download">)
//   case "start-worker":   return lifecycle.start(effect.n, effect.build, reply(effect));
```

So `n` is written once, in `reply`. The `start-download` performer can say `download-progress`, `download-done` or
`download-failed` and nothing else; it cannot say `started`, and it cannot say anything for another download. The
transport is given the same kind of function for its worker and writes no ticket either. `reply(effect)` does not
compile for an effect whose row in `Answers` is `never`.

**`reply` has no cast.** An answer's type is taken out of `AnyAnswer`, the union of all events with a ticket less the
ticket, so the compiler can see that an `Answer<K>` is an `AnyAnswer` and that an `AnyAnswer` with `n` added is an
event. A cast to the effect's own events (`as Extract<TicketedEvent, { type: Answers[K] }>`) was tried and does not
compile for a generic `K` unless it goes through `unknown`, which would allow anything.

**`reply` is not single-use.** A `start-worker` reply must stay live for the worker's life: `stage` several times,
`started`, then perhaps `crashed` much later; `download-progress` repeats too. Making a reply inert after its "final"
answer would need a rule per effect for which answers are final, which is the transition table over again. What
covers a second final answer is the machine: every final answer moves the state on, so the second one finds another
ticket in the state (outcome `stale`) or no cell (outcome `not-valid`), changes nothing, and is recorded (4 below).

**3. The machine only asks for answers it can accept.** A property test over every cell: each effect whose row in
`Answers` is not `never` carries the ticket that the new state holds (`effect.n === ticketOf(next.state)`). So an answer
is stale only because the state has moved on since, never from the start.

**4. A dropped event is recorded.** `transition` returns `outcome`. The controller appends every event whose outcome is
`stale` or `not-valid` to a list, `{ type, n, row, why }`, which the tests read with `drops()` (the test hook has it
too). The list keeps the last 200 entries, so that it cannot grow without bound in a long visit. The controller tests
assert the exact list at the end of every wiring (when a test replaces it, and when the test ends): a test that
provokes no race expects it empty, and a race test names the events it expects to be dropped. A ticket that is wrong or out of date therefore
fails a test instead of passing in silence.

| Enforced by | What |
|---|---|
| The compiler | A `Ticket` cannot be written as a literal, nor can a machine's counter. An event with a ticket cannot be given to `dispatch`. A performer's `reply` takes only its effect's answers, and no `n`. An effect that is never answered gets no `reply`. `Answers` is complete and exact (item 3). |
| A test | `as Ticket` occurs once in the whole of `web/`, in `mint()`; `enqueue(` occurs only in `dispatch` and `reply`; the body of `reply` has no `as` (source text, in `web/test/imports.test.ts`). Property 3 above. The drop record. The lines below, marked `@ts-expect-error`, keep the compiler's refusals from being lost. |
| Convention | A performer says only what its effect's work produced. If it said a second final answer, the machine would drop it and the drop record would show it. |

```ts
// web/test/machine.test.ts (types only; `dispatch` and `reply` stand for the controller's, with the same signatures)
// @ts-expect-error a number is not a Ticket
const made: Ticket = 4;
// @ts-expect-error a counter cannot be written as a literal
const forged: Machine = { ...machine, issued: 0 };
// @ts-expect-error an event with a ticket is not a PlainEvent, so dispatch does not take it
dispatch({ type: "download-progress", n: ticket, received: 1, total: 2 });
// @ts-expect-error an answer has no ticket
say({ type: "download-done", build: null, n: ticket });      // say: Reply<"start-download">
// @ts-expect-error not an answer of this effect
say({ type: "started" });
// @ts-expect-error an effect that is never answered gets no reply
reply(endWorker);                                             // endWorker: Extract<Effect, { do: "end-worker" }>
```

**A reply belongs to its wiring.** Every machine counts its tickets from 1 along the same path (the lock 1, the cache
check 2, the download 3, the worker 4), so a ticket says which request within one machine, not which machine. A second
`connectEngine` makes a new machine (item 7.1), and a late answer from the earlier wiring would present a ticket that
the new machine has issued too, and be taken. So `wiring` is a module variable of the controller that `connectEngine`
sets to a new object, each `reply` captures the one current when its effect was performed, and a reply whose wiring is
no longer the current one returns without enqueueing. It is not recorded: the drop record belongs to the new wiring.
In the page there is one wiring, so this matters to the Node tests (one wiring for each test) and to a hot reload.
Test (`web/test/app.test.ts`): start a download on one wiring, call `connectEngine` and `open()` again and drive the
new machine to `downloading`, whose ticket is the same number; the first download's `download-done` then changes
nothing and `drops()` is empty.

**One counter, not one type per kind.** With types such as `WorkerNo` and `DownloadNo` the compiler would refuse a
worker's ticket where a download's is wanted. With bound replies no code outside the machine chooses a ticket, so that
mistake cannot be written; and inside the machine a ticket of the wrong kind can never match, because one counter
issues them all. The kinds would add five types and a union to `ticketOf()` for nothing.

### 5.2 What the guard replaces

| Today | Where | In this design |
|---|---|---|
| `gen` | `web/src/engine/client.ts:272, 282, 284, 337, 339, 342, 350, 446` | **Guard.** The list fetch is `fetch-list {n}` and the worker's start is `start-worker {n}`; once the state's ticket has changed their answers are dropped. Handing a pending start the next start's promise (`:426`) is gone: a start has no promise, and so the two `as unknown as About` casts go (`:337, 342`). |
| `attempt` | `web/src/app/engine.ts:49, 63, 95, 174, 182-183, 248-249` | **Guard.** The same events, compared with the `worker` of `starting-list` and `starting-worker`. |
| `lockGen` | `web/src/app/engine.ts:54, 78, 82, 86, 91, 115, 117` | **Guard**, through the `id` of `checking-lock` and `checking-cache`, and `other-tab-taking.take`. |
| `downloading === ac` | `web/src/app/engine.ts:161, 164, 179` | **Guard**, through `downloading.download`. The `AbortController` itself (`:45, 93, 137, 143, 154-155`) stays in the controller as a handle. |
| `taking` | `web/src/app/engine.ts:51, 111-113, 121` | Split. A second press is a **table cell** (`other-tab-taking` × `take-over` is `·`). A lock answer that comes after the lock was lost again is the **guard**. |
| `worker !== this.worker` | `web/src/engine/client.ts:295, 309` | Split. Stage and crash messages are events with the worker's ticket: **guard**. The answers to the views' queries never reach `transition`: the transport keeps each worker's pending calls in that worker's own record, and `end()` drops the record. |
| `errorRestarts` | `web/src/engine/client.ts:82, 126, 310, 314, 347, 352, 435, 447` | **Not a stale guard.** It is the crash count: `Machine.crashes`. |
| `was` | `web/src/app/run.ts:24, 27-30, 37` | **Not a stale guard.** Replaced by the effects `engine-gone` and `engine-ready`. |
| `queued` | `web/src/app/run.ts:23, 40-46, 55` | **Not a stale guard.** It is the `queued` field of `asking`, `downloading`, `starting-list` and `starting-worker`. It is dropped where the next state has no such field. |

Three things the guard does not cover:

- **`lock-lost` has no ticket.** It means "this tab does not hold the lock now, whatever it was waiting for", and it is
  valid in every state except `other-tab-idle`, where the tab neither holds the lock nor waits for it. It cannot be
  out of date: `onLost` fires once for a request this tab held (`web/src/engine/tab.ts:23`). In `checking-lock` and
  `other-tab-taking` it cancels the request in progress, so that request's answer is then stale. A browser delivers
  the answer first, so those two cells are for safety; they keep a tab that has lost the lock from ever unblocking its
  store.
- **The Break timer and the run.** `break-timeout` presents the worker's ticket, and two runs on one worker share it.
  Today `this.running === running` (`web/src/engine/client.ts:401`) stops a timer left from an earlier run. Here every
  transition out of `breaking` emits `cancel-break-timer`, and a property test checks it (ruling 9). That makes this
  the one answer the guard does not protect: it is safe because the controller performs `cancel-break-timer` with
  `clearTimeout` in the same step, which is outside the pure machine. So a controller test with a simulated clock
  pins it (`web/test/app.test.ts`): on one worker, a first run is broken and the engine takes the Break (rc 1) before
  the deadline; a second run starts; the clock passes the first deadline and the state is still `running`, with
  `drops()` empty; then the second run's Break gets the whole grace time of its own. A run's answer
  needs no such care: the worker answers each `run` once, and the state stays on that run until the answer or a new
  worker.
- **The Data tab's `rows.value` identity check** is not the machine's: it moves into `web/src/app/run.ts`
  (`moreRows()`, item 7.2), the one writer of `rows` (corrected when step C was built: this bullet first said the check
  stayed in the view, against items 7.2 and 9).

Also replaced:

- `hadEngine` (`web/src/app/engine.ts:50, 242-246`): the source state of RESET.
- `stageAt` (`web/src/app/engine.ts:46, 189, 206-207`): the `t0` of `starting-list` and `starting-worker`.
- The state read again after an `await` (`web/src/app/engine.ts:258-259`): the END cells.
- `STARTABLE` and `RESETTABLE` (`web/src/app/engine.ts:146, 283`): table cells.
- `client.running` and the `busy` kind (`web/src/engine/client.ts:373`): the `run` column.
- `client.resetAt` (`web/src/engine/client.ts:85, 398`): `breaking.resetAt`.

---

## 6. The contracts, enforced

| Contract | Mechanism | File |
|---|---|---|
| `onRestart` before the cut run's promise resolves | RESET and LOST return the new state and `end-run {result}` in one step. The controller writes the `engine` signal before it performs effects, and `end-run` is last. Property test: a transition from `running`, `breaking` or `waiting` to a state that is none of those three has exactly one `end-run`, as its last effect; no other transition has one. | `web/src/engine/machine.ts`; `web/src/app/engine.ts`; `web/test/machine.test.ts` |
| `run.js` learns of a new engine from state names | The effects `engine-gone` and `engine-ready`. `run.ts` no longer subscribes to `engine` and has no `was`. Property test: a transition from `ready`, `running`, `breaking` or `waiting` to a state that does not hold the same worker has `engine-gone`, once. | `web/src/engine/machine.ts`, `web/src/app/run.ts` |
| A stage is found by matching English text | `FromWorker` has `{ stage: Stage }`, and the worker calls `stage(id: Stage)`. `STAGE_OF` and `StatusText` are deleted. The words are `Record<Stage, string>`, so a missing stage fails `npm run check`. | `web/src/engine/types.ts`, `web/src/engine/worker.ts`, `web/src/app/engine.ts` |
| Each signal has one writer | `state.ts` exports each single-owner signal as `ReadonlySignal<T>` and one writer object per owner (`engineWriter`, `runWriter`, `filesWriter`). The import test checks that each writer is imported only by its owner. `rows` joins them: its second writer moves into `run.ts` (item 7.2). | `web/src/app/state.ts`, `web/test/imports.test.ts` |
| Views never call the client | The transport is constructed only in `web/src/main.tsx`, and `web/src/app/engine.ts` does not export it. The import test follows the value imports of every `.tsx` under `web/src/app/` and fails if a chain reaches `engine/client.ts` or `engine/worker.ts`, or if a `.tsx` itself imports `engine/machine.ts` or `main.tsx`. For that, `engineBytes()` moves out of `client.ts` into `state.ts` (today `web/src/app/state.ts:8` imports it, so every view reaches the client module), `RC_RESET` moves to `machine.ts` (today `web/src/app/engine.ts:12`), and `web/src/app/engine.ts` imports only types from `client.ts`. | `web/test/imports.test.ts` |
| Every error kind and state is handled | `TABLE` is a mapped type over `RowName`, which is `State["s"]`: a state without a row does not compile (item 4.2). `EngineState` must have `State`'s tags: a state the views cannot see does not compile either (item 1). `ticketOf()`, `view()` and `perform()` are exhaustive switches with a `never` default. `SAY` and `FAILED` are `Record`s. The test's expected matrix is `Record<RowName, Record<EventType, …>>` with no optional key, so a new row or event fails the check until every cell is written. | `web/src/engine/machine.ts`, `web/src/app/engine.ts`, `web/test/machine.test.ts` |
| Ops and answers match on both sides | One map, `Ops` (item 7.2), types the worker's `ops` object and the transport's sends. | `web/src/engine/types.ts` |
| `decline()` and the other actions are safe in any state | Each action is one `dispatch`. The table test covers every row and every event. | `web/src/app/engine.ts`, `web/test/machine.test.ts` |
| A ticket is issued once | `issued` is a `Ticket`; only `mint()` makes one (item 1). Property tests over every cell and every scenario: no state holds a ticket greater than `issued`; `issued` never goes down; a new ticket in a step's state or effects is the old `issued` + 1. | `web/src/engine/machine.ts`, `web/test/machine.test.ts`, `web/test/imports.test.ts` |
| Every event presents the right ticket | Items 3 and 5.1: the `Ticket` brand, bound replies, the checked `Answers` map, the property that an answered effect carries the new state's ticket, the drop record. | `web/src/engine/machine.ts`, `web/src/app/engine.ts`, the tests |
| Only read ops are sent outside an effect | Item 7.2. Proved by the compiler: `query` takes only `ReadOps`, and the lifecycle interface is held by the performer alone. Declared and tested, not proved: that each op in `ReadOps` changes nothing (a fingerprint of the engine's state before and after each, with the real worker). | `web/src/engine/types.ts`, `web/src/engine/client.ts`, `web/test/engine.test.ts` |
| Every exit from `breaking` cancels the timer | Property test: a transition from `breaking` to any other state has `cancel-break-timer`, before any `end-worker`. `start-break-timer` occurs only in `running` to `breaking`. | `web/test/machine.test.ts` |
| Every exit from `downloading` that is not the download's own end aborts it | Property test: a transition from `downloading` to any other state, caused by an event other than that download's own `download-done` or `download-failed`, has exactly one `abort-download`, with the ticket the state held. No other transition has an `abort-download`. | `web/test/machine.test.ts` |
| A result after Break is not rewritten | Table test: in `running`, `breaking` and `waiting`, `run-ended` passes the event's `result` object itself to `end-run` (the same reference), for rc 0, 1 and 111. | `web/test/machine.test.ts` |
| One live worker per tab; one of each thing that must exist once | Item 7.4: a property over every cell, a throw in the transport's `start`, and a source-text test that only `main.tsx` constructs or connects. | `web/test/machine.test.ts`, `web/src/engine/client.ts`, `web/test/imports.test.ts` |
| `transition` is pure | The table test freezes the machine and the event before each call and makes every call twice, comparing the two steps. The import test checks that `machine.ts` has only `import type` lines and names none of `Date`, `setTimeout`, `console`, `Math.random`, and no `let` at the top level. | `web/test/machine.test.ts`, `web/test/imports.test.ts` |
| SPEC section 5 and the machine agree | The machine test builds the matrix from `transition`; from step E, SPEC section 5 holds that matrix, with the same sixteen names and no mapping, and the test compares the two (rulings 10 and 12). | `web/test/machine.test.ts`, `docs/design/SPEC.md` |

**The plan's two carried-over items.**

- *Run while the cache check is pending:* `run` and `start` are `·` in `checking-lock` and `checking-cache`.
- *`afterRun` lists the store after the lock was lost:* LOST emits `block-store` before `end-run`, and `refresh()`
  returns at once while `store.blocked` (one line in `web/src/app/files.ts:29-36`). Test: a run cut by `lock-lost` calls
  `store.list` zero times afterwards.

**What stays outside the machine and decides no state:** the two handles (item 3); the transport's live worker record
and its call ids; `run.ts`'s counters `runs`, `sessionRuns` and `graphCount`, and its current run; the drop record.

---

## 7. Module boundaries

### 7.1 The modules

**`web/src/engine/machine.ts` (new)**
- Owns the life cycle.
- Exports `Ticket`, `State`, `RowName`, `StateOf`, `Machine`, `Step`, `Env`, `Event`, `TicketedEvent`, `PlainEvent`,
  `Effect`, `TicketedEffect`, `Answers`, `AnswersOk`, `Equal`, `Expect`, `Answered`, `AnyAnswer`, `Answer`, `Reply`,
  `Ending`, `Line`, `QueuedRun`, `initial`, `transition`, `ticketOf`, `cutResult(error, kind)`, `lost(reason)`,
  `RC_RESET`. `mint` and `issue` are not exported.
- Imports types only.
- Must not use `Date.now`, timers, `console`, signals, the transport or module-level variables; must not mutate its
  inputs; must not match an error's text. Two casts in the whole file: `mint()` and the table lookup (item 4.2).

**`web/src/engine/client.ts` (the transport)**
- Owns the live worker record (`{ n, worker, pending, interrupt, ended }`, or none), the call ids, the store's wiring
  (`store.attach`), and, as read-only facts for the tests and the test hook, `worker`, `about`, `startup` and
  `storeError`.
- `ended` is what `end()` rejected the record's pending calls with, null while the worker is live. It is for one
  moment: a step of the start (`mount`, `boot`, `startup`) is answered and `end()` is called in the same tick. The
  step's call is settled already, so `end()` finds nothing to reject, and the start's next line runs after `end()` has
  returned. With `ended` set, a call on that record rejects at once with what `end()` said, and the start says nothing
  more: no op is posted to the dead worker, the facts are not written, the store is not attached again, and no
  `started` is said. It decides no state: the machine's guard would drop a late `started` anyway. Test:
  `web/test/client.test.ts`, "a start whose step is answered in the same tick as end()".
- Its interface, in three parts:

  ```ts
  /** Read ops only: safe at any time, from anywhere. */
  export interface Reader { query<K extends keyof ReadOps>(op: K, args?: ReadOps[K]["args"]): Promise<ReadOps[K]["result"]> }
  /** What changes the engine. Only the effect performer holds this. */
  export interface Lifecycle {
    start(n: number, build: Build | null, reply: Reply<"start-worker">): void;
    end(n: number, ending: Ending): void;
    run(n: number, args: Ops["run"]["args"], onLog: (text: string) => void): Promise<RunResult>;
    interrupt(n: number): void;
  }
  /** The build's files, before a worker exists. */
  export interface Builds {
    cached(): Promise<boolean>;
    download(o: { onProgress?: (p: Progress) => void; signal?: AbortSignal }): Promise<Downloaded>;   // Downloaded gains `build`
    build(): Promise<Build | null>;        // the list, fetched fresh and checked (checkBuild); null for the normal start
    forgetDownload(): Promise<void>;
  }
  ```

- `n` is a plain `number` here: to the transport it is only the live worker's name, for its own checks, and the
  transport never puts it on an event (`reply` does). The performer passes the effect's ticket; a test of the transport
  alone passes 1, 2, 3 and makes no ticket.
- `start` is synchronous up to the worker's creation: it makes the worker, records it as live, attaches the store, and
  then sends `mount`, `boot` and `startup` in order, saying `stage`, `started`, `start-failed` or `crashed` through
  `reply`. It fetches nothing first: the list comes in as `build`. No WebAssembly, or a worker that cannot be made, is
  `start-failed`. **With a worker still live it throws**: it does not quietly end the old one, as `start()` does today
  (`web/src/engine/client.ts:269`). The machine always ends a worker before it starts another (item 7.4).
- `end(n, ending)` terminates the live worker, detaches the store and rejects every pending call of that worker with
  a `ClientError` of `ending.kind`. With no live worker it does nothing (a start that failed before a worker existed).
  With another worker live it throws: that is a bug in the caller.
- `run` resolves with the worker's result. It rejects with kind `op` when the worker answered the `run` op with an
  error (the performer then says `run-failed`), and with the ending's kind when the worker was ended (the performer
  then says nothing: the machine has already cut the run).
- The start sequence and every call go through the worker's own record, so a step that resumes after `end()` cannot
  reach the next worker.
- Must not restart, count crashes, hold a timer, make run results, know a state name, or `await` anything before it
  makes a worker.
- Removed: `restart`, `stop`, `breakRun`, `keepWaiting`, `clearBreak`, `resetAt`, `running`, `breakTimer`,
  `errorRestarts`, `gen`, `onRestart`, `onStatus`, the public `call`, the `busy` and `no-engine` run results,
  `resetResult` (now `cutResult` in the machine), the `busy` kind.
- `download()` returns the list's `build` with its answer (also when it resolves `{cached: false}` on a snapshot
  start), so the visitor's start does not fetch the list twice. `build()` is the list fetch and the checks that
  `start()` has today (`web/src/engine/client.ts:274-280`).

**`web/src/engine/worker.ts`**
- Owns Pyodide, `/work` and the op queue.
- The handlers are three objects, one per set of item 7.2, each typed by its own set
  (`{ [K in keyof ReadOps]: … }` and the same for `LifecycleOps` and `JournalOps`), and `ops` is the three spread together.
  A new op cannot be added without choosing its set, here and in `types.ts`.
- Posts `{ stage }` at today's `status()` sites: `web/src/engine/worker.ts:304` download, `:318` unpack, `:338` and
  `:369` python, `:388` files, `:399` packages, `:415` engine.
- Must not post text for the page to match.

**`web/src/app/engine.ts` (the controller)**
- Owns the one `machine` variable, `dispatch`, `enqueue`, `reply`, `perform`, `view`, the two handles, the drop record,
  the writer of `engine`, and the words (`FAILED`, `FAILED_TWICE`, `UPDATED`, `stageWords`, `stageStatus`, `SAY`).
- Exports today's actions, `connectEngine`, `connectRun(handlers)`, `call`, `stagesOf`, `fromClient`, `drops`.
- `connectEngine({ client, lock, snapshot, manual, graceMs, canInterrupt })` wires the controller: it builds `Env`,
  keeps the transport's `Reader` in a module variable for `call`, and passes its `Lifecycle` and `Builds` to
  `performer()`, which returns `perform`. No other function in the module can reach them. `graceMs` (5000) and
  `canInterrupt` are optional. `canInterrupt` is by default whether a `SharedArrayBuffer` exists, the same test by
  which the transport makes the interrupt buffer; a controller test passes `false` to reach Break on a page that
  cannot interrupt.
- `open()` is the page load, as today (`web/src/main.tsx:73`): it calls `initial(env)` and applies the step (writes the
  signal, performs `take-lock`) through the same function `dispatch` uses. An action before `open()` throws, and so does
  a second `open()` without a new `connectEngine`: one machine for each wiring.
- A second `connectEngine` replaces the wiring, as today: it clears the machine, the queue, the two handles and the drop
  record, and sets `wiring` to a new object, so that every `reply` of the earlier wiring does nothing from then on
  (item 5.1). That is how the Node tests start each test afresh (item 7.4).
- `dispatch` is a queue. An event raised while a step's effects are being performed (a performer that answers at once)
  runs after them. An action called from an event handler finds the queue empty, so its step has run when `dispatch`
  returns, and `dispatch` returns it: `run()` answers `"started"`, `"queued"` or `"refused"` at once from that step.
- `run()` must not be called while a step is in progress (from inside a performer, or from a handler given to
  `connectRun`): `dispatch` would return `null` and `run()` would have no answer. It is a programming error, so
  `run()` throws, and it checks before it dispatches, so nothing is enqueued and no run starts later. Code that wants
  to run something when a run ends must do it after the step, for example after the run's promise resolves. Test
  (`web/test/app.test.ts`): an `ended` handler that calls `run()` gets the throw; the state is `ready` afterwards and
  `drops()` is empty. "While a step is in progress" is wider than the handlers: the controller writes the `engine`
  signal and `run.ts` writes `lastRun` and `log` during a step, so a signal effect on any of those three that calls
  `runCode` or `runCommand` (which go through `run()`) gets the throw too. SPEC section 8 and the header of
  `web/src/app/App.tsx` say so for step 4.
- A step's effects are performed even when a subscriber of the `engine` signal throws (such an effect, say): the
  signal is written first, in a `try`, and the effects are performed in its `finally`, in order, `end-run` last. A
  step whose state is shown and whose effects are not would, on a reset, leave the old worker live. The subscriber's
  error still reaches whoever raised the event. A performer that throws is a bug in the wiring (the transport's
  `start` with a worker still live): the step's later effects are then not performed, the error reaches whoever raised
  the event, and the events queued behind it run with the next event. Test (`web/test/app.test.ts`): a subscriber
  that throws on `starting-list` during a reset; the old worker is ended, the list is fetched and the cut run ends.
- Must not branch on a state to choose what happens next, and must not import a `.tsx`.

**`web/src/app/run.ts`**
- Owns `log`, `lastRun`, `results`, `macros`, `data`, `rows`, `memory`, `graphs`, `graphIndex`, `history`, the counters
  `runs`, `sessionRuns`, `graphCount`, and the current run's promise.
- Exports `handlers`, `{began, log, ended, engineReady, engineGone}`, which `web/src/main.tsx` gives to `connectRun`.
- `runCode` dispatches through `engine.run()` and returns the current run's promise, or a promise of null when nothing
  ran now (its signature is unchanged: item 9).
- `runCommand`'s `accepted` is true for `"started"` and `"queued"`.
- `refreshData()` and the new `moreRows()` are the only writers of `rows` (item 7.2).
- Must not subscribe to `engine`, keep `was` or `queued`, or compare state names.

**`web/src/app/files.ts`**
- Gains `own()` (unblock the store, `keep`, `refresh`) and `block()`; `refresh()` returns at once while the store is
  blocked. `connectFiles(store, storage)` takes what `connectEngine` no longer needs.

**`web/src/app/state.ts`**
- Owns the signal objects and the helpers; exports read-only views and the three writer objects.
- `engine` starts as `{ s: "checking-lock" }`. `about` is gone (item 9). `rows` is read-only, written by `run.ts` alone.
  `engineBytes()` lives here.
- Must hold no engine logic.

**Tests**
- `web/test/machine.test.ts` (new): the table test over 16 rows by 24 events with named variants of the cells that
  depend on a payload or on the machine (owned, cached, manual, `canInterrupt`, `crashes`, a queued run, the same
  stage, the reason of TWICE); the property tests of item 6; the scenarios of item 8.
  **It makes no ticket and no machine by hand.** Each row's machine is reached from `initial(env)` by a short list of
  events (the path of a normal load for most; `reset` for `starting-list`; two crashes for `failed-twice`), which also
  shows that every row can be reached. An event's `n` is taken from the effect it answers (a helper finds the effect by
  its `do` in the last step, as `reply` does), or from `ticketOf(state)`. A stale `n` is a ticket of an earlier request
  on the same path, or, in `checking-lock`, where no earlier ticket exists, one from a second machine driven further.
- `web/test/imports.test.ts` (new): the import graph and the source-text checks of items 5, 6 and 7.4.
- `web/test/app.test.ts`: the controller on a stand-in transport. The loose `AnyEngineState` (`web/test/app.test.ts:15-16,
  27-28`) goes: a helper `state(name)` asserts the state's name and returns that member of `EngineState`. The row that
  uses the name `UpdatedError` for an unknown error (`:483`) takes another name. The fixture `ABOUT` (`:40`) and the
  assertion on `S.about` (`:147`) go with the signal; a start is answered with `started`, which carries nothing.
  It also holds the three controller tests of additions A2, A3 and A4: a reply of an earlier wiring (item 5.1), `run()`
  during a step (above), and the Break timer across two runs with a simulated clock (item 5.2).
- `web/test/client.test.ts`: the transport alone. The row that uses `UpdatedError` (`:352`) takes another name. Its
  life-cycle assertions (`onRestart`'s order, the Break deadline, failed twice) move to `machine.test.ts`.
- `web/test/harness.ts` gains the helper of ruling 6, about ten lines: `startWorker(client, build)` calls
  `client.start` with a number of its own and resolves at `started`, or rejects with the `start-failed` or `crashed`
  answer. `web/test/engine.test.ts` and `web/test/files.test.ts` use it; a restart there is `end` then `startWorker`.

### 7.2 The typed op map, and operations outside the machine

```ts
// web/src/engine/types.ts
/** Ops that change the engine. Sent only by the transport's start() and run(), which only the effect performer calls. */
export interface LifecycleOps {
  mount:   { args: MountArgs; result: void };
  boot:    { args: BootArgs; result: About };
  startup: { args: void; result: Startup };
  run:     { args: { code: string } & RunOptions; result: RunResult };
}
/** Ops DECLARED to change nothing: not the data, r(), e(), the macros, the matrices, the graphs, the sort order, the log
 *  or /work. Anyone may send one. The declaration is tested (web/test/engine.test.ts), not proved. */
export interface ReadOps {
  describe:      { args: DescribeArgs; result: DataSummary };
  describe_file: { args: { path: string }; result: DataSummary };
  matrix:        { args: { name: string }; result: Matrix };
  macros:        { args: void; result: Macros };
  browse:        { args: DescribeArgs; result: BrowseRows };
  memory:        { args: void; result: Memory };
  files:         { args: void; result: FileInfo[] };            // /work as it is: for the tests, not for views
  read:          { args: { path: string }; result: Uint8Array };
}
/** Ops that copy a page change into /work (named `MirrorOps` when this was written; renamed `JournalOps` after step D).
 *  Sent only by the function the transport gives to store.attach.
 *  Step D deletes these four and the interface holds `sync` alone. */
export interface JournalOps {
  write:  { args: { path: string; data: Uint8Array; seq?: number }; result: void };
  mkdir:  { args: { path: string; seq?: number }; result: void };
  remove: { args: { path: string; seq?: number }; result: void };
  rename: { args: { from: string; to: string; seq?: number }; result: void };
}
export type Ops = LifecycleOps & ReadOps & JournalOps;
export type Op = keyof Ops;
/** The read ops the page asks for through the controller's call: not the two views of /work. */
export type ViewOp = Exclude<keyof ReadOps, "files" | "read">;
export type ToWorker = { [K in Op]: { id: number; op: K; args: Ops[K]["args"] } }[Op];
export type FromWorker = { id: number; result: Ops[Op]["result"] } | { id: number; error: string; name: string }
                       | { id: number; log: string } | { stage: Stage };

// web/src/engine/worker.ts: one handler object per set, so an op's set is chosen on both sides
type Handlers<S> = { [K in keyof S]: (args: S[K] extends { args: infer A } ? A : never, id: number) => unknown };
const lifecycle: Handlers<LifecycleOps> = { mount, boot, startup, run };
const read: Handlers<ReadOps> = { describe, describe_file, matrix, macros, browse, memory, files, read: readFile };
const journal: Handlers<JournalOps> = { write, mkdir, remove, rename };
const ops = { ...lifecycle, ...read, ...journal };
```

Step D: `JournalOps` holds one op, `sync: { args: void; result: void }`, and the worker's third object is
`journal: Handlers<JournalOps> = { sync }`.

`OpResults` (`web/src/engine/types.ts:72-76`) is deleted: `Ops` says the same and more. The name `ReadOps` stays; its
comment says "declared".

**What is proved, and what is declared.**

- **Proved, by the compiler:** nothing outside an effect can *send* an op that is not in `ReadOps`. `Reader.query` takes
  `keyof ReadOps`; the controller's `call` takes `ViewOp`; `mount`, `boot`, `startup` and `run` leave the transport only
  inside `start()` and `run()`, through a private `#send`, and those two are on the `Lifecycle` interface, which
  `connectEngine` hands to `performer()` and to nothing else.
- **Declared, with evidence:** that the ops in `ReadOps` change nothing. They are calls into Python, and no type can say
  what a Python function leaves alone. Putting an op in `ReadOps` is a claim by whoever adds it. The evidence is a reading
  of the code (the table below) and a test that would notice the changes a visitor could see (the fingerprint below).
- **What being wrong would cost:** a read op that did change something could not corrupt the machine, because no
  transition reads what it changes and it raises no event. It could only make the data, the results or a file differ
  from what the visitor's code left, which is a bug in that op, found by the fingerprint test if the change is one the
  fingerprint sees.

**The reading of the code, today.** Each op is read-only in the worker and in Python:

| Op | Worker (`web/src/engine/worker.ts`) | Python | Changes anything? |
|---|---|---|---|
| `describe` | `:444` | `Engine.data_summary` (`src/dofile/engine.py:515-524`): expands the varlist, reads names, types, formats and labels | No. |
| `browse` | `:454` | `Engine.data_rows` (`src/dofile/engine.py:559-575`): formats `limit` rows | No. It builds `limit` × variables strings; the page asks for 50 rows at a time. |
| `matrix` | `:445` | `Engine.matrix` (`src/dofile/engine.py:490-513`): looks the matrix up and copies its values | No. (It may create the session's empty table of user matrices, which nothing can observe.) |
| `macros` | `:452` | `Engine.macros` (`src/dofile/engine.py:549-557`) | No. |
| `memory` | `:456` | `Engine.memory` (`src/dofile/engine.py:577-579`); the worker adds the heap's size | No. |
| `describe_file` | `:447-451` | `Engine.describe_file` (`src/dofile/engine.py:526-547`): reads the file into a dataset of its own, apart from the session | Not the data, r(), e() or the log. **It reads the whole file**, so a very large `.dta` can grow the worker's memory for good, or end the worker (then `crashed`, as for any crash). |
| `files`, `read` | `:458-459` | none | No. |

None of them runs a Stata command, so none touches r(), e(), the sort order or the log. A Break cannot be asked during
one (`_busy` is false: `src/dofile/browser.py:28-30`).

**The fingerprint test** (`web/test/engine.test.ts`, with the real worker). One helper, `fingerprint(client)`, gathers
everything about the engine that a visitor's code or the page can observe. It needs no new engine API: it is made from
the read ops and one `run` of commands that change nothing.

| Part of the state | Taken with |
|---|---|
| The variables, in order, with type, format, label and value label; the counts; the file name | `query("describe")` |
| Every value of every observation, in the data's order | `query("browse", { limit: nobs })` |
| The locals and the globals | `query("macros")` |
| The data's size | `query("memory")`, `data_bytes` only (the heap may grow) |
| The files in `/work`, with sizes and times | `query("files")` |
| r() and e(): scalars, macros and the matrices' sizes; that the probe changed neither | the probe run's `results`, with `r_changed` and `e_changed` false |
| The values of each matrix of r() and e() | `query("matrix", { name })` for each name in `results` |
| The sort order, the user's matrices, the graphs in memory | the probe run's `log` |

The probe is one `run` of commands. The first two were checked against the engine to leave r() and e() as they were.
The third, `graph dir`, is the only command that lists the graphs in memory, and it sets r(list), as Stata's does
(corrected when step C was built: this text first said all three left r() alone). So the probe has it only once r() is
already what it leaves:

```stata
display "sorted by: `: sortedby'"
matrix dir
graph dir
```

The test, after a run that leaves data in a sort order, r(), e(), macros, a matrix, a graph and files, has two rounds:
the first with the probe's first two commands, so that r() is what the visitor's code left (the scalars of a
`summarize`); the second after one `graph dir`, with all three, so that the graphs in memory are seen and r() is
`graph dir`'s own before and after each probe. In each round:

1. `fingerprint()` twice in a row gives the same value. That shows the helper itself changes nothing it reads, and it
   covers the five read ops the helper is made of.
2. For each op in `ReadOps`, taken from a `Record<keyof ReadOps, …>` of argument lists (so a new read op fails the check
   until it has a row), with arguments other than the defaults (a varlist, an offset, a file's path, a matrix's name):
   call it twice, then compare `fingerprint()` with the one from step 1.

A last part shows the fingerprint is not blind: a run that changes the sort order, a macro, a matrix, r(), a value,
e(), a file, a format or the graphs gives another fingerprint each time.

A new kind of state (frames, say) is added in one place, the helper. What the fingerprint does not see, and the
declaration alone covers: a change below a variable's display format (the values are compared as `list` prints them),
and state inside Python that no command shows (a cache, the heap). A check at full precision would need a new op that
hashes the data; it is not added in step C.

**One provider of read ops.** The page has one way to ask the engine for data: the controller's exported `call`
(`web/src/app/engine.ts`), typed to `ViewOp`. `run.ts` and the views are both callers of it; neither holds the
transport.

| Caller | Ops | When | Where the answer goes |
|---|---|---|---|
| `run.ts`, `refreshData()` | `describe`, `browse`, `macros`, `memory` | after each run; `memory` also when an engine is ready | the shared signals `data`, `rows`, `macros`, `memory` |
| `run.ts`, `moreRows()` (new) | `browse`, from the next offset | the Data tab's "Show 50 more" | appended to `rows` |
| A view (step 4c) | `matrix` by name, `describe_file` by path | when that view shows a matrix, or a `.dta` tab | the view's own state: nobody else shows it |

`rows` has two writers today, which is why it is the one signal with an identity check in a view
(`web/src/app/state.ts:64-66`): `refreshData()` replaces it and the Data tab was to append to it through
`call("browse")` (`web/src/app/output/tabs.tsx:8`, the header of `web/src/app/App.tsx`, SPEC section 8). The append
moves into `run.ts`:

```ts
/** "Show 50 more": the next rows of the data, appended to `rows`. Nothing is appended if a run or a new engine replaced
 *  `rows` meanwhile. Resolves true when rows were added. */
export async function moreRows(count = 50): Promise<boolean>
```

Then `rows` has one writer and is a `ReadonlySignal` like the other run signals, the identity check is inside the
module that owns the signal, and a view never calls `browse`. This belongs in step C and not in step 4c: step 4c is not
built (the Data tab is a placeholder), the contract "each signal has one writer" is this step's, and it costs about ten
lines and one test. What step 4c was told changes in the same commit (item 9).

**What happens to a read op, today and after this step (unchanged):**

| When it is sent | What happens |
|---|---|
| No worker (`checking-lock`, `checking-cache`, `none`, `asking`, `declined`, `downloading`, `starting-list`, `failed`, `failed-twice`, `other-tab-idle`, `other-tab-taking`) | Rejected at once with kind `no-engine` (`web/src/engine/client.ts:360`). |
| The worker is starting (`starting-worker`) | Posted. The worker answers it after `mount` and, for the six engine reads, after `boot` (`await booted`). |
| A run is in progress | Posted. The worker runs one op at a time (`web/src/engine/worker.ts:499-506`), so it is answered after the run, with the data as the run left it. |
| The worker is ended while the op is pending | Rejected with the ending's kind: `reset` (with the reset's kind), `stopped`, `failed` or `failed-twice`. |

No read op raises an event, so none can change a state or be dropped by the guard.

**The other enforcement, by test:**

| Rule | Test |
|---|---|
| Views do not reach the transport | The import graph (item 6). |
| The worker is posted to in one place | `postMessage` occurs once in `web/src/engine/client.ts`, in `#send` (source text). |

**Where the file ops sit.** `write`, `mkdir`, `remove` and `rename` are not read-only (they change `/work`) and are
not lifecycle (no state depends on them). They are the third set, `JournalOps`, with one sender: the function that
`start()` gives to `store.attach`, typed to `keyof JournalOps`. The store is attached exactly while a worker is live;
`end()` detaches it, and a change made with no worker is copied by the next `mount`, as today. Step D changes
`JournalOps` (then still `MirrorOps`) to `sync` alone and deletes that function's arguments, the four handlers in the worker and `onFileError`;
nothing in the machine, the controller, `ReadOps` or `LifecycleOps` changes. (Step D did so. The function sends `sync`
with no arguments, so the cast in it went too; a `sync` that the worker answers with an error is said on the console.)

### 7.3 A failed save and the machine

"Save" is a write to the file store. Five things can go wrong; one concerns the machine.

| Failure | What happens today | Must the machine know? |
|---|---|---|
| The store refuses a page change (quota, the store blocked, a bad path) | `store.write` and the others reject with the browser's error; the transaction keeps nothing, no `pending` row is written and nothing is posted (`web/src/engine/store.ts:136-148`). | **No.** `/work` and the store still agree. It is the caller's business (4b's `save-failed` banner, 4a's upload). |
| The store took a page change but the worker could not put it into `/work` (`MirrorError`) | The worker takes the store's version of what the page changed; `onFileError` is called, and nothing in the page listens (`web/src/engine/worker.ts:137-151`, `web/src/engine/client.ts:325-327`). | **No.** No state depends on it. `onFileError` stays inside the transport, untouched; step D deletes it with `MirrorError`. (Step D: deleted. A `sync` that `/work` cannot take is said on the console.) |
| The store refuses a run's files (`store_error`) | The result carries `store_error`; the worker remembers the paths and the next run writes them (`web/src/engine/worker.ts:157-186`). `run.ts` keeps it on the run's log item. | **No.** It travels inside `RunResult`, which the machine passes on unread. |
| The worker cannot open the store at `mount` | The engine runs; `startup.storeError` says why; the transport attaches the store without a journal (`web/src/engine/client.ts:344-346`). Step D: such a worker cannot read the journal, so the transport detaches the store from it, and the page's changes do not reach its `/work`. | **No.** `started` is the same event either way. |
| The browser closes the database under the page | The worker is restarted, kind `crash`, "the browser closed the file storage", counted like a crash (`web/src/engine/client.ts:321-329`). | **Yes.** The remedy is a new worker that copies the store afresh, which is a transition. It is `crashed {cause: "storage"}`, raised through the live worker's `reply`; with no worker nothing is raised, since the next start copies the store anyway. |

So the machine knows of one store failure, and only as a cause of `crashed` with its own reason text. A `save-failed`
event with a flag in the state is rejected: no transition would read it, and what a view needs (`lastRun.store_error`,
the rejection of `store.write`) it has already.

For step D: with the journal as the only channel, the reason the code gives for this restart (the seqs may start again
below `upTo`) is gone. Whether a closed database still needs a new worker is D's question. If not, D deletes the
`storage` member of `cause`, its reason string and the `onClosed` wiring, and nothing else. (Step D kept the restart, with
its test, and left the question to the maintainer: a deleted database still leaves `/work` with files the store no longer
has, which no journal row can say, so something must copy the whole store again.)

### 7.4 Single instances

Some things must exist once. None of them is made a singleton class (a private constructor, `getInstance`): the Node
tests construct many transports and machines, and that is what makes them testable. Each is held to one where the page
is put together, `web/src/main.tsx`, or by the machine.

| What must exist once | What "once" means | Enforced by | Where |
|---|---|---|---|
| **One live worker** | At any moment a tab has at most one engine worker. This is the one that matters at run time: a second worker costs a phone hundreds of MB and would answer for an engine the page no longer shows. | **A property test** over every cell of `transition`, and **a runtime check**: the transport's `start` throws while a worker is live. | `web/test/machine.test.ts`, `web/src/engine/client.ts` |
| The transport | One `EngineClient` for each page. | **A test** (source text): under `web/src`, `new EngineClient(` and `new Worker(` each occur once, in `main.tsx` (today `web/src/main.tsx:27, 28`). | `web/test/imports.test.ts` |
| The controller's machine and its queue | One `machine` variable and one queue for each page. They are module variables of `web/src/app/engine.ts`, and a module is evaluated once for each page. | **The module system**, plus **a test** (source text): `connectEngine(`, `connectFiles(` and `connectRun(` are called only in `main.tsx` (today `web/src/main.tsx:55, 56`); and **a runtime check**: a second `open()` on one wiring throws. | `web/test/imports.test.ts`, `web/src/app/engine.ts` |
| The tab lock's handle | One `tabLock(…)` for each page, so `lock-lost` has one source. | **A test** (source text): `tabLock(` is called once, in `main.tsx` (today `web/src/main.tsx:56`). | `web/test/imports.test.ts` |
| One tab owning the files and the engine | For each origin, the tab that holds the Web Lock `dofile-engine`. | **The browser's lock**, and the machine: `take-lock`, `lock-lost`, LOST with `block-store` (table B); the store starts blocked (`web/src/app/store.ts:9`). Without Web Locks every tab owns them, which SPEC section 7 accepts. | `web/src/engine/tab.ts`, `web/src/engine/machine.ts`, the e2e test with two pages |
| The page's `store` object | One `FileStore` for the page's thread. The worker opens its own on the same database: **two for each page, one in each thread, by design** (SPEC section 7); IndexedDB transactions keep them in step. | **A test** (source text): `openStore(` is called in exactly two places, `web/src/app/store.ts` and `web/src/engine/worker.ts` (today `:8` and `:104`). | `web/test/imports.test.ts` |
| One writer for each signal | Each single-owner signal is written by one module. | **The compiler** (`ReadonlySignal`) and **a test** (each writer object is imported only by its owner). | item 6 |
| The machine | Not a thing that exists once: it is a value. `transition` gives a new one each step, and the tests get as many as they like from `initial()`. | Nothing to enforce. | |

The source-text checks read the code with comments removed, and leave the definitions aside. They cover `web/src`
only: the tests construct and connect freely.

**One live worker, in full.** The states with a live worker are `starting-worker`, `ready`, `running`, `breaking` and
`waiting`. `starting-list` holds the ticket of a worker that is not made yet.

- *In the table.* The property test runs every cell and checks three things. `start-worker {n}` is emitted only from
  `downloading` and `starting-list`, which have no live worker, and the new state is `starting-worker` with that
  ticket. A transition from a state with a live worker to any state that does not hold the same worker has exactly one
  `end-worker` for it. No other transition has an `end-worker`. A second test folds the effects of each scenario of
  item 8 over a count of live workers and checks that it never passes one.
- *In the transport.* `start(n, …)` with a worker still live is a programming error and throws. Today's `start()` ends
  the old worker and goes on (`web/src/engine/client.ts:269`), which would hide a broken invariant; a throw fails a
  test instead of leaking a worker. `end(n, …)` with another worker live throws likewise (item 7.1).

**`connectEngine` called twice.** Two choices: a second call throws unless the first wiring was taken down with a
`disconnect()`, or a second call replaces the wiring, as today. This design takes the second. It is the smaller one:
it needs no `disconnect()` and no clean-up step in every test, and what the throw would catch, a second wiring in the
page, is already caught by the source-text test, since `main.tsx` is the only caller and calls it once. What replacing
must do is stated in item 7.1: clear the machine, the queue, the handles and the drop record, and replace `wiring`,
so nothing of the old wiring can act: not its timers, and not a late answer to one of its effects (item 5.1).

---

## 8. Race scenarios

Each is a test in `web/test/machine.test.ts`: a short list of events, with the state and every effect, in order, after
each. After a normal load with the files cached, the tickets are: the lock 1, the cache check 2, the download 3, the
worker 4. "Today" is where the race is tested or guarded now.

**1. A reset, then a crash of the new start, with late answers.** Today: `web/test/app.test.ts:893`,
`web/test/client.test.ts:630`. From `ready {worker 4}`, `crashes` 0.
1. `reset` → `starting-list {worker 5, done {}}`, `crashes` 0. Effects: `end-worker {4, reset user}`,
   `fetch-list {5}`, `add-reset-banner {"reset by you", user}`, `say reset`, `engine-gone`.
2. `reset` → not valid.
3. `list-checked {5, build}` → `starting-worker {5}`. Effects: `start-worker {5, build}`.
4. `crashed {5, error}` → `starting-list {worker 6}`, `crashes` 1. Effects: `end-worker {5, reset crash}`,
   `fetch-list {6}`. No banner, nothing said.
5. `stage {5}`, `started {5}` → stale.
6. `list-checked {6, build}` → `starting-worker {6}`. Effects: `start-worker {6, build}`.
7. `started {6}` → `ready {worker 6}`, `crashes` 0. Effects: `close-dialog download` (focus the editor), `say ready`,
   `engine-ready`. "Engine ready" is said once.

**2. The lock lost during a download.** Today: `web/src/app/engine.ts:164, 179`; no test. From `asking {queued null}`,
issued 2.
1. `start` → `downloading {download 3}`. Effects: `start-download {3}`.
2. `lock-lost` → `other-tab-idle`, `crashes` 0. Effects: `abort-download {3}`, `block-store`, `engine-gone`,
   `show-dialog other-tab`.
3. `download-progress {3}`, `download-done {3}` → stale. No `start-worker` is ever emitted.

**3. A crash while starting, on the first start.** Today: `web/test/app.test.ts:391`. From `downloading {download 3}`.
1. `download-done {3, build}` → `starting-worker {worker 4, done {download}}`. Effects: `start-worker {4, build}`,
   `say {stage first}`.
2. `crashed {4, error}` → `starting-list {worker 5, done {}}`, the queued run kept, `crashes` 1. Effects:
   `end-worker {4, reset crash}`, `fetch-list {5}`. No banner and no "Engine reset": no engine had been ready.
3. `list-checked {5, build}` → `starting-worker {5}`. Effects: `start-worker {5, build}`.
4. `started {5}` → `ready {worker 5}`, `crashes` 0. Effects: `close-dialog download` (focus the editor), `say ready`,
   `engine-ready`.

**4. Two take-overs.** Today: `web/test/app.test.ts:414, 850`. From `other-tab-idle`, issued 1.
1. `take-over` → `other-tab-taking {2}`. Effects: `take-lock {2, steal}`.
2. `take-over` → not valid: one steal.
3. `lock-lost` → `other-tab-idle`. No effects; the dialog stays.
4. `lock-answered {2, owned}` → stale. The store stays blocked.
5. `take-over` → `other-tab-taking {3}`. Effects: `take-lock {3, steal}`.
6. `lock-answered {3, owned}` → `checking-cache {id 4}`. Effects: `close-dialog other-tab`, `own-files`,
   `check-cache {4}`.

**5. Break, and its three endings.** Today: `web/test/files.test.ts:446, 472, 492`,
`web/test/client.test.ts:448-494`, `web/test/app.test.ts:343`. From `running {worker 4}`, `at` 1000, `graceMs` 5000.
1. `break` → `breaking {resetAt 6000}`. Effects: `interrupt {4}`, `start-break-timer {4, 5000}`.
2. `break` → not valid: the first deadline stays.
3. Then one of:
   - **The engine takes the Break (rc 1).** `run-ended {4, result rc 1}` → `ready {worker 4}`. Effects:
     `cancel-break-timer`, `end-run {the result, rc 1}`. A `break-timeout {4}` that still comes → not valid.
   - **The run had finished (rc 0).** `run-ended {4, result rc 0}` → `ready {worker 4}`. Effects:
     `cancel-break-timer`, `end-run {the result, rc 0}`: the same object, not rewritten. The same holds for a Stata
     error, rc 111 say.
   - **The timer first (rc 9998).** `break-timeout {4}` → `starting-list {worker 5}`, `crashes` 0. Effects:
     `cancel-break-timer`, `end-worker {4, reset break}`, `fetch-list {5}`,
     `add-reset-banner {"the code did not stop at Break", break}`, `say reset`, `engine-gone`,
     `end-run {rc 9998, kind break}`. A `run-ended {4}` that still comes → stale.
4. With "Don't reset: wait for it" after step 1: `keep-waiting` → `waiting`. Effects: `cancel-break-timer`. Then
   `run-ended {4, result}` → `ready {worker 4}`. Effects: `end-run {the result}`, with its own rc: 1 if a command
   followed the one that was running, else that command's.

**6. A second crash.** Today: `web/test/client.test.ts:428`, `web/test/app.test.ts:183, 226`. From `ready {worker 4}`,
`crashes` 0.
1. `crashed {4, error, reason memory}` → `starting-list {worker 5}`, `crashes` 1. Effects:
   `end-worker {4, reset crash}`, `fetch-list {5}`, `add-reset-banner {"the engine crashed (…)", crash}`, `say reset`,
   `engine-gone`.
2. `list-checked {5, build}` → `starting-worker {5}`. Effects: `start-worker {5, build}`.
3. `crashed {5, error, reason memory}` → `failed-twice {reason memory}`, `crashes` 0. Effects:
   `end-worker {5, failed-twice}`, `close-dialog download`, `say failed-twice`, `warn`. No `forget-download`, because
   the reason is memory; with `unknown` or `download` it comes after `end-worker`.
4. `started {5}` → stale. `start`, `reset` → not valid.

Variant, the count survives a failed start (`web/src/engine/client.ts:352`): `crashed` (`crashes` 1), `list-checked`,
`start-failed` → `failed`, `crashes` still 1; `start`, `download-done`, `crashed` → `failed-twice` at once.

**7. The lock lost while the cache check is pending.** Today: `web/test/app.test.ts:239, 830`.
1. `checking-cache {id 2}` + `lock-lost` → `other-tab-idle`. Effects: `block-store`, `engine-gone`,
   `show-dialog other-tab`.
2. `cache-checked {2, cached}` → stale. No download, no worker.

**8. "Not now" during the download, which then completes.** Today: `web/test/app.test.ts:917`.
1. `downloading {download 3}` + `decline` → `declined`. Effects: `abort-download {3}`, `close-dialog download`,
   `say download-stopped`.
2. `download-done {3}` → stale.

**9. A run cut by losing the lock.** Today: `web/test/app.test.ts:906`.
1. `running {worker 4}` + `lock-lost` → `other-tab-idle`, `crashes` 0. Effects: `end-worker {4, stopped}`,
   `block-store`, `engine-gone`, `show-dialog other-tab`, `end-run {rc 9998, kind stopped}`.
2. `run.ts` does not set `lastRun` for kind `stopped` (as `web/src/app/run.ts:85`), and `refresh()` does not list.

**10. A crash during a run, with the result on its way.**
1. `running {worker 4}` + `crashed {4, error}` → `starting-list {worker 5}`, `crashes` 1. Effects:
   `end-worker {4, reset crash}`, `fetch-list {5}`, `add-reset-banner {"the engine crashed (…)", crash}`, `say reset`,
   `engine-gone`, `end-run {rc 9998, kind crash}`.
2. `run-ended {4}` → stale.

**11. A wrong ticket: an older download's progress.** Today: `web/src/app/engine.ts:161`.
1. `downloading {download 3}` + `stop-download` → `declined`. Effects: `abort-download {3}`, `close-dialog download`,
   `say download-stopped`.
2. `start` → `downloading {download 4}`. Effects: `start-download {4}`.
3. The first download's performer still holds its `reply`, bound to 3, and says progress:
   `download-progress {3}` → stale. The controller test asserts the drop record is exactly
   `[{type: "download-progress", n: 3, row: "downloading", why: "stale"}]`.
4. What cannot be written: `reply({type: "download-progress", n: 4, …})` (no `n` in an answer),
   `dispatch({type: "download-progress", …})` (not a `PlainEvent`), `n: 4` (not a `Ticket`). Each is a line marked
   `@ts-expect-error`.

**12. The queued run through a crash.** Today: `web/test/app.test.ts:163, 530`.
1. `declined` + `run` → `asking {queued}`. Effects: `show-dialog download {forRun true}`.
2. `start` → `downloading {download 3, queued}`. Effects: `start-download {3}`.
3. `download-done {3, build}` → `starting-worker {worker 4, queued}`. Effects: `start-worker {4, build}`,
   `say {stage first}`.
4. `crashed {4, error}` → `starting-list {worker 5, queued}`, `crashes` 1. Effects: `end-worker {4, reset crash}`,
   `fetch-list {5}`.
5. `list-checked {5, build}` → `starting-worker {5, queued}`. Effects: `start-worker {5, build}`.
6. `started {5}` → `running {worker 5}`, `crashes` 0. Effects: `close-dialog download` (focus the editor),
   `say ready`, `engine-ready`, `send-run {5, code, head}`.

The run is dropped instead by `decline` in `asking`, by STOP, FAIL, TWICE and LOST: none of their states has a `queued`
field.

**13. Download or Run pressed at load, before the cache check answers.** Today `start()` is allowed in `none`
(`web/src/app/engine.ts:146, 153`) while `owned()` still waits for `cached()` (`:85`), a network fetch. A Run then
opens the prompt (`web/src/app/run.ts:54-58`); "Download" starts a download; when `cached()` answers false, `ask(false)`
puts `asking` over `downloading` and replaces the dialog while the download runs on (`web/src/app/engine.ts:87,
130-133`). No test covers it. Here: `checking-cache` × `start` and × `run` → not valid.

**14. The list fetch of a restart fails.** Today: `web/test/client.test.ts:583, 593, 602`. From `ready {worker 4}`.
1. `reset` → `starting-list {worker 5}`. Effects as in scenario 1, step 1.
2. Then one of:
   - **The site was updated.** `list-failed {5, updated}` → `failed {reason updated}`, `crashes` unchanged. Effects:
     `close-dialog download`, `say failed`, `warn`. No `end-worker` (there is no worker) and no `start-worker`.
   - **The list did not arrive.** `list-failed {5, download}` → `failed {reason download}`, the same effects. Then
     `start` → `downloading {download 6}`. Effects: `start-download {6}`.
   - **The lock is lost meanwhile.** `lock-lost` → `other-tab-idle`. Effects: `block-store`, `engine-gone`,
     `show-dialog other-tab`. Then `list-checked {5, build}` → stale: no worker is made in a tab without the lock.

**15. A read op outside the machine.** A controller test; no event is raised in any of its steps.
1. In `declined`: `call("matrix", …)` rejects with kind `no-engine`. The machine is unchanged and the drop record empty.
2. In `running {worker 4}`: `call("describe_file", …)` is posted and waits in the worker's queue. Then `reset` →
   `starting-list {worker 5}`. Effects: `end-worker {4, reset user}`, which rejects the query with kind `reset`;
   `fetch-list {5}`, `add-reset-banner {"reset by you", user}`, `say reset`, `engine-gone`,
   `end-run {rc 9998, kind user}`.
3. In `running {worker 4}` again: `call("describe_file", …)` is posted. `run-ended {4, result}` → `ready {worker 4}`.
   Effects: `end-run {the result}`. The worker then answers the query with the file as the run left it.

**16. The lock lost before its answer is dispatched.**
1. `checking-lock {id 1}` + `lock-lost` → `other-tab-idle`. Effects: `block-store`, `engine-gone`,
   `show-dialog other-tab`.
2. `lock-answered {1, owned}` → stale. The store stays blocked.

---

## 9. What changes for step 4

**In SPEC section 8 and the header of `web/src/app/App.tsx`** (both are updated in step C's commit):

1. **The `engine` signal has the machine's sixteen state names** (ruling 12; the type is in item 1). Step 4's views
   are placeholders or thin, so this is the cheapest time. Against SPEC section 5 today:
   - new: `checking-lock`, `checking-cache`. `engine` starts as `checking-lock`, not `none`; `none` is seen only with
     `?test=manual`.
   - `starting` is `starting-list` or `starting-worker`; `other-tab` is `other-tab-idle` or `other-tab-taking`. The
     fields of each pair are the same as the old state's.
   - the other nine names and their fields are unchanged.

   What that changes, place by place:

   | Place | Change |
   |---|---|
   | `<html data-engine>` (`web/src/main.tsx:51`) | Shows one of the sixteen names. |
   | `web/src/styles/app.css:30` | `[data-engine="other-tab"]` becomes `[data-engine^="other-tab"]`. **The one place the compiler cannot check**; `web/e2e/shell.spec.ts` draws every state and measures the toolbar, and gains the two tags. |
   | `stateWords`, `web/src/app/editor/StatusBar.tsx:16-33` | An exhaustive `switch`: it fails the check until it has sixteen tags. Three pairs share a `case` (`starting-list` with `starting-worker`, and so on); `checking-lock` and `checking-cache` take the words of `none` until step 4b chooses others. |
   | `runState`, `web/src/app/editor/RunControls.tsx:26-33` | `s === "starting"` (`:30`) no longer compiles; it names the two tags. The page load and both `other-tab` tags fall to the last line, Run disabled, as SPEC section 5 draws them. |
   | `web/src/app/states/DownloadDialog.tsx:21, 49` | `:49` names the two `starting` tags. `:21` is unchanged. |
   | The other-tab dialog, `web/src/app/states/DownloadDialog.tsx:63` | It can now tell that a take-over is in progress. Recommended for step 4d: "Use dofile in this tab" is `aria-disabled` while `other-tab-taking`, with the same label, since the state lasts a few milliseconds and the machine ignores a second press anyway. Not required in step C. |
   | `engineUp`, `web/src/app/App.tsx:110` | Unchanged: `ready`, `running`, `breaking`, `waiting`. |
   | `web/test/app.test.ts` | Its assertions on `starting`, `other-tab` and `none` (nineteen lines name one) take the new tags; they are rewritten for the stand-in transport in any case (item 7.1). |
   | `web/e2e/fixtures.ts:16` | Waits until the name does not start with `checking`, where it waits for "not `none`". |
   | `web/e2e/step2.spec.ts:242, 261` | `other-tab` becomes `other-tab-idle`. `:131` (`none`, manual mode) is unchanged. |
   | `web/e2e/shell.spec.ts:179-182` | The list of states it draws has the sixteen. |
   | SPEC section 8 | The `EngineState` type is the one written out in item 1; "the section 5 states" are the sixteen. |
   | SPEC section 5 | Step E: the state table lists sixteen states, and the transition table is the machine's matrix (rulings 10, 12). |

   What it gains: one vocabulary in the machine, the tables, the signal, `data-engine`, the tests and SPEC; no mapping to
   read or to keep right; a name that is not a state fails `npm run check`. What it costs: a view that treats a pair
   alike writes two `case`s, and the CSS rule above.
2. `ask(forRun)` becomes `ask()`. The header's "ask(false)" and section 8's "`ask(forRun)`" and "`ask(false)`" change.
   No view calls it yet.
3. `STAGE_OF` is removed. `web/src/app/editor/StatusBar.tsx:7, 11` builds its status words from it; it takes
   `stageStatus`, a `Record<Stage, string>`, from `web/src/app/engine.ts` instead. Section 8's comment "One status text
   per stage" goes.
4. `Stage`, `RunHead` and `FailReason` are defined in `web/src/engine/types.ts`. `web/src/app/types.ts` re-exports
   them, so importers do not change. `web/src/app/types.ts` holds `EngineState`, written out by hand (item 1); its
   checks against the machine's `State` use a type-only import.
5. **The `about` signal is removed** (ruling 11). Detail below. `web/src/app/App.tsx:69, 118, 131` reads `ABOUT` from
   `web/src/app/env.ts` instead; section 8 loses the `about` line and "Losing the tab lock clears `about`"; section
   3.5's log head (step 4b) takes its three values from `ABOUT`.
6. Signals with one owner are `ReadonlySignal`: `engine`; `memory`, `log`, `lastRun`, `history`, `results`, `macros`,
   `data`, `rows`, `graphs`; `files`, `fresh`, `persisted`; `banners`, `toast`, `announce` (written through the helpers
   in `state.ts`). A view that assigns one fails the check. The others stay writable: `graphIndex`, `graphFull`,
   `dialog`, `tabs`, `activeTab`, `split`, `outputTab`, `phoneTab`, `pickedVar`, `theme`, `layout`, `isolated`.
7. **`rows` has one writer, `run.ts`.** "Show 50 more" calls `moreRows()` from `web/src/app/run.ts`; step 4c no longer
   appends to `rows` or calls `browse` (item 7.2). Three places told step 4c otherwise and change: the header of
   `web/src/app/output/tabs.tsx` (`:8`), the 4c lines of the header of `web/src/app/App.tsx`, and section 8 (the
   `rows` line of the signal list, "the Data tab also appends", and 4c's "Writes … `rows`" and
   "`call("browse" | "matrix" | "describe_file", ...)`", which becomes `call("matrix" | "describe_file", ...)` and
   `moreRows()`). The comment on two writers in `web/src/app/state.ts:64-66` goes.
8. `call(op, args)` keeps its name and is the page's one provider of read ops. It accepts only `describe`,
   `describe_file`, `matrix`, `macros`, `browse` and `memory` (`ViewOp`); views use `matrix` and `describe_file`. It
   rejects as today: kind `no-engine` with no worker, `reset` when a reset cut it.
9. `open`, `start`, `takeOver` and `reset` return `void`, not promises. No view uses the promises
   (`web/src/app/states/DownloadDialog.tsx:26, 68`, `web/src/app/editor/RunControls.tsx:45`). Section 8's "a second
   press gets the same promise" becomes "a second press does nothing".
10. `runCommand` during the page load (`checking-lock`, `checking-cache`) returns `accepted: false`. Section 8's rule "(`none`, `declined`:
    queued)" still holds for those two states.
11. Narrower actions: `decline` acts only in `asking` and `downloading`; `ask` only in `none` and `declined`. `start`
    and `reset` act in the same states as now.
12. A queued run goes from `starting-worker` straight to `running`; `ready` is not shown in between.
13. After a reset whose new start fails, "Try again" no longer clears `lastRun`: it stays the run the reset cut, as it
    does after a reset whose start succeeds. (Today every entry into `starting` clears it, `web/src/app/run.ts:30-36`;
    here `engine-gone` clears it once, when the engine is lost.)
14. Section 8's "Engine controller choices" is reworded in step E: "Each start and each reset takes a new number", the
    lock counter, and the sentences on `start()`'s promise.

**The `about` signal** (decided: dropped in step C). `About` is what `boot` answers: `dofile` (the package's version),
`engine`, `engine_commit` and `engine_patches` (from the vendored engine's stamp), `stata_version`
(`web/src/engine/types.ts:20`, `src/dofile/engine.py:136-143`). It has two readers, one built and one specified:

- the hint of the menu item "About dofile", `about.value?.dofile` (`web/src/app/App.tsx:118, 131`);
- the log's head, which step 4b builds: "dofile 0.1.0 · OpenDTA 0c3f3a2 · Stata 14 syntax" (SPEC section 3.5). It
  needs the version, the engine's commit and the Stata version.

All three are fixed when the page is built, in both start modes. The page is compiled against one wheel
(`web/vite.config.ts`, `__WHEEL__`, and `__BUILD_ID__`, which covers that wheel's hash). A snapshot start refuses a
build whose id differs (`checkBuild` in `web/src/engine/client.ts`); the normal start installs that very wheel
(`web/src/main.tsx:29`, `web/src/engine/worker.ts:403-410`). `npm run dev`, `npm run build` and `npm test` build the
wheel from the source tree first (`web/package.json`), so the tree and the wheel are of one state.

- **What replaces the signal:** one compiled-in constant, `ABOUT`, of type
  `Pick<About, "dofile" | "engine_commit" | "stata_version">`, exported by `web/src/app/env.ts`.
  `web/scripts/build-id.ts` gains a function that makes it from the build's inputs: the version from the wheel's file
  name (`dofile-0.1.0.dev1-py3-none-any.whl`), the commit from `src/dofile/_vendor/opendta/VENDORED`, and 14.
  `web/vite.config.ts` gains one `define`, `__ABOUT__`; `web/src/env.d.ts` one declaration.
  `web/scripts/start-files.ts` does not change.
- **What keeps it true:** `boot` still answers `About`, and the transport keeps it as the fact `client.about`.
  `web/test/engine.test.ts`, which starts the real wheel, compares those three fields of `client.about` with what the
  function in `build-id.ts` gives. A wheel that is not of the tree, a changed file-name pattern or a new Stata version
  fails that test.
- **In the machine:** no `set-about` effect, no payload on `started`, and LOST has one effect fewer.
- **For the visitor:** the menu and the log's head show the version from the first paint, with or without an engine.
- **In the tests:** the fixture `ABOUT` and the assertion on `S.about` in `web/test/app.test.ts` (`:40`, `:147`) go;
  `:112` and `:379` lose `about`.
- *Compiling the whole `About` in* was rejected: nothing reads `engine` or `engine_patches`.

**Unchanged:** every other action name, `FAILED`, `FAILED_TWICE`, `UPDATED`, `stagesOf`, `stageWords`, `fromClient`,
the `Dialog` and `Banner` types, `failed.message` and `detail`, `runCode`, `clearLog`, `addFileGraph`,
and what a run's result means: rc 1 is a Break with the data kept, rc 9998 a reset.

**`refreshData` keeps its name and changes when it acts.** It no longer looks at the state (run.ts may not compare
state names), so it is not a no-op outside `ready`: with no engine its calls reject and nothing is written; while an
engine starts or a run is on, the calls wait in the worker's queue and the signals are written when they are
answered.

**Outside those two documents:**

- SPEC section 5's row for `breaking` (item 4.3), its sixteen states and its transition table (rulings 10, 12), in
  step E.
- SPEC section 6's client paragraph loses `restart`, `stop`, `run`'s `busy`, `breakRun`, `keepWaiting`, `resetAt`,
  `onRestart` and the "Order on a reset" bullet. `{status}` becomes `{stage}`. `Downloaded` gains `build`; the ops are
  the three sets of item 7.2.
- `CutKind` loses `failed`, `failed-twice` and `no-engine`; `ClientError`'s kinds lose `busy`.
- The test hook's `engine` is the transport, and the hook gains `drops`. `engine.worker`, `engine.startup`,
  `engine.cached()` and `engine.download()` stay (`web/e2e/step2.spec.ts:77, 130, 137, 155, 172`,
  `web/e2e/engine.spec.ts:135`, `web/e2e/shell.spec.ts:153, 168`). `engine.start()` and `engine.run()` go, so the test
  "a start without download() works and writes nothing to the Cache" (`web/e2e/step2.spec.ts:213-226`) empties the
  caches after a first start, calls the hook's `reset()`, and runs through the hook's `run()`.
- The e2e files that name a state are in the table of point 1.

---

## 10. Still open

Nothing. Every question raised on this design has a ruling or an answer under "Decisions".

Noted for step D, not open here: whether a closed database still needs a new worker once the journal is the only
channel (item 7.3).

### Files that step C changes most

- `web/src/engine/machine.ts` (new)
- `web/src/engine/client.ts`
- `web/src/engine/types.ts`
- `web/src/app/engine.ts`
- `web/src/app/run.ts`
- `web/test/machine.test.ts` (new), `web/test/imports.test.ts` (new)
