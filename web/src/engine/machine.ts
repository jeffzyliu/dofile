// The engine's state machine: every state of the engine in the page, every event that can happen to it, and what each
// event does in each state. One pure function, transition(machine, event), gives the machine after the event and the
// effects the caller must then perform. The design, with the tables this file holds cell for cell:
// docs/prototype1-step3.5-c-design.md (items 1 to 5); the diagrams: docs/prototype1-step3.5-c-diagrams.md.
//
// How to read it: State (sixteen members, one per row of the table), Event (twenty-four), Effect; then the shorthands
// (DOWNLOAD, ASK, STOP, OWN, BREAK, END, FAIL, TWICE, RESET, LOST), then TABLE, one row per state with a cell for each
// event that is valid in it, then transition(): the stale guard, the lookup, and the one line for an event that is not
// valid.
//
// Pure: only types are imported; no clock (the time comes in the event, `at`), no timer, no console, no signal, no
// transport, no variable at the top level, and no input is changed. Two casts in the file: mint() and the table lookup.
// The controller (src/app/engine.ts) is the one caller of transition(); it performs the effects.
import type { Build, CutKind, FailReason, ResetKind, RunHead, RunResult, Stage } from "./types.ts";

/** The rc of a run the machine cut (the session was reset: the data in memory is gone), or whose op failed in the worker. */
export const RC_RESET = 9998;

// ---- State ----

declare const brand: unique symbol;
/** The number of one asynchronous request. The machine issues it, a state holds at most one, an answer presents it.
 *  Only mint() in this file makes one; all other code copies it from an effect, a state or a machine. */
export type Ticket = number & { readonly [brand]: true };
/** THE ONE CAST that makes a ticket. Not exported. */
const mint = (n: number): Ticket => n as Ticket;
/** The next ticket of a machine: every new ticket is issued + 1. */
const issue = (m: Machine): Ticket => mint(m.issued + 1);

/** Fixed at load; given once to initial(). */
export interface Env {
  snapshot: boolean;              // the snapshot start: the first stage is "download" (a cache read), else "python"
  canInterrupt: boolean;          // SharedArrayBuffer exists; without it Break resets at once
  graceMs: number;                // 5000: how long Break waits before the engine is reset
  engineBytes: number | null;     // the total shown before the first progress event
  manual: boolean;                // ?test=manual: no start until start() is called
}
/** A run asked for with no engine: it runs when the engine has started. */
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

// ---- Event ----

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
/** at: Date.now(), stamped once, where the controller queues the event. */
export type Event = Happening & { at: number };

/** The events that present a ticket, and those that do not. */
export type TicketedEvent = Extract<Happening, { n: Ticket }>;
export type PlainEvent = Exclude<Happening, { n: Ticket }>;

// ---- Effect ----

/** Why a worker is ended: what its pending queries reject with (ClientError's kind, and `reason` as its message). */
export type Ending = { kind: "reset"; reset: ResetKind; reason: string }
                   | { kind: "stopped" | "failed" | "failed-twice"; reason: string };
/** What the live region says: one of the fixed lines, or a start-up stage. The words are the controller's. */
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

// Answers is checked by the compiler, both ways: three facts about it are types that must come out `true`.
// The rules are the logic; the types below only carry them out. Four ideas recur in them:
//  - Distribution: `T extends unknown ? F<T> : never` applies F to each member of a union T on its own.
//  - Map, then index: `{ [K in keyof X]: ... }[keyof X]` builds an object, then reads every key at once: the union of the values.
//  - `[T] extends [U]` (in brackets) compares T as a whole and stops distribution; `never` needs it (a bare `never` distributes to nothing).
//  - `Equal<T, never>` asks "is this set empty?".
/** true when A and B are exactly the same type (stricter than assignable both ways: it tells `any` and unions apart). */
export type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
/** Compiles only for `true`, so `Expect<Equal<X, Y>>` is an assertion: `Expect<false>` is a type error. */
export type Expect<T extends true> = T;
/** true for a union of two or more types: IsUnion<"a" | "b"> is true, IsUnion<"a"> is false, IsUnion<never> is never. */
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

/** The effects that are answered: their performers get a reply. The keys of Answers whose row is not `never`
 *  (map each key to itself or `never`, then read them all: a row of `never` drops out). */
export type Answered = { [K in keyof Answers]: [Answers[K]] extends [never] ? never : K }[keyof Answers];

/** Omit, for each member of a union on its own. Plain Omit on a union keeps only the keys all members share and
 *  loses each member's own fields: DistributiveOmit<{ type: "a"; x: 1; n: T } | { type: "b"; y: 2; n: T }, "n"> is
 *  { type: "a"; x: 1 } | { type: "b"; y: 2 }. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** Every event with a ticket, without the ticket: all that any performer could say. */
export type AnyAnswer = DistributiveOmit<TicketedEvent, "n">;
/** What the performer of effect K may say: one of K's answers, without the ticket. */
export type Answer<K extends Answered> = Extract<AnyAnswer, { type: Answers[K] }>;
/** The function a performer answers through. The controller binds it to the effect's ticket; the performer writes none. */
export type Reply<K extends Answered> = (answer: Answer<K>) => void;

// ---- what the machine makes itself ----

/** The sentence of a session that was reset. */
export const lost = (reason: string): string => `session reset: ${reason}. Data in memory is gone; your files are kept.`;

/** What a run that was cut ends with: every RunResult field and no timing, plus `kind` (why). */
export const cutResult = (error: string, kind: CutKind): RunResult => ({ rc: RC_RESET, error, error_command: null, log: "", results: null, nobs: 0, nvars: 0, new_graphs: 0, images: [], error_line: null, graph_commands: [], graph_lines: [], kind });

/** The ticket of what this state waits on or uses; null when it has none. */
export function ticketOf(state: State): Ticket | null {
  switch (state.s) {
    case "checking-lock": case "checking-cache": return state.id;
    case "downloading": return state.download;
    case "starting-list": case "starting-worker": case "ready": case "running": case "breaking": case "waiting":
      return state.worker;
    case "other-tab-taking": return state.take;
    case "none": case "asking": case "declined": case "failed": case "failed-twice": case "other-tab-idle": return null;
    default: return state satisfies never;
  }
}

/** The machine at the page load: it asks for the tab lock. */
export function initial(env: Env): Step {
  const first = mint(1);           // the first ticket: the counter never has a zero
  return { machine: { env, state: { s: "checking-lock", id: first }, issued: first, crashes: 0 },
    effects: [{ do: "take-lock", n: first, steal: false }], outcome: "taken" };
}

// ---- the shorthands of the tables ----

/** The machine in one of the rows R: what a cell, or a shorthand used from several rows, is given. */
type In<R extends RowName> = Machine & { state: StateOf<R> };
export type EventOf<T extends Event["type"]> = Extract<Event, { type: T }>;

const step = (machine: Machine, effects: Effect[] = []): Step => ({ machine, effects, outcome: "taken" });
const same = (machine: Machine, outcome: "stale" | "not-valid"): Step => ({ machine, effects: [], outcome });
/** The first stage of a start: the snapshot start reads the cache first, ?snapshot=0 starts Python. */
const firstStage = (env: Env): Stage => (env.snapshot ? "download" : "python");

/** DOWNLOAD(queued): `downloading`, with a new ticket. */
function DOWNLOAD(m: Machine, queued: QueuedRun | null, at: number): Step {
  const next = issue(m);
  return step({ ...m, issued: next, state: { s: "downloading", download: next, received: 0, total: m.env.engineBytes ?? 0, t0: at, queued } },
    [{ do: "start-download", n: next }]);
}

/** ASK(queued): `asking`, and the download prompt, titled for a run when one is queued. */
const ASK = (m: Machine, queued: QueuedRun | null): Step =>
  step({ ...m, state: { s: "asking", queued } }, [{ do: "show-dialog", dialog: "download", forRun: queued !== null }]);

/** STOP: "Stop download", and "Not now" during the download. The queued run is dropped. */
const STOP = (m: In<"downloading">): Step => step({ ...m, state: { s: "declined" } },
  [{ do: "abort-download", n: m.state.download }, { do: "close-dialog", dialog: "download", focusEditor: false }, { do: "say", line: "download-stopped" }]);

/** OWN: the tab lock is this tab's. `before`: the effects that come first (a take-over closes its dialog). */
function OWN(m: Machine, before: Effect[]): Step {
  if (m.env.manual) return step({ ...m, state: { s: "none" } }, [...before, { do: "own-files" }]);
  const next = issue(m);
  return step({ ...m, issued: next, state: { s: "checking-cache", id: next } }, [...before, { do: "own-files" }, { do: "check-cache", n: next }]);
}

/** BREAK: ask the run to stop and start the timer; a page that cannot ask resets at once. */
function BREAK(m: In<"running">, at: number): Step {
  if (!m.env.canInterrupt) {
    return RESET(m, "break", "Break reset the engine, because this page is not cross-origin isolated and cannot ask a run to stop", at);
  }
  const { worker, run, t0 } = m.state;
  return step({ ...m, state: { s: "breaking", worker, run, t0, resetAt: at + m.env.graceMs } },
    [{ do: "interrupt", n: worker }, { do: "start-break-timer", n: worker, ms: m.env.graceMs }]);
}

/** END(result): the run ended and the worker stays. The result is passed on as it is, whatever its rc. */
function END(m: In<"running" | "breaking" | "waiting">, result: RunResult): Step {
  const effects: Effect[] = [];
  if (m.state.s === "breaking") effects.push({ do: "cancel-break-timer" });
  effects.push({ do: "end-run", result });
  return step({ ...m, state: { s: "ready", worker: m.state.worker } }, effects);
}

/** FAIL(reason, detail): the download, the list or the start failed. The crash count stays. */
function FAIL(m: In<"downloading" | "starting-list" | "starting-worker">, reason: FailReason, detail: string): Step {
  const effects: Effect[] = [];
  if (m.state.s === "starting-worker") effects.push({ do: "end-worker", n: m.state.worker, ending: { kind: "failed", reason: detail } });
  effects.push({ do: "close-dialog", dialog: "download", focusEditor: false }, { do: "say", line: "failed" },
    { do: "warn", text: `the engine didn't start (${reason}): ${detail}` });
  return step({ ...m, state: { s: "failed", reason, detail } }, effects);
}

/** TWICE(reason, detail): a second crash before a start finished. It is not started again. */
function TWICE(m: In<"starting-worker">, reason: FailReason, cause: string): Step {
  const detail = `the engine's worker failed twice (${cause}); reload the page`;
  const effects: Effect[] = [{ do: "end-worker", n: m.state.worker, ending: { kind: "failed-twice", reason: detail } }];
  // the start files may be at fault (not for memory or WebAssembly): a reload then downloads them fresh
  if (reason !== "memory" && reason !== "no-wasm") effects.push({ do: "forget-download" });
  effects.push({ do: "close-dialog", dialog: "download", focusEditor: false }, { do: "say", line: "failed-twice" },
    { do: "warn", text: `the engine didn't start (${reason}): ${detail}` });
  return step({ ...m, crashes: 0, state: { s: "failed-twice", reason, detail } }, effects);
}

/** RESET(kind): the worker is ended and a new start begins with the build's list, fetched fresh. A run in progress ends
 *  with rc 9998, as the last effect. The banner and "Engine reset" only when the engine being replaced had been ready. */
function RESET(m: In<"starting-worker" | "ready" | "running" | "breaking" | "waiting">, kind: ResetKind, reason: string, at: number): Step {
  const old = m.state, next = issue(m), effects: Effect[] = [];
  if (old.s === "breaking") effects.push({ do: "cancel-break-timer" });
  effects.push({ do: "end-worker", n: old.worker, ending: { kind: "reset", reset: kind, reason: lost(reason) } }, { do: "fetch-list", n: next });
  if (old.s !== "starting-worker") effects.push({ do: "add-reset-banner", reason, kind }, { do: "say", line: "reset" }, { do: "engine-gone" });
  if (old.s === "running" || old.s === "breaking" || old.s === "waiting") effects.push({ do: "end-run", result: cutResult(lost(reason), kind) });
  return step({ ...m, issued: next, crashes: kind === "crash" ? 1 : 0,
    state: { s: "starting-list", worker: next, stage: firstStage(m.env), t0: at, done: {}, queued: old.s === "starting-worker" ? old.queued : null } }, effects);
}

/** LOST: another tab took the tab lock. Whatever this tab was doing ends, and it is blocked. */
function LOST(m: In<Exclude<RowName, "other-tab-idle" | "other-tab-taking">>): Step {
  const old = m.state, effects: Effect[] = [];
  if (old.s === "downloading") effects.push({ do: "abort-download", n: old.download });
  if (old.s === "breaking") effects.push({ do: "cancel-break-timer" });
  if (old.s === "starting-worker" || old.s === "ready" || old.s === "running" || old.s === "breaking" || old.s === "waiting") {
    effects.push({ do: "end-worker", n: old.worker, ending: { kind: "stopped", reason: lost("another tab took over") } });
  }
  effects.push({ do: "block-store" }, { do: "engine-gone" }, { do: "show-dialog", dialog: "other-tab" });
  if (old.s === "running" || old.s === "breaking" || old.s === "waiting") {
    effects.push({ do: "end-run", result: cutResult(lost("another tab took over"), "stopped") });
  }
  return step({ ...m, crashes: 0, state: { s: "other-tab-idle" } }, effects);
}

/** The reason of a RESET(crash), from the crash's cause. */
const crashReason = (e: EventOf<"crashed">): string =>
  (e.cause === "storage" ? "the browser closed the file storage" : `the engine crashed (${e.detail})`);

// ---- the table ----

/** One cell: this row's state and this column's event, both narrowed already. */
type Cell<R extends RowName, T extends Event["type"]> = (m: In<R>, e: EventOf<T>) => Step;
/** One row: a cell for each event that is valid in it. An event with no cell is not valid there. */
type Row<R extends RowName> = { [T in Event["type"]]?: Cell<R, T> };

const TABLE: { [R in RowName]: Row<R> } = {
  "checking-lock": {
    "lock-answered": (m, e) => (e.owned ? OWN(m, [])
      : step({ ...m, state: { s: "other-tab-idle" } }, [{ do: "show-dialog", dialog: "other-tab" }])),
    "lock-lost": LOST,
  },
  "checking-cache": {
    "lock-lost": LOST,
    "cache-checked": (m, e) => (e.cached ? DOWNLOAD(m, null, e.at) : ASK(m, null)),
  },
  none: {
    start: (m, e) => DOWNLOAD(m, null, e.at),
    ask: m => ASK(m, null),
    run: (m, e) => ASK(m, { code: e.code, head: e.head }),
    "lock-lost": LOST,
  },
  asking: {
    start: (m, e) => DOWNLOAD(m, m.state.queued, e.at),
    decline: m => step({ ...m, state: { s: "declined" } }, [{ do: "close-dialog", dialog: "download", focusEditor: false }]),
    "lock-lost": LOST,
  },
  declined: {
    start: (m, e) => DOWNLOAD(m, null, e.at),
    ask: m => ASK(m, null),
    run: (m, e) => ASK(m, { code: e.code, head: e.head }),
    "lock-lost": LOST,
  },
  downloading: {
    decline: STOP,
    "stop-download": STOP,
    "lock-lost": LOST,
    "download-progress": (m, e) => step({ ...m, state: { ...m.state, received: e.received, total: e.total } }),
    "download-done": (m, e) => {
      const next = issue(m), stage = firstStage(m.env);
      return step({ ...m, issued: next, state: { s: "starting-worker", worker: next, stage, t0: e.at,
        done: { download: (e.at - m.state.t0) / 1000 }, queued: m.state.queued } },
      [{ do: "start-worker", n: next, build: e.build }, { do: "say", line: { stage } }]);
    },
    "download-failed": (m, e) => FAIL(m, e.reason, e.detail),
  },
  "starting-list": {
    "lock-lost": LOST,
    "list-checked": (m, e) => step({ ...m, state: { ...m.state, s: "starting-worker" } },
      [{ do: "start-worker", n: m.state.worker, build: e.build }]),
    "list-failed": (m, e) => FAIL(m, e.reason, e.detail),
  },
  "starting-worker": {
    "lock-lost": LOST,
    stage: (m, e) => {
      const { stage, t0, done } = m.state;
      if (e.stage === stage) return step(m);   // a stage seen twice (the snapshot start reads the cache after the download)
      // a stage that comes back adds up its time
      return step({ ...m, state: { ...m.state, stage: e.stage, t0: e.at, done: { ...done, [stage]: (done[stage] ?? 0) + (e.at - t0) / 1000 } } },
        [{ do: "say", line: { stage: e.stage } }]);
    },
    started: (m, e) => {
      const { worker, queued } = m.state;
      const up: Effect[] = [{ do: "close-dialog", dialog: "download", focusEditor: true }, { do: "say", line: "ready" }, { do: "engine-ready" }];
      if (!queued) return step({ ...m, crashes: 0, state: { s: "ready", worker } }, up);
      return step({ ...m, crashes: 0, state: { s: "running", worker, run: queued.head, t0: e.at } },
        [...up, { do: "send-run", n: worker, code: queued.code, head: queued.head }]);
    },
    "start-failed": (m, e) => FAIL(m, e.reason, e.detail),
    crashed: (m, e) => (m.crashes === 0 ? RESET(m, "crash", crashReason(e), e.at) : TWICE(m, e.reason, e.detail)),
  },
  ready: {
    reset: (m, e) => RESET(m, "user", "reset by you", e.at),
    "lock-lost": LOST,
    crashed: (m, e) => RESET(m, "crash", crashReason(e), e.at),
    run: (m, e) => step({ ...m, state: { s: "running", worker: m.state.worker, run: e.head, t0: e.at } },
      [{ do: "send-run", n: m.state.worker, code: e.code, head: e.head }]),
  },
  running: {
    reset: (m, e) => RESET(m, "user", "reset by you", e.at),
    "lock-lost": LOST,
    crashed: (m, e) => RESET(m, "crash", crashReason(e), e.at),
    break: (m, e) => BREAK(m, e.at),
    "run-ended": (m, e) => END(m, e.result),
    "run-failed": (m, e) => END(m, cutResult(e.message, "run-failed")),
  },
  breaking: {
    reset: (m, e) => RESET(m, "user", "reset by you", e.at),
    "lock-lost": LOST,
    crashed: (m, e) => RESET(m, "crash", crashReason(e), e.at),
    "keep-waiting": m => step({ ...m, state: { s: "waiting", worker: m.state.worker, run: m.state.run, t0: m.state.t0 } },
      [{ do: "cancel-break-timer" }]),
    "run-ended": (m, e) => END(m, e.result),
    "run-failed": (m, e) => END(m, cutResult(e.message, "run-failed")),
    "break-timeout": (m, e) => RESET(m, "break", "the code did not stop at Break", e.at),
  },
  waiting: {
    reset: (m, e) => RESET(m, "user", "reset by you", e.at),
    "lock-lost": LOST,
    crashed: (m, e) => RESET(m, "crash", crashReason(e), e.at),
    "run-ended": (m, e) => END(m, e.result),
    "run-failed": (m, e) => END(m, cutResult(e.message, "run-failed")),
  },
  failed: {
    start: (m, e) => DOWNLOAD(m, null, e.at),
    "lock-lost": LOST,
  },
  "failed-twice": {
    "lock-lost": LOST,
  },
  "other-tab-idle": {
    "take-over": m => {
      const next = issue(m);
      return step({ ...m, issued: next, state: { s: "other-tab-taking", take: next } }, [{ do: "take-lock", n: next, steal: true }]);
    },
  },
  "other-tab-taking": {
    "lock-answered": (m, e) => (e.owned ? OWN(m, [{ do: "close-dialog", dialog: "other-tab", focusEditor: false }])
      : step({ ...m, state: { s: "other-tab-idle" } })),
    "lock-lost": m => step({ ...m, state: { s: "other-tab-idle" } }),   // the take-over is cancelled: its answer is then stale
  },
};

/** The machine after `e`, and what the caller must do. An event that changes nothing says why in `outcome`: "stale" (it
 *  presents a ticket that is not the state's) or "not-valid" (no cell for it in this state). */
export function transition(m: Machine, e: Event): Step {
  if ("n" in e && e.n !== ticketOf(m.state)) return same(m, "stale");                   // the one stale guard
  const cell = TABLE[m.state.s][e.type] as Cell<RowName, Event["type"]> | undefined;    // THE ONE CAST of the table
  return cell ? cell(m, e) : same(m, "not-valid");     // the one place an event that is not valid changes nothing
}
