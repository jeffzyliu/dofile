// The engine controller: the one caller of the state machine (src/engine/machine.ts). It holds the machine, feeds it
// events, performs the effects each step gives, and writes the `engine` signal from the machine's state. It decides
// nothing itself: which state follows which event, and what must be done then, is the machine's table. The design:
// docs/prototype1-step3.5-c-design.md (items 5 and 7); the data-flow map: docs/prototype1-step3.5-c-diagrams.md, 1.
//
//   an action (start, decline, run, ...) or lost()      dispatch(event)          events WITHOUT a ticket only
//   an answer to an effect (the lock, the download,     reply(effect)(answer)    THE ONE PLACE a ticket is put on an event
//   the worker, the Break timer)
//                                   both: enqueue -> transition (THE ONE CALL) -> the `engine` signal -> perform(effect)...
//
// The page's order at load (main.tsx, the only module that constructs or connects):
//   connectFiles(store);  connectRun(handlers);  connectEngine({ client, lock, snapshot, manual });  open();
// Views call the actions below and read the `engine` signal; they never reach the transport. `call` is the page's one
// provider of read ops. What a run leaves (results, data, memory, ...) is run.ts's, which hears of a run and of a new or
// lost engine through the handlers given to connectRun.

import type { Builds, Lifecycle, Reader } from "../engine/client.ts";
import type {
  Answered,
  AnyAnswer,
  Effect,
  Env,
  Event,
  Line,
  Machine,
  PlainEvent,
  Reply,
  RowName,
  State,
  Step,
  Ticket,
  TicketedEffect,
} from "../engine/machine.ts";
import { initial, RC_RESET, transition } from "../engine/machine.ts";
import type { ClientError, ReadOps, RunResult, ViewOp } from "../engine/types.ts";
import { BREAK_GRACE_MS } from "../engine/types.ts";
import { editorCommands } from "./editor/commands.ts";
import { block, own } from "./files.ts";
import * as S from "./state.ts";
import { engineWriter } from "./state.ts";
import { stageNow } from "./states/words.ts";
import type { EngineState, FailReason, RunHead, Stage } from "./types.ts";

// ---- the words ----

/** The stages a start goes through, in order (OQ-11): the snapshot start, or ?snapshot=0. */
export const stagesOf = (snapshot: boolean): Stage[] =>
  snapshot
    ? ["download", "unpack", "python", "files", "engine"]
    : ["download", "python", "files", "packages", "engine"];

/** What the live region and the dialog's rows say at each stage (S 2's stage list): `stageNow` in states/words.ts is the one
 *  list. The status bar says the same phrase with a small first letter, after its "Starting · ". */
export const stageWords: Record<Stage, string> = stageNow;
export const stageStatus = Object.fromEntries(
  Object.entries(stageNow).map(([k, v]) => [k, v[0].toLowerCase() + v.slice(1)]),
) as Record<Stage, string>;

/** The message of a start that failed with reason "updated". 4d's "Reload the page" keys on the reason, not on these words. */
export const UPDATED = "dofile has a newer version on this site. Reload the page to use it.";

/** What a failed start tells the visitor (`message`), by reason: what happened and what they can do, in plain words. The
 *  developer's cause (a file name, a byte count, `npm run snapshot`) is `detail`, and goes to the console. */
export const FAILED: Record<FailReason, string> = {
  "no-wasm": "This browser can't run the engine: it has no WebAssembly support. Try another browser.",
  download: "The engine didn't download completely. Check your connection, then try again.",
  memory: "There wasn't enough memory to start the engine. Close other tabs, then try again.",
  updated: UPDATED,
  unknown: "Something went wrong while starting the engine. Try again, or reload the page.",
};
/** The message of `failed-twice`, whatever the reason: it is not started again, so only a reload helps. */
export const FAILED_TWICE =
  "The engine failed twice while starting, so it won't try again by itself. Reload the page to try again.";

/** The fixed lines of the live region (the effect `say`). A stage's line is stageWords. */
const SAY: Record<Exclude<Line, { stage: Stage }>, string> = {
  ready: "Engine ready",
  reset: "Engine reset",
  "download-stopped": "Download stopped",
  failed: "The engine didn't start",
  "failed-twice": "The engine stopped after failing twice",
};

// ---- the wiring ----

/** What run.ts does for the engine (connectRun): a run began (its head, and the theme it is sent with), a chunk of its
 *  log came, it ended with `result` (always after the `engine` signal has the new state; when the machine cut the run,
 *  after engineGone), an engine is ready, the engine is gone. A handler must not call run(): a step is in progress. */
export interface RunHandlers {
  began(head: RunHead, theme: "light" | "dark"): void;
  log(text: string): void;
  ended(result: RunResult): void;
  dropped(): void; // the queued run will not run (the effect drop-run)
  engineReady(): void;
  engineGone(): void;
}
/** The tab lock (engine/tab.ts, tabLock). */
type Lock = { take(o?: { steal?: boolean }): Promise<boolean> };
/** An event that changed nothing: its type, the ticket it presented (when it has one), the state it found, and why. */
export type Drop = { type: Event["type"]; n?: number; row: RowName; why: "stale" | "not-valid" };

// Each connectEngine makes a new wiring. A reply captures the one that performed its effect and does nothing once it
// has been replaced: every machine counts its tickets from 1, so a ticket says which request, not which machine.
let wiring: object = {};
let env: Env | null = null;
let reader: Reader | null = null; // the transport's read ops: `call`
// what performs an effect: it alone holds the transport's Lifecycle and Builds, and the tab lock (performer())
let perform: (effect: Effect) => void = () => {
  throw new Error("the engine controller is not connected: call connectEngine() first");
};
let machine: Machine | null = null; // null until open()
let queue: Event[] = []; // events raised while a step's effects are performed
let stepping = false; // a step is in progress: its effects are being performed
let dropped: Drop[] = []; // the drop record (the last DROPS_KEPT)
const DROPS_KEPT = 200;
// The two handles. Each is made by one effect and released by another; neither decides a state.
let breakTimer: ReturnType<typeof setTimeout> | undefined; // start-break-timer, cancel-break-timer
let download: { n: Ticket; stop: AbortController } | null = null; // start-download, abort-download
let runs: RunHandlers = { began() {}, log() {}, ended() {}, dropped() {}, engineReady() {}, engineGone() {} };

/** Wire the controller to the page's transport and tab lock. `snapshot`: the snapshot start (not ?snapshot=0). `manual`:
 *  ?test=manual, no start until the test calls start(). `graceMs`: how long Break waits before the engine is reset.
 *  `canInterrupt`: whether Break can ask a run to stop (a SharedArrayBuffer exists; the tests may say). A second call
 *  replaces the wiring: the machine, the queue, the handles and the drop record are cleared, and nothing of the earlier
 *  wiring can act any more. open() then starts the new machine. */
export function connectEngine({
  client,
  lock,
  snapshot,
  manual,
  graceMs = BREAK_GRACE_MS,
  canInterrupt = typeof SharedArrayBuffer !== "undefined",
}: {
  client: Reader & Lifecycle & Builds;
  lock: Lock;
  snapshot: boolean;
  manual: boolean;
  graceMs?: number;
  canInterrupt?: boolean;
}) {
  clearTimeout(breakTimer);
  download?.stop.abort();
  breakTimer = undefined;
  download = null;
  wiring = {};
  machine = null;
  queue = [];
  dropped = [];
  env = { snapshot, canInterrupt, graceMs, engineBytes: S.engineBytes, manual };
  reader = client;
  perform = performer(client, client, lock);
}

/** Give the controller what run.ts does for it (main.tsx: connectRun(handlers)). */
export function connectRun(handlers: RunHandlers) {
  runs = handlers;
}

/** The events that changed nothing since connectEngine, oldest first (the last 200): a stale answer, or an event that is
 *  not valid in the state it found. The tests assert the exact list; the test hook has it too. */
export const drops = (): Drop[] => [...dropped];

// ---- events in, effects out ----

/** The page load: the machine starts, and asks for the tab lock. Once for each wiring. */
export function open(): void {
  if (!env) throw new Error("the engine controller is not connected: call connectEngine() first");
  if (machine) throw new Error("open() was called twice on one wiring");
  const first = initial(env);
  stepping = true;
  try {
    apply(first, null);
  } finally {
    stepping = false;
  }
  drain(null);
}

/** An action, or the tab lock lost: an event without a ticket. Returns its step when it ran at once (the queue was
 *  empty: an action called from an event handler), or null when it had to wait for a step in progress. */
function dispatch(event: PlainEvent): Step | null {
  return enqueue(event);
}

/** A performer's way to answer its effect: bound to the effect's ticket, typed to that effect's answers. */
const reply = <K extends Answered>(effect: TicketedEffect & { do: K }): Reply<K> => {
  const mine = wiring; // the wiring that performed this effect
  return (answer) => {
    if (mine !== wiring) return; // a reply of an earlier wiring does nothing
    const said: AnyAnswer = answer;
    enqueue({ ...said, n: effect.n }); // THE ONE PLACE a ticket is put on an event
  };
};

/** Queue an event, stamped with the time. It runs now unless a step is in progress: then it runs after that step's
 *  effects, in order. */
function enqueue(happening: PlainEvent | (AnyAnswer & { n: Ticket })): Step | null {
  if (!machine) throw new Error("the engine controller is not open: call open() first");
  const event: Event = { ...happening, at: Date.now() };
  queue.push(event);
  return stepping ? null : drain(event);
}

/** Run the queue: one step for each event, in order. Returns the step of `watched`. */
function drain(watched: Event | null): Step | null {
  let mine: Step | null = null;
  stepping = true;
  try {
    for (let event = queue.shift(); event && machine; event = queue.shift()) {
      const step = transition(machine, event); // THE ONE CALL of transition
      if (event === watched) mine = step;
      apply(step, event);
    }
  } finally {
    stepping = false;
  }
  return mine;
}

/** One step: the machine, then the `engine` signal, then the effects, in order. An event that changed nothing is
 *  recorded instead. The effects are performed also when a subscriber of the signal throws (a view's effect that calls
 *  run() during the step, say): a step whose state is shown and whose effects are not would leave, on a reset, the old
 *  worker live. The subscriber's error still goes to whoever raised the event. A performer that throws is another
 *  matter, and a bug in the wiring (the transport's start() with a worker still live): the step's later effects are not
 *  performed, the error goes to whoever raised the event, and the events queued behind it run with the next event. */
function apply(step: Step, event: Event | null) {
  const before = machine;
  machine = step.machine;
  if (event && step.outcome !== "taken") {
    dropped.push({
      type: event.type,
      ...("n" in event ? { n: event.n } : {}),
      row: step.machine.state.s,
      why: step.outcome,
    });
    if (dropped.length > DROPS_KEPT) dropped.shift();
    return;
  }
  try {
    if (step.machine.state !== before?.state) engineWriter.engine.value = view(step.machine.state);
  } finally {
    for (const effect of step.effects) perform(effect);
  }
}

/** The state as views see it: the same tag, without the tickets and the queued run, with the visitor's words. The one
 *  writer of the `engine` signal. It drops and adds fields; it maps no names. */
function view(state: State): EngineState {
  switch (state.s) {
    case "checking-lock":
    case "checking-cache":
    case "none":
    case "declined":
    case "ready":
    case "other-tab-idle":
    case "other-tab-taking":
      return { s: state.s };
    case "asking":
      return { s: "asking", forRun: state.queued !== null };
    case "downloading":
      return { s: "downloading", received: state.received, total: state.total, t0: state.t0 };
    case "starting-list":
    case "starting-worker":
      return { s: state.s, stage: state.stage, t0: state.t0, done: state.done };
    case "running":
    case "waiting":
      return { s: state.s, run: state.run, t0: state.t0 };
    case "breaking":
      return { s: "breaking", run: state.run, t0: state.t0, resetAt: state.resetAt };
    case "failed":
      return { s: "failed", reason: state.reason, detail: state.detail, message: FAILED[state.reason] };
    case "failed-twice":
      return { s: "failed-twice", reason: state.reason, detail: state.detail, message: FAILED_TWICE };
    default:
      return state satisfies never;
  }
}

/** Whether a download or a list fetch failed because the site was updated: from the error's kind, never its text. */
const updated = (e: ClientError): boolean => e?.kind === "updated";

/** The effect performer. Only this function's result holds the transport's Lifecycle and Builds, and the tab lock. */
function performer(lifecycle: Lifecycle, builds: Builds, lock: Lock): (effect: Effect) => void {
  /** start-download: download() fills the Cache. An AbortError (abort-download) raises nothing. A download that fails for
   *  any cause other than another build is reason "download". */
  function startDownload(n: Ticket, say: Reply<"start-download">) {
    const stop = new AbortController();
    download = { n, stop };
    builds
      .download({
        signal: stop.signal,
        onProgress: ({ received, total }) => say({ type: "download-progress", received, total }),
      })
      .then(
        (done) => say({ type: "download-done", build: done.build }),
        (e) => {
          if (e?.name !== "AbortError")
            say({
              type: "download-failed",
              reason: updated(e) ? "updated" : "download",
              detail: String(e?.message ?? e),
            });
        },
      );
  }
  /** send-run: run.ts is told the run began, then the worker is sent the code. A run whose worker was ended says
   *  nothing: the machine has cut it already. */
  function sendRun({ n, code, head }: Extract<Effect, { do: "send-run" }>, say: Reply<"send-run">) {
    const theme = S.resolvedTheme.value;
    runs.began(head, theme);
    lifecycle
      .run(n, { code, fresh_locals: head.fresh_locals, plot_theme: theme }, (text) => runs.log(text))
      .then(
        (result) => say({ type: "run-ended", result }),
        (e: ClientError) => {
          if (e?.kind === "op") say({ type: "run-failed", message: String(e.message) });
        },
      );
  }
  return (effect) => {
    switch (effect.do) {
      case "take-lock": {
        const say = reply(effect);
        lock.take({ steal: effect.steal }).then((owned) => say({ type: "lock-answered", owned }));
        return;
      }
      case "own-files":
        return own();
      case "block-store":
        return block();
      case "check-cache": {
        const say = reply(effect);
        builds.cached().then((cached) => say({ type: "cache-checked", cached }));
        return;
      }
      case "start-download":
        return startDownload(effect.n, reply(effect));
      case "abort-download":
        if (download?.n === effect.n) download.stop.abort();
        return;
      case "fetch-list": {
        const say = reply(effect);
        builds.build().then(
          (build) => say({ type: "list-checked", build }),
          (e: ClientError) =>
            say({
              type: "list-failed",
              reason: updated(e) ? "updated" : e?.reason === "download" ? "download" : "unknown",
              detail: String(e?.message ?? e),
            }),
        );
        return;
      }
      case "forget-download":
        builds.forgetDownload();
        return;
      case "start-worker":
        return lifecycle.start(effect.n, effect.build, reply(effect));
      case "end-worker":
        return lifecycle.end(effect.n, effect.ending);
      case "send-run":
        return sendRun(effect, reply(effect));
      case "interrupt":
        return lifecycle.interrupt(effect.n);
      case "start-break-timer": {
        const say = reply(effect);
        breakTimer = setTimeout(() => say({ type: "break-timeout" }), effect.ms);
        return;
      }
      case "cancel-break-timer":
        clearTimeout(breakTimer);
        breakTimer = undefined;
        return;
      case "end-run":
        return runs.ended(effect.result);
      case "drop-run":
        return runs.dropped();
      case "engine-ready":
        return runs.engineReady();
      case "engine-gone":
        return runs.engineGone();
      case "show-dialog":
        S.dialog.value = effect.dialog === "download" ? { d: "download", forRun: effect.forRun } : { d: "other-tab" };
        return;
      case "close-dialog":
        if (S.dialog.value?.d !== effect.dialog) return;
        S.dialog.value = null;
        // once the dialog is gone: the page is inert while it is open
        if (effect.focusEditor) setTimeout(() => editorCommands.focus(), 0);
        return;
      case "add-reset-banner":
        return S.addBanner({ b: "reset", reason: effect.reason, kind: effect.kind });
      case "say":
        return S.say(typeof effect.line === "string" ? SAY[effect.line] : stageWords[effect.line.stage]);
      case "warn":
        return console.warn(`[dofile] ${effect.text}`);
      default:
        return effect satisfies never;
    }
  };
}

// ---- the actions: each is one event. The machine's table says where each acts; anywhere else it does nothing. ----

/** "Download 48 MB", "Try again", and every start the visitor begins: the download fills the Cache, then the worker
 *  starts. Acts in `none`, `asking`, `declined` and `failed`. A second press does nothing. */
export function start(): void {
  dispatch({ type: "start" });
}

/** Show the download prompt (`asking`): the declined banner's "Download the engine". Acts in `none` and `declined`. */
export function ask(): void {
  dispatch({ type: "ask" });
}

/** "Not now". Acts in `asking`, and in `downloading`, where it also aborts the download (what arrived stays in the cache). */
export function decline(): void {
  dispatch({ type: "decline" });
}

/** "Stop download": the fetches are aborted, and the state goes to `declined` (what arrived stays in the cache). */
export function stopDownload(): void {
  dispatch({ type: "stop-download" });
}

/** Reset (confirmed in its dialog) and "Reset now": a new worker; the data in memory is lost, the files stay. Acts in
 *  `ready`, `running`, `breaking` and `waiting`. */
export function reset(): void {
  dispatch({ type: "reset" });
}

/** "Use dofile in this tab": take the lock from the other tab, then go on as a page load. Acts in `other-tab-idle`; a
 *  second press while the take-over is in progress does nothing. */
export function takeOver(): void {
  dispatch({ type: "take-over" });
}

/** The tab lock was taken by another tab (tabLock's onLost): whatever this tab was doing ends, and it is blocked. */
export function lost(): void {
  dispatch({ type: "lock-lost" });
}

/** Break: ask the run to stop. `breaking` until it stops or the grace time runs out (`resetAt`), and then a reset. A page
 *  that cannot ask (not cross-origin isolated) is reset at once. Acts in `running`. */
export function breakRun(): void {
  dispatch({ type: "break" });
}

/** "Don't reset: wait for it": the Break stays asked; the run stops after this command. Acts in `breaking`. */
export function keepWaiting(): void {
  dispatch({ type: "keep-waiting" });
}

/** Run `code` (run.ts calls this; views call run.ts). "started": the engine was ready, and the run began (run.ts has been
 *  told). "queued": there is no engine yet (`none`, `declined`): the download prompt is open, titled for a run, and the
 *  run begins when the engine has started. "refused": any other state; nothing happens.
 *  It must not be called while a step is in progress (from a handler given to connectRun): it throws, before anything is
 *  queued. Code that wants to run something when a run ends does it after the run's promise resolves. */
export function run(code: string, head: RunHead): "started" | "queued" | "refused" {
  if (stepping)
    throw new Error(
      "run() was called while a step of the engine's state machine is in progress: call it after the step, for example when the run's promise has resolved",
    );
  const step = dispatch({ type: "run", code, head });
  if (step?.outcome !== "taken") return "refused";
  return step.effects.some((effect) => effect.do === "send-run") ? "started" : "queued";
}

/** A read op (describe, browse, matrix, macros, memory, describe_file): the page's one way to ask the engine for data.
 *  run.ts asks after each run; a view asks only for what it alone shows (`matrix`, `describe_file`). It raises no event.
 *  Rejects with the transport's error: kind "no-engine" with no worker, "reset" when a reset cut it. */
export function call<K extends ViewOp>(op: K, args?: ReadOps[K]["args"]): Promise<ReadOps[K]["result"]> {
  if (!reader) throw new Error("the engine controller is not connected: call connectEngine() first");
  return reader.query(op, args);
}

/** Whether a result is the machine's own rc 9998, with no log of its own: a run cut (a reset, another tab) or, with kind
 *  "run-failed", a run whose op failed in the worker (the worker stays). */
export const fromClient = (r: RunResult) => r.rc === RC_RESET && "kind" in r;
