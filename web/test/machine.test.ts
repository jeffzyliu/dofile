// The engine's state machine (src/engine/machine.ts), alone: no controller, no transport, no clock.
//  - the table: every row (state) by every event, 16 by 24, with the variants of the cells that depend on a payload or on
//    the machine. GRID is the five tables of docs/prototype1-step3.5-c-design.md, item 4.2, cell for cell; CELLS says what
//    each named cell does. A new state or event fails `npm run check` until its cells are written.
//  - the properties of item 6, over every cell and every step of every scenario.
//  - the race scenarios of item 8, each a short list of events with the state and every effect after each.
//  - the lines that must not compile (`@ts-expect-error`): a ticket, a counter, an answer, the Answers map, EngineState.
// The tests make no ticket and no machine by hand: every machine is reached from initial() by events, and every ticket is
// copied from an effect, a state or a machine. The scenarios name tickets by their numbers (the lock 1, the cache check 2,
// the download 3, the worker 4), as plain data to compare with.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RC_RESET, cutResult, initial, lost, ticketOf, transition } from "../src/engine/machine.ts";
import type { Answered, Answers, AnswersOk, AnyAnswer, Effect, Env, Event, Expect, Machine, PlainEvent, QueuedRun, Reply, RowName, State,
  StateOf, Step, Ticket, TicketedEffect } from "../src/engine/machine.ts";
import type { Build, CutKind, FailReason, ResetKind, RunHead, RunResult, Stage } from "../src/engine/types.ts";
import type { EngineState, NothingHidden, SameTags } from "../src/app/types.ts";

type EventType = Event["type"];
/** What a test feeds: a visitor's event or `lock-lost`, or an answer without its ticket. */
type Feed = PlainEvent | AnyAnswer;
/** One step that was made: the machine before, the event, and what transition() gave. */
type Moved = { before: Machine; event: Event; step: Step };
/** A machine reached from initial() by events, with how it got there. `clock`: the time of the last event. */
type At = { m: Machine; clock: number; first: Step; trail: Moved[] };
/** T with every ticket as its number: expected values written as plain data. */
type Plain<T> = T extends Ticket ? number : T extends object ? { [K in keyof T]: Plain<T[K]> } : T;

const ENV: Env = { snapshot: true, canInterrupt: true, graceMs: 5000, engineBytes: 48_000_000, manual: false };
const HEAD: RunHead = { kind: "file", path: "a.do", fresh_locals: true };
const RUN = { type: "run", code: "display 1", head: HEAD } as const;
const QUEUED: QueuedRun = { code: "display 1", head: HEAD };
const BUILD: Build = { built: 777, files: { snapshot: { name: "heap.bin", raw: 40_000, size: 10_000 }, bundle: { name: "bundle.bin", raw: 900, size: 300 } } };
const CRASH = { type: "crashed", cause: "error", reason: "unknown", detail: "boom" } as const;
const result = (rc: number): RunResult => ({ rc, error: rc ? "it failed" : null, error_command: null, log: ". display 1\n1\n",
  results: { e: { scalars: {}, macros: {}, matrices: {} }, r: { scalars: {}, macros: {}, matrices: {} }, e_changed: false, r_changed: false },
  nobs: 3, nvars: 1, new_graphs: 0, images: [], error_line: null, graph_commands: [], graph_lines: [] });

// What the machine makes itself, written out here a second time.
const SENTENCE = (reason: string) => `session reset: ${reason}. Data in memory is gone; your files are kept.`;
const CUT = (error: string, kind: CutKind): RunResult => ({ rc: 9998, error, error_command: null, log: "", results: null, nobs: 0, nvars: 0,
  new_graphs: 0, images: [], error_line: null, graph_commands: [], graph_lines: [], kind });
const NO_ISOLATION = "Break reset the engine, because this page is not cross-origin isolated and cannot ask a run to stop";

// ---- reaching a machine by events ----

/** The effect each answer answers: Answers, the other way round. The type makes it complete and exact. */
const ASKED_BY: { [K in Answered as Answers[K]]: K } = {
  "lock-answered": "take-lock", "cache-checked": "check-cache",
  "download-progress": "start-download", "download-done": "start-download", "download-failed": "start-download",
  "list-checked": "fetch-list", "list-failed": "fetch-list",
  stage: "start-worker", started: "start-worker", "start-failed": "start-worker", crashed: "start-worker",
  "run-ended": "send-run", "run-failed": "send-run", "break-timeout": "start-break-timer",
};
const isAnswer = (f: Feed): f is AnyAnswer => f.type in ASKED_BY;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

/** transition(), as every test calls it: the machine and the event are frozen first, and the call is made twice. */
function pure(m: Machine, e: Event): Step {
  deepFreeze(m); deepFreeze(e);
  const step = transition(m, e);
  assert.deepEqual(transition(m, e), step, `${m.state.s} x ${e.type}: the same call twice gives the same step`);
  return step;
}

const begin = (env: Partial<Env> = {}): At => { const first = initial({ ...ENV, ...env }); return { m: first.machine, clock: 0, first, trail: [] }; };
const stepsOf = (at: At): Step[] => [at.first, ...at.trail.map(t => t.step)];

/** The ticket of the latest effect `effect` on this path: what its performer's reply is bound to. */
function asked(at: At, effect: Answered): Ticket {
  for (const step of stepsOf(at).reverse()) for (const e of step.effects) if ("n" in e && e.do === effect) return e.n;
  throw new Error(`no ${effect} on this path`);
}
/** The ticket numbered `n` on this path, copied from the effect that carried it. */
function numbered(at: At, n: number): Ticket {
  for (const step of stepsOf(at)) for (const e of step.effects) if ("n" in e && e.n === n) return e.n;
  throw new Error(`no ticket ${n} on this path`);
}

/** `f` as an event at `at`: an answer gets its effect's ticket (or `n`), and each event comes 1000 ms after the last. */
function eventAt(at: At, f: Feed, o: { n?: Ticket, at?: number } = {}): Event {
  const time = o.at ?? at.clock + 1000;
  return isAnswer(f) ? { ...f, n: o.n ?? asked(at, ASKED_BY[f.type]), at: time } : { ...f, at: time };
}
function feed(at: At, f: Feed, o: { n?: Ticket, at?: number } = {}): At {
  const event = eventAt(at, f, o), step = pure(at.m, event);
  return { m: step.machine, clock: event.at, first: at.first, trail: [...at.trail, { before: at.m, event, step }] };
}
/** feed(), for an event that must be taken. */
function go(at: At, f: Feed, o: { n?: Ticket, at?: number } = {}): At {
  const next = feed(at, f, o);
  assert.equal(next.trail.at(-1)!.step.outcome, "taken", `${at.m.state.s} x ${f.type}`);
  return next;
}

type Options = { env?: Partial<Env>, queued?: boolean, crashed?: boolean };
/** The machine in row `name`, by the shortest path: a normal load for most. `queued`: with a run queued (the rows that
 *  can hold one). `crashed`: with the crash count at 1 (ruling 2: it survives a failed start and "Try again"): the
 *  starting rows after a crash, and `failed`, `downloading`, `declined` and `asking` by the events after it (a crash,
 *  the list, a start that fails, "Try again", "Stop download", the prompt). Every row can be reached. */
function row(name: RowName, o: Options = {}): At {
  const at = reach(name, o);
  assert.equal(at.m.state.s, name, `the path to ${name}`);
  if (o.crashed) assert.equal(at.m.crashes, 1, `the path to ${name} with the crash count at 1`);
  return at;
}
function reach(name: RowName, o: Options): At {
  const plain = { ...o, queued: false, crashed: false };
  switch (name) {
    case "checking-lock": return begin(o.env);
    case "checking-cache": return go(row("checking-lock", o), { type: "lock-answered", owned: true });
    case "none": return go(begin({ ...o.env, manual: true }), { type: "lock-answered", owned: true });
    case "asking": return o.queued ? go(row("declined", { ...o, queued: false }), RUN)
      : o.crashed ? go(row("declined", o), { type: "ask" }) : go(row("checking-cache", o), { type: "cache-checked", cached: false });
    case "declined": return o.crashed ? go(row("downloading", { ...o, queued: false }), { type: "stop-download" }) : go(row("asking", plain), { type: "decline" });
    case "downloading": return o.queued ? go(row("asking", o), { type: "start" })
      : o.crashed ? go(row("failed", o), { type: "start" }) : go(row("checking-cache", o), { type: "cache-checked", cached: true });
    case "starting-list": return o.crashed ? go(row(o.queued ? "starting-worker" : "ready", { ...o, crashed: false }), CRASH) : go(row("ready", o), { type: "reset" });
    case "starting-worker": return o.crashed ? go(row("starting-list", o), { type: "list-checked", build: BUILD })
      : go(row("downloading", o), { type: "download-done", build: o.env?.snapshot === false ? null : BUILD });
    case "ready": return go(row("starting-worker", plain), { type: "started" });
    case "running": return go(row("ready", o), RUN);
    case "breaking": return go(row("running", o), { type: "break" });
    case "waiting": return go(row("breaking", o), { type: "keep-waiting" });
    case "failed": return o.crashed ? go(row("starting-worker", { ...o, queued: false }), { type: "start-failed", reason: "unknown", detail: "mount failed" })
      : go(row("downloading", o), { type: "download-failed", reason: "download", detail: "a file did not arrive" });
    case "failed-twice": return go(row("starting-worker", { ...o, crashed: true }), CRASH);
    case "other-tab-idle": return go(row("checking-lock", o), { type: "lock-answered", owned: false });
    case "other-tab-taking": return go(row("other-tab-idle", o), { type: "take-over" });
  }
}

/** The member of State the machine is in, when it is one of `rows`. */
function inRow<R extends RowName>(m: Machine, ...rows: R[]): StateOf<R> {
  assert.ok((rows as RowName[]).includes(m.state.s), `${m.state.s} is not one of ${rows.join(", ")}`);
  return m.state as StateOf<R>;
}

// ---- the table: GRID names each cell, CELLS says what a named cell does ----

const ROWS = ["checking-lock", "checking-cache", "none", "asking", "declined", "downloading", "starting-list", "starting-worker", "ready",
  "running", "breaking", "waiting", "failed", "failed-twice", "other-tab-idle", "other-tab-taking"] as const satisfies readonly RowName[];
/** Fails the check if ROWS is not every row. */
export type RowsChecked = Expect<[RowName] extends [(typeof ROWS)[number]] ? true : false>;

/** What a cell must give: the new state, every effect in order, the crash count (unchanged unless named), and whether
 *  it issues a ticket. */
type Want = { state: State, effects: Effect[], crashes?: 0 | 1, issues?: true };
/** What a cell's expectation is given: the machine before, the event's time, and the ticket the step issued, if any. */
type Ctx = { old: Machine, at: number, next: Ticket };
/** One form of a cell: where it starts, what is fed, what must come out, and anything else to check on the step. */
type Variant = { name: string, from: At, feed: Feed, want: (c: Ctx) => Want, also?: (step: Step, event: Event) => void };

const firstStage = (m: Machine): Stage => (m.env.snapshot ? "download" : "python");
const closeDownload = (focusEditor = false): Effect => ({ do: "close-dialog", dialog: "download", focusEditor });
const warned = (reason: FailReason, detail: string): Effect => ({ do: "warn", text: `the engine didn't start (${reason}): ${detail}` });

const wantDownload = (queued: QueuedRun | null) => ({ old, at, next }: Ctx): Want => ({ issues: true,
  state: { s: "downloading", download: next, received: 0, total: old.env.engineBytes ?? 0, t0: at, queued },
  effects: [{ do: "start-download", n: next }] });
const wantAsk = (queued: QueuedRun | null) => (): Want => ({ state: { s: "asking", queued },
  effects: [{ do: "show-dialog", dialog: "download", forRun: queued !== null }] });
const wantOwn = (before: Effect[]) => ({ old, next }: Ctx): Want => (old.env.manual
  ? { state: { s: "none" }, effects: [...before, { do: "own-files" }] }
  : { issues: true, state: { s: "checking-cache", id: next }, effects: [...before, { do: "own-files" }, { do: "check-cache", n: next }] });

/** The effects of RESET, by the row it leaves, in order. */
const RESET_DOES: Record<"starting-worker" | "ready" | "running" | "breaking" | "waiting", Effect["do"][]> = {
  "starting-worker": ["end-worker", "fetch-list"],
  ready: ["end-worker", "fetch-list", "add-reset-banner", "say", "engine-gone"],
  running: ["end-worker", "fetch-list", "add-reset-banner", "say", "engine-gone", "end-run"],
  breaking: ["cancel-break-timer", "end-worker", "fetch-list", "add-reset-banner", "say", "engine-gone", "end-run"],
  waiting: ["end-worker", "fetch-list", "add-reset-banner", "say", "engine-gone", "end-run"],
};
const wantReset = (kind: ResetKind, reason: string) => ({ old, at, next }: Ctx): Want => {
  const was = inRow(old, "starting-worker", "ready", "running", "breaking", "waiting");
  const all: Partial<Record<Effect["do"], Effect>> = {
    "cancel-break-timer": { do: "cancel-break-timer" },
    "end-worker": { do: "end-worker", n: was.worker, ending: { kind: "reset", reset: kind, reason: SENTENCE(reason) } },
    "fetch-list": { do: "fetch-list", n: next },
    "add-reset-banner": { do: "add-reset-banner", reason, kind },
    say: { do: "say", line: "reset" },
    "engine-gone": { do: "engine-gone" },
    "end-run": { do: "end-run", result: CUT(SENTENCE(reason), kind) },
  };
  return { issues: true, crashes: kind === "crash" ? 1 : 0,
    state: { s: "starting-list", worker: next, stage: firstStage(old), t0: at, done: {}, queued: was.s === "starting-worker" ? was.queued : null },
    effects: RESET_DOES[was.s].map(name => all[name]!) };
};

/** The effects of LOST, by the row it leaves, in order. */
const LOST_DOES: Record<Exclude<RowName, "other-tab-idle" | "other-tab-taking">, Effect["do"][]> = {
  "checking-lock": ["block-store", "engine-gone", "show-dialog"],
  "checking-cache": ["block-store", "engine-gone", "show-dialog"],
  none: ["block-store", "engine-gone", "show-dialog"],
  asking: ["block-store", "engine-gone", "show-dialog"],
  declined: ["block-store", "engine-gone", "show-dialog"],
  downloading: ["abort-download", "block-store", "engine-gone", "show-dialog"],
  "starting-list": ["block-store", "engine-gone", "show-dialog"],
  "starting-worker": ["end-worker", "block-store", "engine-gone", "show-dialog"],
  ready: ["end-worker", "block-store", "engine-gone", "show-dialog"],
  running: ["end-worker", "block-store", "engine-gone", "show-dialog", "end-run"],
  breaking: ["cancel-break-timer", "end-worker", "block-store", "engine-gone", "show-dialog", "end-run"],
  waiting: ["end-worker", "block-store", "engine-gone", "show-dialog", "end-run"],
  failed: ["block-store", "engine-gone", "show-dialog"],
  "failed-twice": ["block-store", "engine-gone", "show-dialog"],
};
const wantLost = ({ old }: Ctx): Want => {
  const was = old.state, held = ticketOf(was);
  const all: Partial<Record<Effect["do"], Effect>> = {
    "abort-download": held === null ? undefined : { do: "abort-download", n: held },
    "cancel-break-timer": { do: "cancel-break-timer" },
    "end-worker": held === null ? undefined : { do: "end-worker", n: held, ending: { kind: "stopped", reason: SENTENCE("another tab took over") } },
    "block-store": { do: "block-store" },
    "engine-gone": { do: "engine-gone" },
    "show-dialog": { do: "show-dialog", dialog: "other-tab" },
    "end-run": { do: "end-run", result: CUT(SENTENCE("another tab took over"), "stopped") },
  };
  return { crashes: 0, state: { s: "other-tab-idle" }, effects: LOST_DOES[inRow(old, ...Object.keys(LOST_DOES) as (keyof typeof LOST_DOES)[]).s].map(name => all[name]!) };
};

const wantFail = (reason: FailReason, detail: string) => ({ old }: Ctx): Want => ({ state: { s: "failed", reason, detail },
  effects: [...(old.state.s === "starting-worker" ? [{ do: "end-worker", n: old.state.worker, ending: { kind: "failed", reason: detail } } as const] : []),
    closeDownload(), { do: "say", line: "failed" }, warned(reason, detail)] });

const wantEnd = (ended: RunResult) => ({ old }: Ctx): Want => {
  const was = inRow(old, "running", "breaking", "waiting");
  return { state: { s: "ready", worker: was.worker },
    effects: [...(was.s === "breaking" ? [{ do: "cancel-break-timer" } as const] : []), { do: "end-run", result: ended }] };
};

// Ruling 2: the crash count survives a failed start and "Try again". These rows can be reached with it at 1 (`none`, the
// page load and the other-tab rows cannot: only losing the lock leads to them, and that sets it back to 0), and a cell
// that does not name the count must leave it: the table test compares it with the machine's before.
const CAN_HAVE_CRASHED = new Set<RowName>(["asking", "declined", "downloading", "starting-list", "starting-worker", "failed"]);
const KEPT = "after a crash: the count stays 1";
/** `variant`, for a row that can have the crash count at 1. */
const afterCrash = (r: RowName, variant: () => Variant): Variant[] => (CAN_HAVE_CRASHED.has(r) ? [variant()] : []);
/** With and without a queued run, with the crash count at 0 and at 1. */
const VARIETIES = [{ queued: false, crashed: false }, { queued: true, crashed: false }, { queued: false, crashed: true }, { queued: true, crashed: true }];

/** The cells that do something, by the name GRID gives them. `r`: the row; `t`: the event's type. */
const CELLS = {
  OWN: r => [
    { name: "owned", from: row(r), feed: { type: "lock-answered", owned: true }, want: wantOwn([]) },
    { name: "owned, manual mode", from: row(r, { env: { manual: true } }), feed: { type: "lock-answered", owned: true }, want: wantOwn([]) },
    { name: "not owned", from: row(r), feed: { type: "lock-answered", owned: false },
      want: () => ({ state: { s: "other-tab-idle" }, effects: [{ do: "show-dialog", dialog: "other-tab" }] }) },
  ],
  "TAKEN": r => {
    const close: Effect = { do: "close-dialog", dialog: "other-tab", focusEditor: false };
    return [
      { name: "owned", from: row(r), feed: { type: "lock-answered", owned: true }, want: wantOwn([close]) },
      { name: "owned, manual mode", from: row(r, { env: { manual: true } }), feed: { type: "lock-answered", owned: true }, want: wantOwn([close]) },
      { name: "not owned", from: row(r), feed: { type: "lock-answered", owned: false }, want: () => ({ state: { s: "other-tab-idle" }, effects: [] }) },
    ];
  },
  "UNTAKEN": r => [{ name: "", from: row(r), feed: { type: "lock-lost" }, want: () => ({ state: { s: "other-tab-idle" }, effects: [] }) }],
  LOST: r => [
    { name: "", from: row(r), feed: { type: "lock-lost" }, want: wantLost },
    ...(r === "asking" || r === "downloading" || r === "starting-list" || r === "starting-worker"
      ? [{ name: "a queued run is dropped", from: row(r, { queued: true, crashed: r === "starting-list" }), feed: { type: "lock-lost" } as const, want: wantLost }] : []),
    ...(CAN_HAVE_CRASHED.has(r)
      ? [{ name: "the crash count goes back to 0", from: row(r, { crashed: true }), feed: { type: "lock-lost" } as const, want: wantLost }] : []),
  ],
  CACHE: r => [
    { name: "cached", from: row(r), feed: { type: "cache-checked", cached: true }, want: wantDownload(null) },
    { name: "not cached", from: row(r), feed: { type: "cache-checked", cached: false }, want: wantAsk(null) },
  ],
  "DOWNLOAD(null)": r => [
    { name: "", from: row(r), feed: { type: "start" }, want: wantDownload(null) },
    { name: "no size in the page: the total starts at 0", from: row(r, { env: { engineBytes: null } }), feed: { type: "start" }, want: wantDownload(null) },
    ...afterCrash(r, () => ({ name: KEPT, from: row(r, { crashed: true }), feed: { type: "start" }, want: wantDownload(null) })),
  ],
  "DOWNLOAD(queued)": r => [
    { name: "no run queued", from: row(r), feed: { type: "start" }, want: wantDownload(null) },
    { name: "the queued run is kept", from: row(r, { queued: true }), feed: { type: "start" }, want: wantDownload(QUEUED) },
    { name: KEPT, from: row(r, { crashed: true }), feed: { type: "start" }, want: wantDownload(null) },
    { name: `the queued run is kept; ${KEPT}`, from: row(r, { queued: true, crashed: true }), feed: { type: "start" }, want: wantDownload(QUEUED) },
  ],
  "ASK(null)": r => [{ name: "", from: row(r), feed: { type: "ask" }, want: wantAsk(null) },
    ...afterCrash(r, () => ({ name: KEPT, from: row(r, { crashed: true }), feed: { type: "ask" }, want: wantAsk(null) }))],
  "ASK(run)": r => [{ name: "", from: row(r), feed: RUN, want: wantAsk(QUEUED) },
    ...afterCrash(r, () => ({ name: KEPT, from: row(r, { crashed: true }), feed: RUN, want: wantAsk(QUEUED) }))],
  "NOT-NOW": r => VARIETIES.map(({ queued, crashed }) => ({ name: [queued ? "the queued run is dropped" : "", crashed ? KEPT : ""].filter(Boolean).join("; "),
    from: row(r, { queued, crashed }), feed: { type: "decline" } as const,
    want: (): Want => ({ state: { s: "declined" }, effects: [closeDownload()] }) })),
  STOP: (r, t) => VARIETIES.map(({ queued, crashed }) => ({ name: [queued ? "the queued run is dropped" : "", crashed ? KEPT : ""].filter(Boolean).join("; "),
    from: row(r, { queued, crashed }), feed: { type: t === "decline" ? "decline" : "stop-download" } as const,
    want: ({ old }: Ctx): Want => ({ state: { s: "declined" },
      effects: [{ do: "abort-download", n: inRow(old, "downloading").download }, closeDownload(), { do: "say", line: "download-stopped" }] }) })),
  "RESET(user)": r => [{ name: "", from: row(r), feed: { type: "reset" }, want: wantReset("user", "reset by you") }],
  "TAKE-OVER": r => [{ name: "", from: row(r), feed: { type: "take-over" },
    want: ({ next }) => ({ issues: true, state: { s: "other-tab-taking", take: next }, effects: [{ do: "take-lock", n: next, steal: true }] }) }],
  PROGRESS: r => VARIETIES.map(({ queued, crashed }) => ({ name: [queued ? "with a queued run" : "", crashed ? KEPT : ""].filter(Boolean).join("; "), from: row(r, { queued, crashed }),
    feed: { type: "download-progress", received: 1_200_000, total: 47_000_000 } as const,
    want: ({ old }: Ctx): Want => ({ state: { ...inRow(old, "downloading"), received: 1_200_000, total: 47_000_000 }, effects: [] }) })),
  DONE: r => [{ name: "", o: {} }, { name: "the queued run is kept", o: { queued: true } }, { name: "the normal start: no list, and the first stage is python", o: { env: { snapshot: false } } },
    { name: KEPT, o: { crashed: true } }]
    .map(({ name, o }: { name: string, o: Options }) => {
      const build = o.env?.snapshot === false ? null : BUILD;
      return { name, from: row(r, o), feed: { type: "download-done", build } as const,
        want: ({ old, at, next }: Ctx): Want => {
          const was = inRow(old, "downloading"), stage = firstStage(old);
          return { issues: true, state: { s: "starting-worker", worker: next, stage, t0: at, done: { download: (at - was.t0) / 1000 }, queued: was.queued },
            effects: [{ do: "start-worker", n: next, build }, { do: "say", line: { stage } }] };
        } };
    }),
  "FAIL(download)": r => ([{ reason: "download", o: {} }, { reason: "updated", o: { queued: true } }, { reason: "download", o: { crashed: true } },
    { reason: "updated", o: { crashed: true, queued: true } }] as const).map(({ reason, o }: { reason: "download" | "updated", o: Options }) => ({ name: `${reason}${o.crashed ? `; ${KEPT}` : ""}`, from: row(r, o),
      feed: { type: "download-failed", reason, detail: "the list is of another build" } as const, want: wantFail(reason, "the list is of another build") })),
  LISTED: r => [{ name: "", o: {}, build: BUILD }, { name: "the queued run and the crash count are kept", o: { queued: true, crashed: true }, build: BUILD },
    { name: "the normal start: no list", o: { env: { snapshot: false } }, build: null }]
    .map(({ name, o, build }: { name: string, o: Options, build: Build | null }) => ({ name, from: row(r, o), feed: { type: "list-checked", build } as const,
      want: ({ old }: Ctx): Want => {
        const was = inRow(old, "starting-list");
        return { state: { ...was, s: "starting-worker" }, effects: [{ do: "start-worker", n: was.worker, build }] };
      } })),
  "FAIL(list)": r => (["download", "updated", "unknown"] as const).map(reason => ({ name: reason, from: row(r, { crashed: reason === "unknown" }),
    feed: { type: "list-failed", reason, detail: "the list did not arrive" } as const, want: wantFail(reason, "the list did not arrive") })),
  STAGE: r => {
    const start = row(r), unpack = go(start, { type: "stage", stage: "unpack" }, { at: start.clock + 700 });
    return [
      { name: "the same stage: no change, no effects", from: start, feed: { type: "stage", stage: firstStage(start.m) },
        want: ({ old }) => ({ state: old.state, effects: [] }), also: (step, event) => assert.equal(step.machine, pure(start.m, event).machine) },
      { name: "another stage: the old one's seconds are added to what it had (the download's)", from: start, feed: { type: "stage", stage: "unpack" },
        want: ({ old, at }) => {
          const was = inRow(old, "starting-worker");
          assert.ok(was.done.download! > 0, "the path has the download's time");
          return { state: { ...was, stage: "unpack", t0: at, done: { download: was.done.download! + (at - was.t0) / 1000 } }, effects: [{ do: "say", line: { stage: "unpack" } }] };
        } },
      { name: "a stage with no time yet", from: unpack, feed: { type: "stage", stage: "python" },
        want: ({ old, at }) => {
          const was = inRow(old, "starting-worker");
          return { state: { ...was, stage: "python", t0: at, done: { ...was.done, unpack: (at - was.t0) / 1000 } }, effects: [{ do: "say", line: { stage: "python" } }] };
        } },
      { name: "with a queued run", from: row(r, { queued: true }), feed: { type: "stage", stage: "files" },
        want: ({ old, at }) => {
          const was = inRow(old, "starting-worker");
          return { state: { ...was, stage: "files", t0: at, done: { download: was.done.download! + (at - was.t0) / 1000 } }, effects: [{ do: "say", line: { stage: "files" } }] };
        } },
    ];
  },
  STARTED: r => {
    const up: Effect[] = [closeDownload(true), { do: "say", line: "ready" }, { do: "engine-ready" }];
    const ready = ({ old }: Ctx): Want => ({ crashes: 0, state: { s: "ready", worker: inRow(old, "starting-worker").worker }, effects: up });
    return [
      { name: "no queued run", from: row(r), feed: { type: "started" }, want: ready },
      { name: "after a crash: the count goes back to 0", from: row(r, { crashed: true }), feed: { type: "started" }, want: ready },
      { name: "a queued run starts", from: row(r, { queued: true }), feed: { type: "started" },
        want: ({ old, at }) => {
          const { worker } = inRow(old, "starting-worker");
          return { crashes: 0, state: { s: "running", worker, run: HEAD, t0: at }, effects: [...up, { do: "send-run", n: worker, code: QUEUED.code, head: HEAD }] };
        } },
    ];
  },
  "FAIL(start)": r => (["no-wasm", "download", "memory", "unknown"] as const).map(reason => ({
    name: reason === "unknown" ? "unknown, after a crash: the count stays 1" : reason, from: row(r, { crashed: reason === "unknown", queued: reason === "memory" }),
    feed: { type: "start-failed", reason, detail: "mount failed" } as const,
    want: (c: Ctx): Want => ({ ...wantFail(reason, "mount failed")(c), crashes: reason === "unknown" ? 1 : 0 }) })),
  "CRASHED(starting)": r => {
    const twice = (reason: "download" | "memory" | "unknown", cause: "error" | "storage"): Variant => {
      const what = cause === "storage" ? "the browser closed the file storage" : "boom";
      const detail = `the engine's worker failed twice (${what}); reload the page`;
      return { name: `the second crash, ${reason}, ${cause}`, from: row(r, { crashed: true, queued: reason === "download" }), feed: { type: "crashed", cause, reason, detail: what },
        want: ({ old }) => ({ crashes: 0, state: { s: "failed-twice", reason, detail },
          effects: [{ do: "end-worker", n: inRow(old, "starting-worker").worker, ending: { kind: "failed-twice", reason: detail } },
            ...(reason === "memory" ? [] : [{ do: "forget-download" } as const]), closeDownload(), { do: "say", line: "failed-twice" }, warned(reason, detail)] }) };
    };
    return [
      { name: "the first crash", from: row(r), feed: CRASH, want: wantReset("crash", "the engine crashed (boom)") },
      { name: "the first crash: the queued run is kept", from: row(r, { queued: true }), feed: CRASH, want: wantReset("crash", "the engine crashed (boom)") },
      { name: "the first crash: the file storage", from: row(r), feed: { type: "crashed", cause: "storage", reason: "unknown", detail: "the browser closed the file storage" },
        want: wantReset("crash", "the browser closed the file storage") },
      twice("memory", "error"), twice("unknown", "error"), twice("download", "error"), twice("unknown", "storage"),
    ];
  },
  "RESET(crash)": r => [
    { name: "the worker's error", from: row(r), feed: { type: "crashed", cause: "error", reason: "memory", detail: "out of memory" }, want: wantReset("crash", "the engine crashed (out of memory)") },
    { name: "the file storage", from: row(r), feed: { type: "crashed", cause: "storage", reason: "unknown", detail: "the browser closed the file storage" },
      want: wantReset("crash", "the browser closed the file storage") },
  ],
  RUN: r => [{ name: "", from: row(r), feed: RUN,
    want: ({ old, at }) => {
      const { worker } = inRow(old, "ready");
      return { state: { s: "running", worker, run: HEAD, t0: at }, effects: [{ do: "send-run", n: worker, code: RUN.code, head: HEAD }] };
    } }],
  BREAK: r => [
    { name: "the page can ask the run to stop", from: row(r), feed: { type: "break" },
      want: ({ old, at }) => {
        const { worker, run, t0 } = inRow(old, "running");
        return { state: { s: "breaking", worker, run, t0, resetAt: at + 5000 }, effects: [{ do: "interrupt", n: worker }, { do: "start-break-timer", n: worker, ms: 5000 }] };
      } },
    { name: "another grace time", from: row(r, { env: { graceMs: 200 } }), feed: { type: "break" },
      want: ({ old, at }) => {
        const { worker, run, t0 } = inRow(old, "running");
        return { state: { s: "breaking", worker, run, t0, resetAt: at + 200 }, effects: [{ do: "interrupt", n: worker }, { do: "start-break-timer", n: worker, ms: 200 }] };
      } },
    { name: "no SharedArrayBuffer: a reset at once", from: row(r, { env: { canInterrupt: false } }), feed: { type: "break" }, want: wantReset("break", NO_ISOLATION) },
  ],
  "KEEP-WAITING": r => [{ name: "", from: row(r), feed: { type: "keep-waiting" },
    want: ({ old }) => {
      const { worker, run, t0 } = inRow(old, "breaking");
      return { state: { s: "waiting", worker, run, t0 }, effects: [{ do: "cancel-break-timer" }] };
    } }],
  "END(result)": r => [0, 1, 111].map(rc => {
    const ended = result(rc);
    return { name: `rc ${rc}: the result is passed on as it is`, from: row(r), feed: { type: "run-ended", result: ended } as const, want: wantEnd(ended),
      also: (step: Step) => {
        const last = step.effects.at(-1)!;
        assert.ok(last.do === "end-run" && last.result === ended, "the same object, not a copy and not rewritten");
        assert.equal(ended.rc, rc);
      } };
  }),
  "END(run-failed)": r => [{ name: "", from: row(r), feed: { type: "run-failed", message: "no memory for the result" }, want: wantEnd(CUT("no memory for the result", "run-failed")) }],
  "RESET(break)": r => [{ name: "", from: row(r), feed: { type: "break-timeout" }, want: wantReset("break", "the code did not stop at Break") }],
} satisfies Record<string, (r: RowName, t: EventType) => Variant[]>;

type CellName = keyof typeof CELLS | "·" | "STALE";
const _ = "·", X = "STALE";

// A. The visitor's engine actions
const A: Record<RowName, Record<"start" | "ask" | "decline" | "stop-download" | "reset" | "take-over", CellName>> = {
  "checking-lock":    { start: _, ask: _, decline: _, "stop-download": _, reset: _, "take-over": _ },
  "checking-cache":   { start: _, ask: _, decline: _, "stop-download": _, reset: _, "take-over": _ },
  none:               { start: "DOWNLOAD(null)", ask: "ASK(null)", decline: _, "stop-download": _, reset: _, "take-over": _ },
  asking:             { start: "DOWNLOAD(queued)", ask: _, decline: "NOT-NOW", "stop-download": _, reset: _, "take-over": _ },
  declined:           { start: "DOWNLOAD(null)", ask: "ASK(null)", decline: _, "stop-download": _, reset: _, "take-over": _ },
  downloading:        { start: _, ask: _, decline: "STOP", "stop-download": "STOP", reset: _, "take-over": _ },
  "starting-list":    { start: _, ask: _, decline: _, "stop-download": _, reset: _, "take-over": _ },
  "starting-worker":  { start: _, ask: _, decline: _, "stop-download": _, reset: _, "take-over": _ },
  ready:              { start: _, ask: _, decline: _, "stop-download": _, reset: "RESET(user)", "take-over": _ },
  running:            { start: _, ask: _, decline: _, "stop-download": _, reset: "RESET(user)", "take-over": _ },
  breaking:           { start: _, ask: _, decline: _, "stop-download": _, reset: "RESET(user)", "take-over": _ },
  waiting:            { start: _, ask: _, decline: _, "stop-download": _, reset: "RESET(user)", "take-over": _ },
  failed:             { start: "DOWNLOAD(null)", ask: _, decline: _, "stop-download": _, reset: _, "take-over": _ },
  "failed-twice":     { start: _, ask: _, decline: _, "stop-download": _, reset: _, "take-over": _ },
  "other-tab-idle":   { start: _, ask: _, decline: _, "stop-download": _, reset: _, "take-over": "TAKE-OVER" },
  "other-tab-taking": { start: _, ask: _, decline: _, "stop-download": _, reset: _, "take-over": _ },
};
// B. Tab lock and cache check
const B: Record<RowName, Record<"lock-answered" | "lock-lost" | "cache-checked", CellName>> = {
  "checking-lock":    { "lock-answered": "OWN", "lock-lost": "LOST", "cache-checked": _ },
  "checking-cache":   { "lock-answered": _, "lock-lost": "LOST", "cache-checked": "CACHE" },
  none:               { "lock-answered": X, "lock-lost": "LOST", "cache-checked": X },
  asking:             { "lock-answered": X, "lock-lost": "LOST", "cache-checked": X },
  declined:           { "lock-answered": X, "lock-lost": "LOST", "cache-checked": X },
  downloading:        { "lock-answered": _, "lock-lost": "LOST", "cache-checked": _ },
  "starting-list":    { "lock-answered": _, "lock-lost": "LOST", "cache-checked": _ },
  "starting-worker":  { "lock-answered": _, "lock-lost": "LOST", "cache-checked": _ },
  ready:              { "lock-answered": _, "lock-lost": "LOST", "cache-checked": _ },
  running:            { "lock-answered": _, "lock-lost": "LOST", "cache-checked": _ },
  breaking:           { "lock-answered": _, "lock-lost": "LOST", "cache-checked": _ },
  waiting:            { "lock-answered": _, "lock-lost": "LOST", "cache-checked": _ },
  failed:             { "lock-answered": X, "lock-lost": "LOST", "cache-checked": X },
  "failed-twice":     { "lock-answered": X, "lock-lost": "LOST", "cache-checked": X },
  "other-tab-idle":   { "lock-answered": X, "lock-lost": _, "cache-checked": X },
  "other-tab-taking": { "lock-answered": "TAKEN", "lock-lost": "UNTAKEN", "cache-checked": _ },
};
// C. Download and the build's list
const C: Record<RowName, Record<"download-progress" | "download-done" | "download-failed" | "list-checked" | "list-failed", CellName>> = {
  "checking-lock":    { "download-progress": _, "download-done": _, "download-failed": _, "list-checked": _, "list-failed": _ },
  "checking-cache":   { "download-progress": _, "download-done": _, "download-failed": _, "list-checked": _, "list-failed": _ },
  none:               { "download-progress": X, "download-done": X, "download-failed": X, "list-checked": X, "list-failed": X },
  asking:             { "download-progress": X, "download-done": X, "download-failed": X, "list-checked": X, "list-failed": X },
  declined:           { "download-progress": X, "download-done": X, "download-failed": X, "list-checked": X, "list-failed": X },
  downloading:        { "download-progress": "PROGRESS", "download-done": "DONE", "download-failed": "FAIL(download)", "list-checked": _, "list-failed": _ },
  "starting-list":    { "download-progress": _, "download-done": _, "download-failed": _, "list-checked": "LISTED", "list-failed": "FAIL(list)" },
  "starting-worker":  { "download-progress": _, "download-done": _, "download-failed": _, "list-checked": _, "list-failed": _ },
  ready:              { "download-progress": _, "download-done": _, "download-failed": _, "list-checked": _, "list-failed": _ },
  running:            { "download-progress": _, "download-done": _, "download-failed": _, "list-checked": _, "list-failed": _ },
  breaking:           { "download-progress": _, "download-done": _, "download-failed": _, "list-checked": _, "list-failed": _ },
  waiting:            { "download-progress": _, "download-done": _, "download-failed": _, "list-checked": _, "list-failed": _ },
  failed:             { "download-progress": X, "download-done": X, "download-failed": X, "list-checked": X, "list-failed": X },
  "failed-twice":     { "download-progress": X, "download-done": X, "download-failed": X, "list-checked": X, "list-failed": X },
  "other-tab-idle":   { "download-progress": X, "download-done": X, "download-failed": X, "list-checked": X, "list-failed": X },
  "other-tab-taking": { "download-progress": _, "download-done": _, "download-failed": _, "list-checked": _, "list-failed": _ },
};
// D. Worker start and crash
const D: Record<RowName, Record<"stage" | "started" | "start-failed" | "crashed", CellName>> = {
  "checking-lock":    { stage: _, started: _, "start-failed": _, crashed: _ },
  "checking-cache":   { stage: _, started: _, "start-failed": _, crashed: _ },
  none:               { stage: X, started: X, "start-failed": X, crashed: X },
  asking:             { stage: X, started: X, "start-failed": X, crashed: X },
  declined:           { stage: X, started: X, "start-failed": X, crashed: X },
  downloading:        { stage: _, started: _, "start-failed": _, crashed: _ },
  "starting-list":    { stage: _, started: _, "start-failed": _, crashed: _ },
  "starting-worker":  { stage: "STAGE", started: "STARTED", "start-failed": "FAIL(start)", crashed: "CRASHED(starting)" },
  ready:              { stage: _, started: _, "start-failed": _, crashed: "RESET(crash)" },
  running:            { stage: _, started: _, "start-failed": _, crashed: "RESET(crash)" },
  breaking:           { stage: _, started: _, "start-failed": _, crashed: "RESET(crash)" },
  waiting:            { stage: _, started: _, "start-failed": _, crashed: "RESET(crash)" },
  failed:             { stage: X, started: X, "start-failed": X, crashed: X },
  "failed-twice":     { stage: X, started: X, "start-failed": X, crashed: X },
  "other-tab-idle":   { stage: X, started: X, "start-failed": X, crashed: X },
  "other-tab-taking": { stage: _, started: _, "start-failed": _, crashed: _ },
};
// E. Runs
const E: Record<RowName, Record<"run" | "break" | "keep-waiting" | "run-ended" | "run-failed" | "break-timeout", CellName>> = {
  "checking-lock":    { run: _, break: _, "keep-waiting": _, "run-ended": _, "run-failed": _, "break-timeout": _ },
  "checking-cache":   { run: _, break: _, "keep-waiting": _, "run-ended": _, "run-failed": _, "break-timeout": _ },
  none:               { run: "ASK(run)", break: _, "keep-waiting": _, "run-ended": X, "run-failed": X, "break-timeout": X },
  asking:             { run: _, break: _, "keep-waiting": _, "run-ended": X, "run-failed": X, "break-timeout": X },
  declined:           { run: "ASK(run)", break: _, "keep-waiting": _, "run-ended": X, "run-failed": X, "break-timeout": X },
  downloading:        { run: _, break: _, "keep-waiting": _, "run-ended": _, "run-failed": _, "break-timeout": _ },
  "starting-list":    { run: _, break: _, "keep-waiting": _, "run-ended": _, "run-failed": _, "break-timeout": _ },
  "starting-worker":  { run: _, break: _, "keep-waiting": _, "run-ended": _, "run-failed": _, "break-timeout": _ },
  ready:              { run: "RUN", break: _, "keep-waiting": _, "run-ended": _, "run-failed": _, "break-timeout": _ },
  running:            { run: _, break: "BREAK", "keep-waiting": _, "run-ended": "END(result)", "run-failed": "END(run-failed)", "break-timeout": _ },
  breaking:           { run: _, break: _, "keep-waiting": "KEEP-WAITING", "run-ended": "END(result)", "run-failed": "END(run-failed)", "break-timeout": "RESET(break)" },
  waiting:            { run: _, break: _, "keep-waiting": _, "run-ended": "END(result)", "run-failed": "END(run-failed)", "break-timeout": _ },
  failed:             { run: _, break: _, "keep-waiting": _, "run-ended": X, "run-failed": X, "break-timeout": X },
  "failed-twice":     { run: _, break: _, "keep-waiting": _, "run-ended": X, "run-failed": X, "break-timeout": X },
  "other-tab-idle":   { run: _, break: _, "keep-waiting": _, "run-ended": X, "run-failed": X, "break-timeout": X },
  "other-tab-taking": { run: _, break: _, "keep-waiting": _, "run-ended": _, "run-failed": _, "break-timeout": _ },
};
/** The five tables side by side: every row has a cell for every event, or this does not compile. */
const gridRow = (r: RowName): Record<EventType, CellName> => ({ ...A[r], ...B[r], ...C[r], ...D[r], ...E[r] });
const TYPES = Object.keys(gridRow("none")) as EventType[];

/** A payload for each event, for the cells where it changes nothing. */
const SAMPLE: { [T in EventType]: Extract<Feed, { type: T }> } = {
  start: { type: "start" }, ask: { type: "ask" }, decline: { type: "decline" }, "stop-download": { type: "stop-download" },
  reset: { type: "reset" }, "take-over": { type: "take-over" }, run: RUN, break: { type: "break" }, "keep-waiting": { type: "keep-waiting" },
  "lock-answered": { type: "lock-answered", owned: true }, "lock-lost": { type: "lock-lost" }, "cache-checked": { type: "cache-checked", cached: true },
  "download-progress": { type: "download-progress", received: 1, total: 2 }, "download-done": { type: "download-done", build: BUILD },
  "download-failed": { type: "download-failed", reason: "download", detail: "x" }, "list-checked": { type: "list-checked", build: BUILD },
  "list-failed": { type: "list-failed", reason: "download", detail: "x" }, stage: { type: "stage", stage: "files" }, started: { type: "started" },
  "start-failed": { type: "start-failed", reason: "unknown", detail: "x" }, crashed: CRASH,
  "run-ended": { type: "run-ended", result: result(0) }, "run-failed": { type: "run-failed", message: "x" }, "break-timeout": { type: "break-timeout" },
};

/** A ticket the row's state does not hold: an earlier one on the same path (the lock request's, the first), or, in
 *  `checking-lock`, where no earlier one exists, one from a second machine driven further. A state that holds none is
 *  given the last one issued. */
function staleTicket(r: RowName, here: At): Ticket {
  if (ticketOf(here.m.state) === null) return here.m.issued;
  return r === "checking-lock" ? row("checking-cache").m.issued : here.first.machine.issued;
}

/** One call of transition() and what must come of it. */
type Case = { row: RowName, type: EventType, name: string, from: At, event: Event, want: "stale" | "not-valid" | ((c: Ctx) => Want),
  also?: (step: Step, event: Event) => void };

function casesOf(r: RowName, t: EventType): Case[] {
  const cell = gridRow(r)[t], here = row(r), held = ticketOf(here.m.state), answer = t in ASKED_BY;
  const made = (name: string, from: At, f: Feed, n: Ticket | null, want: Case["want"], also?: Case["also"]): Case =>
    ({ row: r, type: t, name, from, event: eventAt(from, f, n === null ? {} : { n }), want, also });
  if (cell === "STALE") {
    assert.ok(answer && held === null, `${r} x ${t}: STALE is for an event with a ticket in a state that holds none`);
    return [made("", here, SAMPLE[t], staleTicket(r, here), "stale")];
  }
  if (cell === "·") {
    if (!answer) return [made("", here, SAMPLE[t], null, "not-valid")];
    assert.ok(held !== null, `${r} x ${t}: a state that holds no ticket drops every event with one (STALE)`);
    return [made("with the state's ticket", here, SAMPLE[t], held, "not-valid"), made("with another ticket", here, SAMPLE[t], staleTicket(r, here), "stale")];
  }
  const variants: Variant[] = CELLS[cell](r, t);
  const cases = variants.map(v => made(v.name, v.from, v.feed, answer ? ticketOf(v.from.m.state) : null, v.want, v.also));
  // the guard runs first: the same event with a ticket that is not the state's changes nothing
  if (answer) cases.push(made("with another ticket", here, variants[0].feed, staleTicket(r, here), "stale"));
  return cases;
}
const CASES: Case[] = ROWS.flatMap(r => TYPES.flatMap(t => casesOf(r, t)));
const label = (c: Case) => `${c.row} x ${c.type}${c.name ? ` (${c.name})` : ""}`;

test("the table: every row by every event, 16 by 24, with every variant of the cells that depend on a payload or on the machine", () => {
  assert.deepEqual([ROWS.length, TYPES.length, new Set(TYPES).size], [16, 24, 24]);
  for (const c of CASES) {
    const old = c.from.m, step = pure(old, c.event), what = label(c);
    if (typeof c.want === "string") {
      assert.equal(step.outcome, c.want, what);
      assert.equal(step.machine, old, `${what}: the machine itself, unchanged`);
      assert.deepEqual(step.effects, [], what);
      continue;
    }
    assert.equal(step.outcome, "taken", what);
    const want = c.want({ old, at: c.event.at, next: step.machine.issued });
    assert.deepEqual(step.machine.state, want.state, `${what}: the state`);
    assert.deepEqual(step.effects, want.effects, `${what}: the effects, in order`);
    assert.equal(step.machine.crashes, want.crashes ?? old.crashes, `${what}: the crash count`);
    assert.equal(step.machine.issued, want.issues ? old.issued + 1 : old.issued, `${what}: ${want.issues ? "one new ticket" : "no new ticket"}`);
    assert.equal(step.machine.env, old.env, `${what}: the environment`);
    c.also?.(step, c.event);
  }
});

test("the table's cells: every named cell is used, a state with no ticket has STALE under every event with one, and the others have none", () => {
  const used = new Set(ROWS.flatMap(r => Object.values(gridRow(r))));
  for (const name of Object.keys(CELLS)) assert.ok(used.has(name as CellName), `${name} is in no cell`);
  for (const r of ROWS) {
    const held = ticketOf(row(r).m.state) !== null;
    assert.equal(held, !["none", "asking", "declined", "failed", "failed-twice", "other-tab-idle"].includes(r), r);
    for (const t of TYPES) assert.equal(gridRow(r)[t] === "STALE", !held && t in ASKED_BY, `${r} x ${t}`);
  }
  assert.equal(TYPES.filter(t => t in ASKED_BY).length, 14, "fourteen events present a ticket");
});

// The matrix as transition() gives it, for docs/design/SPEC.md section 5 from step E on (rulings 10 and 12): each cell is
// "·", "STALE", or the states the event leads to. Here it is compared with the grid above.
function matrix(): Record<RowName, Record<EventType, string>> {
  const cell = (r: RowName, t: EventType) => {
    const steps = CASES.filter(c => c.row === r && c.type === t && c.name !== "with another ticket").map(c => pure(c.from.m, c.event));
    if (steps.every(s => s.outcome !== "taken")) return steps[0].outcome === "stale" ? "STALE" : "·";
    return [...new Set(steps.map(s => s.machine.state.s))].join(" | ");
  };
  return Object.fromEntries(ROWS.map(r => [r, Object.fromEntries(TYPES.map(t => [t, cell(r, t)]))])) as Record<RowName, Record<EventType, string>>;
}

test("the matrix built from transition() has the grid's cells: not valid, stale, or the states the event leads to", () => {
  const built = matrix();
  for (const r of ROWS) {
    for (const t of TYPES) {
      const name = gridRow(r)[t];
      if (name === "·" || name === "STALE") assert.equal(built[r][t], name, `${r} x ${t}`);
      else assert.match(built[r][t], /^[a-z-]+( \| [a-z-]+)*$/, `${r} x ${t}`);
    }
  }
  // a few cells, read off the design's tables
  assert.equal(built["checking-lock"]["lock-answered"], "checking-cache | none | other-tab-idle");
  assert.equal(built["starting-worker"].crashed, "starting-list | failed-twice");
  assert.equal(built.running.break, "breaking | starting-list");
  assert.equal(built.breaking["run-ended"], "ready");
  assert.equal(built["starting-worker"].started, "ready | running");
});

test("initial(): ticket 1, the lock request; lost() and cutResult() are today's sentence and rc 9998 result", () => {
  const first = initial(ENV);
  assert.deepEqual(first.machine.state, { s: "checking-lock", id: first.machine.issued });
  assert.deepEqual([first.machine.issued, first.machine.crashes, first.outcome], [1, 0, "taken"]);
  assert.deepEqual(first.effects, [{ do: "take-lock", n: first.machine.issued, steal: false }]);
  assert.equal(RC_RESET, 9998);
  assert.equal(lost("reset by you"), "session reset: reset by you. Data in memory is gone; your files are kept.");
  assert.deepEqual(cutResult("why", "crash"), CUT("why", "crash"));
  assert.equal(ticketOf(row("other-tab-idle").m.state), null);
  for (const r of ROWS) row(r);   // every row is reached from initial() by events
});

// ---- the race scenarios (item 8) ----

/** A state as a scenario names it: its tag and the fields that matter, tickets as numbers. */
type Looks = { s: RowName } & Record<string, unknown>;

/** A scenario: a path, with each step's state, crash count and every effect, in order. */
function play(start: At) {
  let at = start;
  return {
    get at() { return at; },
    /** `f` is taken: the state, every effect in order, and the crash count when named. */
    go(f: Feed, state: Looks, effects: Plain<Effect>[], o: { at?: number, crashes?: 0 | 1, n?: number } = {}) {
      at = go(at, f, { at: o.at, n: o.n === undefined ? undefined : numbered(at, o.n) });
      const { step } = at.trail.at(-1)!;
      assert.partialDeepStrictEqual(step.machine.state, state, `${f.type}: the state`);
      assert.equal(step.machine.state.s, state.s);
      assert.deepEqual(step.effects, effects, `${f.type}: the effects, in order`);
      if (o.crashes !== undefined) assert.equal(step.machine.crashes, o.crashes, `${f.type}: the crash count`);
      return this;
    },
    /** `f` changes nothing. `n`: the number of the ticket it presents (copied from this path). */
    drop(f: Feed, why: "stale" | "not-valid", n?: number) {
      const before = at.m;
      at = feed(at, f, n === undefined ? {} : { n: numbered(at, n) });
      const { step } = at.trail.at(-1)!;
      assert.equal(step.outcome, why, `${f.type}${n === undefined ? "" : ` {${n}}`}`);
      assert.equal(step.machine, before);
      assert.deepEqual(step.effects, []);
      return this;
    },
  };
}

const closed = { do: "close-dialog", dialog: "download", focusEditor: false } as const;
const up: Plain<Effect>[] = [{ do: "close-dialog", dialog: "download", focusEditor: true }, { do: "say", line: "ready" }, { do: "engine-ready" }];
const blocked: Plain<Effect>[] = [{ do: "block-store" }, { do: "engine-gone" }, { do: "show-dialog", dialog: "other-tab" }];
const endReset = (n: number, kind: ResetKind, reason: string): Plain<Effect> => ({ do: "end-worker", n, ending: { kind: "reset", reset: kind, reason: SENTENCE(reason) } });
const banner = (kind: ResetKind, reason: string): Plain<Effect>[] => [{ do: "add-reset-banner", reason, kind }, { do: "say", line: "reset" }, { do: "engine-gone" }];
const failedWith = (reason: FailReason, detail: string): Plain<Effect>[] => [closed, { do: "say", line: "failed" }, { do: "warn", text: `the engine didn't start (${reason}): ${detail}` }];
const BOOM = "the engine crashed (boom)";

const SCENARIOS: Record<string, () => At[]> = {
  "1. a reset, then a crash of the new start, with late answers: ready once, on the last worker": () => {
    const p = play(row("ready"));
    assert.deepEqual(p.at.m.state, { s: "ready", worker: 4 });
    p.go({ type: "reset" }, { s: "starting-list", worker: 5, done: {}, queued: null },
      [endReset(4, "user", "reset by you"), { do: "fetch-list", n: 5 }, ...banner("user", "reset by you")], { crashes: 0 })
      .drop({ type: "reset" }, "not-valid")
      .go({ type: "list-checked", build: BUILD }, { s: "starting-worker", worker: 5 }, [{ do: "start-worker", n: 5, build: BUILD }])
      .go(CRASH, { s: "starting-list", worker: 6 }, [endReset(5, "crash", BOOM), { do: "fetch-list", n: 6 }], { crashes: 1 })   // no banner, nothing said
      .drop({ type: "stage", stage: "python" }, "stale", 5)
      .drop({ type: "started" }, "stale", 5)
      .go({ type: "list-checked", build: BUILD }, { s: "starting-worker", worker: 6 }, [{ do: "start-worker", n: 6, build: BUILD }])
      .go({ type: "started" }, { s: "ready", worker: 6 }, up, { crashes: 0 });
    const said = p.at.trail.flatMap(t => t.step.effects).filter(e => e.do === "say" && e.line === "ready");
    assert.equal(said.length, 2, "\"Engine ready\" once for the first start (the path) and once after the reset");
    return [p.at];
  },
  "2. the lock lost during a download: no worker is ever started": () => {
    const p = play(row("asking"));
    assert.deepEqual([p.at.m.state, p.at.m.issued], [{ s: "asking", queued: null }, 2]);
    p.go({ type: "start" }, { s: "downloading", download: 3 }, [{ do: "start-download", n: 3 }])
      .go({ type: "lock-lost" }, { s: "other-tab-idle" }, [{ do: "abort-download", n: 3 }, ...blocked], { crashes: 0 })
      .drop({ type: "download-progress", received: 5, total: 9 }, "stale", 3)
      .drop({ type: "download-done", build: BUILD }, "stale", 3);
    assert.ok(!p.at.trail.some(t => t.step.effects.some(e => e.do === "start-worker")), "no start-worker");
    return [p.at];
  },
  "3. a crash while starting, on the first start: a new start, no banner, nothing said": () => {
    const p = play(row("downloading"));
    p.go({ type: "download-done", build: BUILD }, { s: "starting-worker", worker: 4, stage: "download" },
      [{ do: "start-worker", n: 4, build: BUILD }, { do: "say", line: { stage: "download" } }]);
    assert.deepEqual(Object.keys(inRow(p.at.m, "starting-worker").done), ["download"]);
    p.go(CRASH, { s: "starting-list", worker: 5, done: {}, queued: null }, [endReset(4, "crash", BOOM), { do: "fetch-list", n: 5 }], { crashes: 1 })
      .go({ type: "list-checked", build: BUILD }, { s: "starting-worker", worker: 5 }, [{ do: "start-worker", n: 5, build: BUILD }])
      .go({ type: "started" }, { s: "ready", worker: 5 }, up, { crashes: 0 });
    return [p.at];
  },
  "4. two take-overs: one steal at a time, and a take-over the lock is taken back from changes nothing": () => {
    const p = play(row("other-tab-idle"));
    assert.equal(p.at.m.issued, 1);
    p.go({ type: "take-over" }, { s: "other-tab-taking", take: 2 }, [{ do: "take-lock", n: 2, steal: true }])
      .drop({ type: "take-over" }, "not-valid")
      .go({ type: "lock-lost" }, { s: "other-tab-idle" }, [])   // the dialog stays
      .drop({ type: "lock-answered", owned: true }, "stale", 2)   // the store stays blocked
      .go({ type: "take-over" }, { s: "other-tab-taking", take: 3 }, [{ do: "take-lock", n: 3, steal: true }])
      .go({ type: "lock-answered", owned: true }, { s: "checking-cache", id: 4 },
        [{ do: "close-dialog", dialog: "other-tab", focusEditor: false }, { do: "own-files" }, { do: "check-cache", n: 4 }]);
    return [p.at];
  },
  "5. Break and its endings: rc 1, the run's own rc, the timer first (rc 9998), and \"Don't reset\"": () => {
    const broken = () => play(row("running"))
      .go({ type: "break" }, { s: "breaking", worker: 4, resetAt: 6000 }, [{ do: "interrupt", n: 4 }, { do: "start-break-timer", n: 4, ms: 5000 }], { at: 1000 })
      .drop({ type: "break" }, "not-valid");   // the first deadline stays
    const ends = [1, 0, 111].map(rc => {
      const ended = result(rc);
      const p = broken().go({ type: "run-ended", result: ended }, { s: "ready", worker: 4 }, [{ do: "cancel-break-timer" }, { do: "end-run", result: ended }]);
      const last = p.at.trail.at(-1)!.step.effects.at(-1)!;
      assert.ok(last.do === "end-run" && last.result === ended && last.result.rc === rc, `rc ${rc}: the same object, not rewritten`);
      return p.drop({ type: "break-timeout" }, "not-valid", 4).at;   // a timer that fires anyway
    });
    const timer = broken().go({ type: "break-timeout" }, { s: "starting-list", worker: 5 },
      [{ do: "cancel-break-timer" }, endReset(4, "break", "the code did not stop at Break"), { do: "fetch-list", n: 5 },
        ...banner("break", "the code did not stop at Break"), { do: "end-run", result: CUT(SENTENCE("the code did not stop at Break"), "break") }], { crashes: 0 })
      .drop({ type: "run-ended", result: result(1) }, "stale", 4).at;
    const kept = result(1);
    const waited = broken().go({ type: "keep-waiting" }, { s: "waiting", worker: 4 }, [{ do: "cancel-break-timer" }])
      .go({ type: "run-ended", result: kept }, { s: "ready", worker: 4 }, [{ do: "end-run", result: kept }]).at;
    return [...ends, timer, waited];
  },
  "6. a second crash: failed-twice, which nothing but losing the lock leaves; the count survives a failed start": () => {
    const crash = (reason: "memory" | "unknown" | "download") => ({ type: "crashed", cause: "error", reason, detail: "boom" }) as const;
    const twice = (reason: "memory" | "unknown" | "download") => {
      const detail = "the engine's worker failed twice (boom); reload the page";
      const p = play(row("ready"))
        .go(crash(reason), { s: "starting-list", worker: 5 }, [endReset(4, "crash", BOOM), { do: "fetch-list", n: 5 }, ...banner("crash", BOOM)], { crashes: 1 })
        .go({ type: "list-checked", build: BUILD }, { s: "starting-worker", worker: 5 }, [{ do: "start-worker", n: 5, build: BUILD }])
        .go(crash(reason), { s: "failed-twice", reason, detail },
          [{ do: "end-worker", n: 5, ending: { kind: "failed-twice", reason: detail } }, ...(reason === "memory" ? [] : [{ do: "forget-download" } as const]),
            closed, { do: "say", line: "failed-twice" }, { do: "warn", text: `the engine didn't start (${reason}): ${detail}` }], { crashes: 0 })
        .drop({ type: "started" }, "stale", 5)
        .drop({ type: "start" }, "not-valid")
        .drop({ type: "reset" }, "not-valid");
      return p.at;
    };
    // the variant: a crash, then a start that fails, then "Try again" and a crash: failed twice at once
    const p = play(row("ready"))
      .go(CRASH, { s: "starting-list", worker: 5 }, [endReset(4, "crash", BOOM), { do: "fetch-list", n: 5 }, ...banner("crash", BOOM)], { crashes: 1 })
      .go({ type: "list-checked", build: BUILD }, { s: "starting-worker", worker: 5 }, [{ do: "start-worker", n: 5, build: BUILD }])
      .go({ type: "start-failed", reason: "unknown", detail: "mount failed" }, { s: "failed", reason: "unknown" },
        [{ do: "end-worker", n: 5, ending: { kind: "failed", reason: "mount failed" } }, ...failedWith("unknown", "mount failed")], { crashes: 1 })
      .go({ type: "start" }, { s: "downloading", download: 6 }, [{ do: "start-download", n: 6 }], { crashes: 1 })
      .go({ type: "download-done", build: BUILD }, { s: "starting-worker", worker: 7 }, [{ do: "start-worker", n: 7, build: BUILD }, { do: "say", line: { stage: "download" } }], { crashes: 1 });
    p.go(CRASH, { s: "failed-twice", reason: "unknown" }, [
      { do: "end-worker", n: 7, ending: { kind: "failed-twice", reason: "the engine's worker failed twice (boom); reload the page" } }, { do: "forget-download" },
      closed, { do: "say", line: "failed-twice" }, { do: "warn", text: "the engine didn't start (unknown): the engine's worker failed twice (boom); reload the page" }], { crashes: 0 });
    return [twice("memory"), twice("unknown"), twice("download"), p.at];
  },
  "7. the lock lost while the cache check is pending: no download, no worker": () => [
    play(row("checking-cache")).go({ type: "lock-lost" }, { s: "other-tab-idle" }, blocked).drop({ type: "cache-checked", cached: true }, "stale", 2).at],
  "8. \"Not now\" during the download, which then completes: no start": () => [
    play(row("downloading")).go({ type: "decline" }, { s: "declined" }, [{ do: "abort-download", n: 3 }, closed, { do: "say", line: "download-stopped" }])
      .drop({ type: "download-done", build: BUILD }, "stale", 3).at],
  "9. a run cut by losing the lock: the store is blocked before the run's result is handed over": () => [
    play(row("running")).go({ type: "lock-lost" }, { s: "other-tab-idle" },
      [{ do: "end-worker", n: 4, ending: { kind: "stopped", reason: SENTENCE("another tab took over") } }, ...blocked,
        { do: "end-run", result: CUT(SENTENCE("another tab took over"), "stopped") }], { crashes: 0 }).at],
  "10. a crash during a run, with the result on its way": () => [
    play(row("running")).go(CRASH, { s: "starting-list", worker: 5 },
      [endReset(4, "crash", BOOM), { do: "fetch-list", n: 5 }, ...banner("crash", BOOM), { do: "end-run", result: CUT(SENTENCE(BOOM), "crash") }], { crashes: 1 })
      .drop({ type: "run-ended", result: result(0) }, "stale", 4).at],
  "11. a wrong ticket: an older download's progress": () => [
    play(row("downloading")).go({ type: "stop-download" }, { s: "declined" }, [{ do: "abort-download", n: 3 }, closed, { do: "say", line: "download-stopped" }])
      .go({ type: "start" }, { s: "downloading", download: 4, received: 0 }, [{ do: "start-download", n: 4 }])
      .drop({ type: "download-progress", received: 5, total: 9 }, "stale", 3)   // the first download's reply is bound to 3
      .go({ type: "download-progress", received: 7, total: 9 }, { s: "downloading", download: 4, received: 7, total: 9 }, []).at],
  "12. the queued run through a crash: it runs on the second worker, straight from starting-worker": () => {
    const p = play(row("declined"))
      .go(RUN, { s: "asking", queued: QUEUED }, [{ do: "show-dialog", dialog: "download", forRun: true }])
      .go({ type: "start" }, { s: "downloading", download: 3, queued: QUEUED }, [{ do: "start-download", n: 3 }])
      .go({ type: "download-done", build: BUILD }, { s: "starting-worker", worker: 4, queued: QUEUED }, [{ do: "start-worker", n: 4, build: BUILD }, { do: "say", line: { stage: "download" } }])
      .go(CRASH, { s: "starting-list", worker: 5, queued: QUEUED }, [endReset(4, "crash", BOOM), { do: "fetch-list", n: 5 }], { crashes: 1 })
      .go({ type: "list-checked", build: BUILD }, { s: "starting-worker", worker: 5, queued: QUEUED }, [{ do: "start-worker", n: 5, build: BUILD }])
      .go({ type: "started" }, { s: "running", worker: 5, run: HEAD }, [...up, { do: "send-run", n: 5, code: "display 1", head: HEAD }], { crashes: 0 });
    // the run is dropped instead by "Not now", STOP, FAIL, TWICE and LOST: none of their states has a `queued` field
    const dropped = [
      go(row("asking", { queued: true }), { type: "decline" }), go(row("downloading", { queued: true }), { type: "stop-download" }),
      go(row("downloading", { queued: true }), { type: "download-failed", reason: "download", detail: "x" }),
      go(row("starting-worker", { queued: true }), { type: "start-failed", reason: "unknown", detail: "x" }),
      go(row("starting-list", { queued: true, crashed: true }), { type: "list-failed", reason: "download", detail: "x" }),
      go(row("starting-worker", { queued: true, crashed: true }), CRASH), go(row("starting-worker", { queued: true }), { type: "lock-lost" }),
    ];
    assert.deepEqual(dropped.map(at => at.m.state.s), ["declined", "declined", "failed", "failed", "failed", "failed-twice", "other-tab-idle"]);
    for (const at of dropped) assert.ok(!("queued" in at.m.state), at.m.state.s);
    return [p.at, ...dropped];
  },
  "13. Download or Run pressed at load, before the lock or the cache check answers: refused": () => [
    play(row("checking-lock")).drop({ type: "start" }, "not-valid").drop(RUN, "not-valid").drop({ type: "ask" }, "not-valid").at,
    play(row("checking-cache")).drop({ type: "start" }, "not-valid").drop(RUN, "not-valid").drop({ type: "ask" }, "not-valid")
      .go({ type: "cache-checked", cached: false }, { s: "asking", queued: null }, [{ do: "show-dialog", dialog: "download", forRun: false }]).at],
  "14. the list fetch of a restart fails, or the lock is lost meanwhile: no worker is made": () => {
    const restart = () => play(row("ready")).go({ type: "reset" }, { s: "starting-list", worker: 5 },
      [endReset(4, "user", "reset by you"), { do: "fetch-list", n: 5 }, ...banner("user", "reset by you")]);
    const updated = restart().go({ type: "list-failed", reason: "updated", detail: "dofile was updated: reload the page" }, { s: "failed", reason: "updated" },
      failedWith("updated", "dofile was updated: reload the page"), { crashes: 0 }).at;
    const offline = restart().go({ type: "list-failed", reason: "download", detail: "Failed to fetch" }, { s: "failed", reason: "download" }, failedWith("download", "Failed to fetch"))
      .go({ type: "start" }, { s: "downloading", download: 6 }, [{ do: "start-download", n: 6 }]).at;
    const lostLock = restart().go({ type: "lock-lost" }, { s: "other-tab-idle" }, blocked).drop({ type: "list-checked", build: BUILD }, "stale", 5).at;
    for (const at of [updated, offline, lostLock]) {
      const after = at.trail.slice(row("ready").trail.length).flatMap(t => t.step.effects);
      assert.equal(after.filter(e => e.do === "end-worker").length, 1, "only the reset's end-worker: there is no worker 5 to end");
      assert.ok(!after.some(e => e.do === "start-worker"));
    }
    return [updated, offline, lostLock];
  },
  "15. a read op is outside the machine: the reset and the run's end beside it are ordinary steps": () => {
    const ended = result(0);
    return [
      play(row("running")).go({ type: "reset" }, { s: "starting-list", worker: 5 },
        [endReset(4, "user", "reset by you"), { do: "fetch-list", n: 5 }, ...banner("user", "reset by you"), { do: "end-run", result: CUT(SENTENCE("reset by you"), "user") }]).at,
      play(row("running")).go({ type: "run-ended", result: ended }, { s: "ready", worker: 4 }, [{ do: "end-run", result: ended }]).at,
    ];
  },
  "16. the lock lost before its answer is dispatched: the store stays blocked": () => [
    play(row("checking-lock")).go({ type: "lock-lost" }, { s: "other-tab-idle" }, blocked).drop({ type: "lock-answered", owned: true }, "stale", 1).at],
};
for (const [name, run] of Object.entries(SCENARIOS)) test(`scenario ${name}`, () => { run(); });

// ---- the properties (item 6): over every cell of the table, every row's path and every step of every scenario ----

const everyMove = (): Moved[] => [
  ...CASES.map(c => ({ before: c.from.m, event: c.event, step: pure(c.from.m, c.event) })),
  ...ROWS.flatMap(r => row(r).trail),
  ...Object.values(SCENARIOS).flatMap(run => run().flatMap(at => at.trail)),
];
const count = (step: Step, name: Effect["do"]) => step.effects.filter(e => e.do === name).length;
const running = (s: State) => s.s === "running" || s.s === "breaking" || s.s === "waiting";
/** The states with a live worker, and its ticket. `starting-list` holds the ticket of a worker that is not made yet. */
const liveWorker = (s: State): Ticket | null => (s.s === "starting-worker" || s.s === "ready" || running(s) ? ticketOf(s) : null);
const says = (m: Moved) => `${m.before.state.s} x ${m.event.type} -> ${m.step.machine.state.s}`;
/** Every ticket a step shows: the new state's and the effects'. */
const ticketsOf = (step: Step): Ticket[] => [ticketOf(step.machine.state), ...step.effects.map(e => ("n" in e ? e.n : null))].filter(n => n !== null);

test("property: an event that is stale or not valid changes nothing: the same machine, no effects", () => {
  const moves = everyMove();
  assert.ok(moves.length > 600, `${moves.length} steps`);
  for (const m of moves) {
    if (m.step.outcome === "taken") continue;
    assert.equal(m.step.machine, m.before, says(m));
    assert.deepEqual(m.step.effects, [], says(m));
    assert.equal(m.step.outcome, "n" in m.event && m.event.n !== ticketOf(m.before.state) ? "stale" : "not-valid", says(m));
  }
});

test("property: a transition from running, breaking or waiting to a state that is none of those has exactly one end-run, as its last effect; no other has one", () => {
  for (const m of everyMove()) {
    const cut = running(m.before.state) && !running(m.step.machine.state);
    assert.equal(count(m.step, "end-run"), cut ? 1 : 0, says(m));
    if (cut) assert.equal(m.step.effects.at(-1)!.do, "end-run", `${says(m)}: last`);
  }
});

test("property: a transition from ready, running, breaking or waiting to a state that does not hold the same worker has engine-gone, once", () => {
  for (const m of everyMove()) {
    const a = m.before.state, b = m.step.machine.state;
    if (a.s !== "ready" && !running(a)) continue;
    assert.equal(count(m.step, "engine-gone"), liveWorker(b) === liveWorker(a) ? 0 : 1, says(m));
  }
});

test("property: a ticket is issued once: no state holds one above `issued`, `issued` never goes down, and a new ticket is the old `issued` + 1", () => {
  for (const m of everyMove()) {
    const was = m.before.issued, now = m.step.machine.issued;
    assert.ok(now === was || now === was + 1, `${says(m)}: issued ${was} -> ${now}`);
    for (const n of ticketsOf(m.step)) {
      assert.ok(n <= now, `${says(m)}: ticket ${n} above issued ${now}`);
      if (n > was) assert.equal(n, was + 1, says(m));
    }
    assert.ok((ticketOf(m.before.state) ?? 0) <= was);
  }
});

test("property: the machine only asks for answers it can accept: an answered effect carries the ticket the new state holds", () => {
  const answered = new Set<string>(Object.values(ASKED_BY));
  let seen = 0;
  for (const m of everyMove()) {
    for (const e of m.step.effects) {
      if (!("n" in e) || !answered.has(e.do)) continue;
      seen++;
      assert.equal(e.n, ticketOf(m.step.machine.state), `${says(m)}: ${e.do}`);
    }
  }
  assert.ok(seen > 100);
});

test("property: every exit from breaking cancels the Break timer, before any end-worker; start-break-timer only from running to breaking", () => {
  for (const m of everyMove()) {
    const a = m.before.state.s, b = m.step.machine.state.s, names = m.step.effects.map(e => e.do);
    if (a === "breaking" && b !== "breaking") {
      assert.equal(count(m.step, "cancel-break-timer"), 1, says(m));
      if (names.includes("end-worker")) assert.ok(names.indexOf("cancel-break-timer") < names.indexOf("end-worker"), `${says(m)}: before end-worker`);
    } else {
      assert.equal(count(m.step, "cancel-break-timer"), 0, says(m));
    }
    assert.equal(count(m.step, "start-break-timer"), a === "running" && b === "breaking" ? 1 : 0, says(m));
  }
});

// Addition A1
test("property: every exit from downloading that is not that download's own end aborts it, once, with the state's ticket; no other transition aborts", () => {
  let exits = 0;
  for (const m of everyMove()) {
    const a = m.before.state, aborts = m.step.effects.filter(e => e.do === "abort-download");
    const own = m.event.type === "download-done" || m.event.type === "download-failed";
    if (a.s === "downloading" && m.step.machine.state.s !== "downloading" && !own) {
      exits++;
      assert.deepEqual(aborts, [{ do: "abort-download", n: a.download }], says(m));
    } else {
      assert.deepEqual(aborts, [], says(m));
    }
  }
  assert.ok(exits >= 4, "decline, stop-download and lock-lost, with and without a queued run");
});

test("property: one live worker: start-worker only from downloading and starting-list, into starting-worker with that ticket; a worker that is left is ended, once, and nothing else is", () => {
  for (const m of everyMove()) {
    const a = m.before.state, b = m.step.machine.state, was = liveWorker(a);
    const starts = m.step.effects.filter(e => e.do === "start-worker"), ends = m.step.effects.filter(e => e.do === "end-worker");
    if (starts.length) {
      assert.ok(a.s === "downloading" || a.s === "starting-list", says(m));
      assert.equal(starts.length, 1, says(m));
      assert.deepEqual([b.s, liveWorker(b)], ["starting-worker", starts[0].n], says(m));
    }
    if (was !== null && liveWorker(b) !== was) assert.deepEqual(ends.map(e => e.n), [was], says(m));
    else assert.deepEqual(ends, [], says(m));
  }
});

test("property: over every path, the effects never make a second worker while one is live, and never end one that was not made", () => {
  const paths = [...ROWS.map(r => row(r)), ...Object.values(SCENARIOS).flatMap(run => run())];
  for (const at of paths) {
    let live: Ticket | null = null, made = 0;
    for (const e of stepsOf(at).flatMap(s => s.effects)) {
      if (e.do === "start-worker") { assert.equal(live, null, "a worker is still live"); live = e.n; made++; }
      if (e.do === "end-worker") { assert.equal(e.n, live, "the worker that is ended is the live one"); live = null; }
    }
    assert.equal(live, liveWorker(at.m.state), `at the end of the path (${made} workers)`);
  }
});

// ---- what must not compile ----
// Each line marked @ts-expect-error fails `npm run check` if it starts to compile: the compiler's refusals are not lost.
// `dispatch` and `reply` stand for the controller's (src/app/engine.ts), with the same signatures.

// @ts-expect-error an effect with a ticket and no row
export type NoRow = Expect<AnswersOk<Omit<Answers, "interrupt">>>;
// @ts-expect-error a row for an effect without a ticket
export type RowWithoutTicket = Expect<AnswersOk<Answers & { "own-files": never }>>;
// @ts-expect-error an event without a ticket as an answer
export type PlainAnswer = Expect<AnswersOk<Omit<Answers, "take-lock"> & { "take-lock": "lock-answered" | "lock-lost" }>>;
// @ts-expect-error an event with a ticket that no effect is answered with
export type NoEffect = Expect<AnswersOk<Omit<Answers, "start-break-timer"> & { "start-break-timer": never }>>;
// @ts-expect-error an event under two effects
export type TwoEffects = Expect<AnswersOk<Omit<Answers, "interrupt"> & { interrupt: "started" }>>;
// @ts-expect-error a misspelt event
export type Misspelt = Expect<AnswersOk<Omit<Answers, "take-lock"> & { "take-lock": "lock-answerd" }>>;

// @ts-expect-error check 1: a state the views cannot see
export type MissingTag = Expect<SameTags<Exclude<EngineState, { s: "none" }>>>;
// @ts-expect-error check 2: a ticket in a view's state
export type TicketShown = Expect<NothingHidden<EngineState | { s: "ready"; worker: Ticket }>>;
// @ts-expect-error check 2: a queued run in a view's state
export type QueuedShown = Expect<NothingHidden<EngineState | { s: "asking"; queued: QueuedRun | null }>>;

/** Never called: only compiled. */
export function mustNotCompile(machine: Machine, ticket: Ticket, endWorker: Extract<Effect, { do: "end-worker" }>,
  dispatch: (event: PlainEvent) => Step | null, say: Reply<"start-download">,
  reply: <K extends Answered>(effect: TicketedEffect & { do: K }) => Reply<K>) {
  // @ts-expect-error a number is not a Ticket
  const made: Ticket = 4;
  // @ts-expect-error a counter cannot be written as a literal
  const forged: Machine = { ...machine, issued: 0 };
  // @ts-expect-error an event with a ticket is not a PlainEvent, so dispatch does not take it
  dispatch({ type: "download-progress", n: ticket, received: 1, total: 2 });
  // @ts-expect-error an answer has no ticket
  say({ type: "download-done", build: null, n: ticket });
  // @ts-expect-error not an answer of this effect
  say({ type: "started" });
  // @ts-expect-error an effect that is never answered gets no reply
  reply(endWorker);
  // @ts-expect-error check 3: a case of view() that builds a field the member does not have
  const shown: EngineState = { s: "ready", worker: ticket };
  return [made, forged, shown];
}
