// The engine controller: the one caller of the state machine (src/engine/machine.ts). It feeds the machine events,
// performs the effects each step gives, and writes the `engine` signal from the machine's state. Which state follows
// which event is the machine's table, not decided here.
//
// Events come in by two doors: dispatch() for an action or lost() (no ticket), and reply() for an answer to an effect
// (the one place a ticket is put on an event). Both enqueue, then transition, then the signal, then perform.

import type { Builds, Lifecycle, Reader } from "../engine/client.ts";
import type {
  Answered,
  AnyAnswer,
  Effect,
  Env,
  Event,
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
import { block, own } from "./files.ts";
import * as S from "./state.ts";
import { engineWriter, graphicsWriter } from "./state.ts";
import { FAILED, FAILED_TWICE, SAY, stageNow } from "./states/words.ts";
import type { EngineState, RunHead } from "./types.ts";
import { ask as askFocus, fromAnywhere } from "./ui/focus-targets.ts";

// ---- the wiring ----

/** What run.ts does for the engine (connectRun). `ended` comes after the `engine` signal has the new state, and when
 *  the machine cut the run, after engineGone. A handler must not call run(): a step is in progress. */
export interface RunHandlers {
  began(head: RunHead, theme: "light" | "dark"): void;
  log(text: string): void;
  ended(result: RunResult): void;
  engineReady(): void;
  engineGone(): void;
}
type Lock = { take(o?: { steal?: boolean }): Promise<boolean> };
/** An event that changed nothing: its type, the ticket it presented (when it has one), the state it found, and why. */
export type Drop = { type: Event["type"]; n?: number; row: RowName; why: "stale" | "not-valid" };

/** Handles made by one effect and released by another; the next connectEngine releases them all. */
type Handles = {
  breakTimer: ReturnType<typeof setTimeout> | undefined; // start-break-timer, cancel-break-timer
  download: { n: Ticket; stop: AbortController } | null; // start-download, abort-download
  offGraphics: (() => void) | null; // the transport's graphics subscription
};
/** What one connectEngine was given, its performer and that performer's handles. A reply captures the wiring that
 *  performed its effect and does nothing once it has been replaced: every machine counts its tickets from 1, so a ticket
 *  says which request, not which machine. */
type Wiring = {
  env: Env;
  reader: Reader; // the transport's read ops: `call`
  perform: (effect: Effect) => void;
  handles: Handles;
};
let wiring: Wiring | null = null; // null until connectEngine
let machine: Machine | null = null; // null until open()
let queue: Event[] = []; // events raised while a step's effects are performed
let stepping = false; // a step is in progress: its effects are being performed
let dropped: Drop[] = []; // the last DROPS_KEPT
const DROPS_KEPT = 200;
let runs: RunHandlers = { began() {}, log() {}, ended() {}, engineReady() {}, engineGone() {} };

/** Wire the controller to the page's transport and tab lock. A second call replaces the wiring: the machine, the queue,
 *  the handles and the drop record are cleared, and nothing of the earlier wiring can act any more. open() then starts
 *  the new machine.
 *  @param snapshot - the snapshot start (not ?snapshot=0)
 *  @param manual - ?test=manual: no start until the test calls start()
 *  @param graceMs - how long Break waits before the engine is reset
 *  @param canInterrupt - whether Break can ask a run to stop (a SharedArrayBuffer exists; the tests may say) */
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
  if (wiring) {
    const { offGraphics, breakTimer, download } = wiring.handles;
    offGraphics?.();
    clearTimeout(breakTimer);
    download?.stop.abort();
  }
  const handles: Handles = {
    breakTimer: undefined,
    download: null,
    offGraphics:
      client.onGraphics?.((p) => {
        graphicsWriter.part.value = p;
      }) ?? null,
  };
  wiring = {
    env: { snapshot, canInterrupt, graceMs, engineBytes: S.engineBytes, manual },
    reader: client,
    perform: performer(client, client, lock, handles),
    handles,
  };
  machine = null;
  queue = [];
  dropped = [];
}

/** The current wiring. */
function connected(): Wiring {
  if (!wiring) throw new Error("the engine controller is not connected: call connectEngine() first");
  return wiring;
}

/** Give the controller what run.ts does for it. */
export function connectRun(handlers: RunHandlers) {
  runs = handlers;
}

/** The events that changed nothing since connectEngine, oldest first (the last 200): a stale answer, or an event that
 *  is not valid in the state it found. */
export const drops = (): Drop[] => [...dropped];

// ---- events in, effects out ----

/** The page load: the machine starts, and asks for the tab lock. Once for each wiring. */
export function open(): void {
  const { env } = connected();
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

/** An event without a ticket. Returns its step when it ran at once, or null when it had to wait for a step in
 *  progress. */
function dispatch(event: PlainEvent): Step | null {
  return enqueue(event);
}

/** A performer's way to answer its effect: bound to the effect's ticket, typed to that effect's answers. */
const reply = <K extends Answered>(effect: TicketedEffect & { do: K }): Reply<K> => {
  const mine = wiring; // the wiring that performed this effect
  return (answer) => {
    if (mine !== wiring) return; // a reply of an earlier wiring does nothing
    const said: AnyAnswer = answer;
    enqueue({ ...said, n: effect.n }); // the one place a ticket is put on an event
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
      const step = transition(machine, event);
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
 *  run() during the step, say): a state shown with its effects not performed would leave, on a reset, the old worker
 *  live. The subscriber's error still goes to whoever raised the event. A performer that throws is a bug in the wiring:
 *  the step's later effects are not performed, and the events queued behind it run with the next event. */
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
    for (const effect of step.effects) connected().perform(effect);
  }
}

/** The state as views see it: the same tag, without the tickets, with the visitor's words. */
function view(state: State): EngineState {
  switch (state.s) {
    case "checking-lock":
    case "checking-cache":
    case "none":
    case "declined":
    case "asking":
    case "ready":
    case "other-tab-idle":
    case "other-tab-taking":
      return { s: state.s };
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
/** Why a download or a list fetch failed, from the error's kind and reason. */
const failReason = (e: ClientError): "download" | "updated" | "unknown" =>
  updated(e) ? "updated" : e?.reason === "download" ? "download" : "unknown";

const ENDINGS = new Set<ClientError["kind"] | undefined>(["reset", "stopped", "failed", "failed-twice"]);

/** The effect performer: the only holder of the transport's Lifecycle and Builds, and the tab lock. It keeps its
 *  handles in its wiring's `handles`. */
function performer(lifecycle: Lifecycle, builds: Builds, lock: Lock, handles: Handles): (effect: Effect) => void {
  /** An AbortError (abort-download) raises nothing. */
  function startDownload(n: Ticket, say: Reply<"start-download">) {
    const stop = new AbortController();
    handles.download = { n, stop };
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
              reason: failReason(e),
              detail: String(e?.message ?? e),
            });
        },
      );
  }
  /** A run whose worker was ended says nothing: the machine has cut it already. */
  function sendRun({ n, code, head }: Extract<Effect, { do: "send-run" }>, say: Reply<"send-run">) {
    const theme = S.resolvedTheme.value;
    runs.began(head, theme);
    lifecycle
      .run(n, { code, fresh_locals: head.fresh_locals, plot_theme: theme }, (text) => runs.log(text))
      .then(
        (result) => say({ type: "run-ended", result }),
        (e: ClientError) => {
          // an ending (reset, stopped, failed, failed-twice) was made by the machine, which has cut the run already; any
          // other kind (op, no-engine) is the run failing, and the machine leaves `running`
          if (!ENDINGS.has(e?.kind)) say({ type: "run-failed", message: String(e?.message ?? e) });
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
        if (handles.download?.n === effect.n) handles.download.stop.abort();
        return;
      case "fetch-list": {
        const say = reply(effect);
        builds.build().then(
          (build) => say({ type: "list-checked", build }),
          (e: ClientError) =>
            say({
              type: "list-failed",
              reason: failReason(e),
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
        handles.breakTimer = setTimeout(() => say({ type: "break-timeout" }), effect.ms);
        return;
      }
      case "cancel-break-timer":
        clearTimeout(handles.breakTimer);
        handles.breakTimer = undefined;
        return;
      case "end-run":
        return runs.ended(effect.result);
      case "engine-ready":
        // this start has its store (banners match by kind, whatever the cause); a start that has none adds it again next
        S.dismiss({ b: "store-failed", cause: "open" });
        return runs.engineReady();
      case "engine-gone":
        return runs.engineGone();
      case "show-dialog":
        S.dialog.value = { d: effect.dialog };
        return;
      case "close-dialog":
        if (S.dialog.value?.d !== effect.dialog) return;
        S.dialog.value = null;
        // the page is inert while a dialog is open: the editor takes the focus from the render that removed it
        if (effect.focusEditor) askFocus("editor", { from: fromAnywhere });
        return;
      case "add-reset-banner":
        return S.addBanner({
          b: "reset",
          reason: effect.reason,
          kind: effect.kind,
          cause: effect.cause,
          run: effect.run,
        });
      case "add-store-banner":
        return S.addBanner({ b: "store-failed", cause: effect.cause });
      case "say":
        return S.say(typeof effect.line === "string" ? SAY[effect.line] : stageNow[effect.line.stage]);
      case "warn":
        return console.warn(`[dofile] ${effect.text}`);
      default:
        return effect satisfies never;
    }
  };
}

// ---- the actions: each is one event. The machine's table says where each acts; anywhere else it does nothing. ----

/** "Download 48 MB", "Try again", and every start the visitor begins. Acts in `none`, `asking`, `declined` and
 *  `failed`. */
export function start(): void {
  dispatch({ type: "start" });
}

/** Show the engine's prompt: the download prompt in `none`, `asking` and `declined`; the take-over dialog in
 *  `other-tab-idle` (the state stays). It starts nothing. */
export function ask(): void {
  dispatch({ type: "ask" });
}

/** "Not now". Acts in `asking`, and in `downloading`, where it also aborts the download (what arrived stays cached). */
export function decline(): void {
  dispatch({ type: "decline" });
}

/** "Stop download": the fetches are aborted, and the state goes to `declined` (what arrived stays cached). */
export function stopDownload(): void {
  dispatch({ type: "stop-download" });
}

/** A new worker: the data in memory is lost, the files stay. Acts in `ready`, `running`, `breaking` and `waiting`. */
export function reset(): void {
  dispatch({ type: "reset" });
}

/** "Use dofile in this tab": take the lock from the other tab, then go on as a page load. Acts in `other-tab-idle`. */
export function takeOver(): void {
  dispatch({ type: "take-over" });
}

/** The tab lock was taken by another tab: whatever this tab was doing ends, and it is blocked. */
export function lost(): void {
  dispatch({ type: "lock-lost" });
}

/** Break: ask the run to stop. `breaking` until it stops or the grace time runs out (`resetAt`), and then a reset. A
 *  page that cannot ask (not cross-origin isolated) is reset at once. Acts in `running`. */
export function breakRun(): void {
  dispatch({ type: "break" });
}

/** "Don't reset: wait for it": the run stops after this command. Acts in `breaking`. */
export function keepWaiting(): void {
  dispatch({ type: "keep-waiting" });
}

/** Run `code` (views call run.ts, which calls this).
 *  @returns true when the engine was ready and the run began; false in any other state, and nothing happens, now or
 *  later.
 *  @throws when a step is in progress (from a handler given to connectRun), before anything is queued. */
export function run(code: string, head: RunHead): boolean {
  if (stepping)
    throw new Error(
      "run() was called while a step of the engine's state machine is in progress: call it after the step, for example when the run's promise has resolved",
    );
  return dispatch({ type: "run", code, head })?.outcome === "taken";
}

/** A read op: the page's one way to ask the engine for data. It raises no event. Rejects with the transport's error:
 *  kind "no-engine" with no worker, "reset" when a reset cut it. */
export async function call<K extends ViewOp>(op: K, args?: ReadOps[K]["args"]): Promise<ReadOps[K]["result"]> {
  return connected().reader.query(op, args);
}

/** Whether a result is the machine's own rc 9998, with no log of its own: a run cut (a reset, another tab) or, with
 *  kind "run-failed", a run whose op failed in the worker (the worker stays). */
export const fromClient = (r: RunResult) => r.rc === RC_RESET && "kind" in r;
