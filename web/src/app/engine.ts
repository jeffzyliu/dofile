// The engine controller: the one wrapper around EngineClient (client.js). It owns the `engine` signal and builds the
// states of docs/design/SPEC.md, section 5, from what the client reports: onStatus (the start-up stages), onRestart
// (a reset), resetAt (Break's deadline), a download() rejection (an AbortError means "Stop download") and a start()
// rejection ("failed", or "failed-twice"). It decides from an error's `kind`, `reason` and `name`, never its text. At load
// it starts without asking when the client's cached() says this build's start files are all in the Cache, and asks
// otherwise; a start that fails twice (not for memory or WebAssembly) deletes them (forgetDownload()), so a reload downloads
// them fresh. It also owns `about` and the reset banner. What a run leaves (results, data, memory, ...) is run.js's: it clears them on a new engine.
//
// The page's order at load (main.tsx): the tab lock, then keepFiles(), then the store, then download() and start():
//   connectEngine({ client, store, lock, snapshot, manual });  const lock = tabLock({ onLost: lost });  open();
// Views call the actions below; they never call the client themselves, except through run.js.
import { RC_RESET } from "../engine/client.ts";
import * as S from "./state.ts";
import { keep, refresh } from "./files.ts";
import { editorCommands } from "./editor/commands.ts";
import type { EngineClient } from "../engine/client.ts";
import type { About, ClientError, OpResults, ResetKind, RunResult, StatusText } from "../engine/types.ts";
import type { EngineStateName, FailReason, RunHead, Stage } from "./types.ts";

export const STAGE_OF: Record<StatusText, Stage> = {
  "downloading the engine": "download", "unpacking the engine": "unpack", "loading Python": "python",
  "loading your files": "files", "loading packages": "packages", "starting the engine": "engine",
};
/** The stages a start goes through, in order (OQ-11): the snapshot start, or ?snapshot=0. */
export const stagesOf = (snapshot: boolean): Stage[] => (snapshot
  ? ["download", "unpack", "python", "files", "engine"] : ["download", "python", "files", "packages", "engine"]);

/** The message of a start that failed with reason "updated". 4d's "Reload the page" keys on the reason, not on these words. */
export const UPDATED = "dofile has a newer version on this site: reload the page to use it";

/** What a failed start tells the visitor (`message`), by reason: what happened and what they can do, in plain words. The
 *  developer's cause (a file name, a byte count, `npm run snapshot`) is `detail`, and goes to the console. */
export const FAILED: Record<FailReason, string> = ({
  "no-wasm": "This browser can't run the engine: it has no WebAssembly support. Try another browser.",
  download: "The engine didn't download completely. Check your connection, then try again.",
  memory: "There wasn't enough memory to start the engine. Close other tabs, then try again.",
  updated: UPDATED,
  unknown: "Something went wrong while starting the engine. Try again, or reload the page.",
});
/** The message of `failed-twice`, whatever the reason: it is not started again, so only a reload helps. */
export const FAILED_TWICE = "The engine failed twice while starting, so it won't try again by itself. Reload the page to try again.";

let deps: { client: EngineClient, store: { blocked: boolean }, lock: { take(o?: { steal?: boolean }): Promise<unknown> },
  snapshot: boolean, manual: boolean, storage?: any };
let downloading: AbortController | null = null;   // the download in progress: "Stop download" aborts it
let stageAt = 0;          // when the current start-up stage began (Date.now())
// Each start() and each reset takes the next number; ready() and failed() act only for the latest. A reset during a start
// answers both the start() and the reset's `started` with the new worker's start (client.js), which would else count twice.
let attempt = 0;
let hadEngine = false;    // the engine now in use was ready once: a reset then loses its data (the banner, "Engine reset")
let taking: Promise<void> | null = null;        // takeOver() in progress: a second press waits for it, never steals the lock twice
// Counts the times this tab lost the tab lock (otherTab()). owned() and takeOver() read it before each await and stop if
// it changed meanwhile: a tab that has just lost the lock must not unblock the store, close the dialog or start a worker.
let lockGen = 0;

/** Wire the controller to the page's client, store and tab lock. `snapshot`: the snapshot start (not ?snapshot=0).
 *  `manual`: ?test=manual, no start until the test calls start(). `storage`: navigator.storage (the tests give theirs). */
export function connectEngine(d: typeof deps) {
  deps = d;
  d.client.onStatus = onStatus;
  d.client.onRestart = onRestart;
  downloading = null;
  attempt++;
  hadEngine = false;
  taking = null;
}

// ---- the page load and the tab lock ----

/** The page load: take the tab lock; without it, the take-over dialog. With it: keep the files, list them, and start
 *  the engine (asking first unless the start files are all cached). Resolves when the engine's start has begun, not when it is ready. */
export async function open() {
  if (!(await deps.lock.take())) return otherTab();
  await owned();
}

async function owned() {
  const gen = lockGen;
  deps.store.blocked = false;   // app/store.js opens it blocked: nothing is written before the lock answers
  keep(deps.storage);   // storage.persist(), once; persisted() goes into the `persisted` signal
  await refresh();
  if (gen !== lockGen) return;   // the lock was lost meanwhile: otherTab() has blocked the tab again
  S.engine.value = { s: "none" };
  if (deps.manual) return;
  const cached = await deps.client.cached();   // this build's start files are all in the Cache: no need to ask
  if (gen !== lockGen) return;
  if (cached) start(); else ask(false);
}

function otherTab() {
  lockGen++;
  deps.store.blocked = true;
  downloading?.abort();
  downloading = null;
  attempt++;          // a start in progress ends with kind "stopped"; nothing it answers counts
  hadEngine = false;
  S.about.value = null;
  S.engine.value = { s: "other-tab" };   // run.js clears what the old engine left (results, data, memory, ...)
  S.dialog.value = { d: "other-tab" };
}

/** The tab lock was taken by another tab: end the worker and block this tab (tabLock's onLost). */
export function lost() {
  deps.client.stop("another tab took over");
  otherTab();
}

/** "Use dofile in this tab": take the lock from the other tab, then go on as a page load. Only from `other-tab`; a second
 *  press while it runs gets the same promise (a second steal from this tab would make the tab lose its own lock). */
export function takeOver() {
  if (taking) return taking;
  if (S.engine.value.s !== "other-tab") return Promise.resolve();
  taking = (async () => {
    try {
      const gen = lockGen;
      await deps.lock.take({ steal: true });
      if (gen !== lockGen) return;   // the other tab took the lock back meanwhile: the dialog stays, and a press acts again
      S.dialog.value = null;
      await owned();
    } finally {
      taking = null;
    }
  })();
  return taking;
}

// ---- the download prompt and the start ----

/** Show the download prompt (`asking`). forRun: Run or the command line asked for it ("Download the engine to run code"). */
export function ask(forRun: boolean) {
  S.engine.value = { s: "asking", forRun };
  S.dialog.value = { d: "download", forRun };
}

/** "Not now". During `downloading` it also aborts the download (what arrived stays in the cache). */
export function decline() {
  downloading?.abort();
  S.engine.value = { s: "declined" };
  if (S.dialog.value?.d === "download") S.dialog.value = null;
}

/** "Stop download": the fetches are aborted, and the state goes to `declined` (what arrived stays in the cache). */
export function stopDownload() { downloading?.abort(); }

/** States start() starts from: no engine, or one that did not start ("Try again"). Not `failed-twice` (reload the page). */
const STARTABLE = new Set(["none", "asking", "declined", "failed"]);

/** "Download 48 MB", "Try again", and every start the page makes: download() fills the cache, then start(). A download
 *  that fails other than by "Stop download" goes on to start(), which reads what is cached (offline, say) or fails
 *  itself; one that finds the site updated (kind "updated") is `failed` with reason "updated" at once. In any other
 *  state (a start or a run in progress, `failed-twice`, `other-tab`) it does nothing. */
export async function start() {
  if (!STARTABLE.has(S.engine.value.s)) return;
  downloading?.abort();
  const ac = downloading = new AbortController();
  hadEngine = false;
  const t0 = Date.now();
  S.engine.value = { s: "downloading", received: 0, total: S.engineBytes ?? 0, t0 };
  try {
    await deps.client.download({ signal: ac.signal, onProgress: ({ received, total }) => {
      if (downloading === ac) S.engine.value = { s: "downloading", received, total, t0 };
    } });
  } catch (e) {
    if (downloading !== ac) return;   // the tab lost the lock meanwhile
    const err = (e as ClientError);
    if (err?.name === "AbortError") {
      downloading = null;
      decline();
      S.say("Download stopped");
      return;
    }
    if (err?.kind === "updated") {   // the page is older than the site: no start can work, only a reload
      downloading = null;
      attempt++;
      failed(err);
      return;
    }
    console.warn(`[dofile] download: ${err?.message ?? e}`);
  }
  if (downloading !== ac) return;
  downloading = null;
  starting({ download: (Date.now() - t0) / 1000 });
  const my = ++attempt;
  await deps.client.start().then(a => { if (my === attempt) ready(a); }, e => { if (my === attempt) failed(e); });
}

// `starting`, at its first stage: the snapshot start reads the cache first ("download"), ?snapshot=0 starts Python.
// `announce`: say the stage. Not after a reset: there the first stage reads the cache, and "Download the engine" would mislead.
function starting(done: Partial<Record<Stage, number>> = {}, announce = true) {
  stageAt = Date.now();
  const stage = deps.snapshot ? "download" : "python";
  S.engine.value = { s: "starting", stage, t0: stageAt, done };
  if (announce) S.say(stageWords[stage]);
}

/** What the live region says at each stage (S 2's stage list). */
export const stageWords: Record<Stage, string> = ({
  download: "Download the engine", unpack: "Unpack the engine", python: "Start Python", files: "Load your files",
  packages: "Load packages", engine: "Start the engine",
});

function onStatus(text: StatusText) {
  const st = S.engine.value, stage = STAGE_OF[text];
  if (st.s !== "starting" || !stage || stage === st.stage) return;
  const now = Date.now();
  // a stage seen twice (the snapshot start reads the cache after download() filled it) adds up its time
  const done = { ...st.done, [st.stage]: (st.done[st.stage] ?? 0) + (now - stageAt) / 1000 };
  stageAt = now;
  S.engine.value = { s: "starting", stage, t0: now, done };
  S.say(stageWords[stage]);
}

function ready(a: About) {
  S.about.value = a;
  hadEngine = true;
  S.engine.value = { s: "ready" };   // run.js then asks for `memory`
  if (S.dialog.value?.d === "download") {   // the dialog closes by itself, and focus goes to the editor
    S.dialog.value = null;
    setTimeout(() => editorCommands.focus(), 0);   // once the dialog is gone: the page is inert while it is open
  }
  S.say("Engine ready");
}

/** Why a start failed, from the error's kind, reason and name. */
const reasonOf = (e: ClientError): FailReason => (e?.kind === "updated" || e?.name === "UpdatedError" ? "updated" : e?.reason ?? "unknown");

function failed(e: ClientError) {
  if (e?.kind === "stopped") return;   // another tab took over, or a second start: that one says what happens
  const detail = String(e?.message ?? e), reason = reasonOf(e), twice = e?.kind === "failed-twice";
  console.warn(`[dofile] the engine didn't start (${reason}): ${detail}`);
  // the start files may be at fault (not for memory or WebAssembly): a reload downloads them fresh
  if (twice && reason !== "memory" && reason !== "no-wasm") deps.client.forgetDownload();
  S.engine.value = twice ? { s: "failed-twice", reason, message: FAILED_TWICE, detail }
    : { s: "failed", reason, message: FAILED[reason] ?? FAILED.unknown, detail };
  if (S.dialog.value?.d === "download") S.dialog.value = null;
  S.say(S.engine.value.s === "failed-twice" ? "The engine stopped after failing twice" : "The engine didn't start");
}

/** A reset (rc 9998): Break ran out of time, the worker crashed, Reset, "Reset now". Called by the client before the cut
 *  run's promise resolves, so run.js finds `starting` and leaves the state alone. The banner and "Engine reset" only when
 *  the engine being replaced had been ready: a crash during a start loses nothing. */
function onRestart(reason: string, started: Promise<About>, kind: ResetKind) {
  if (hadEngine) {
    S.addBanner({ b: "reset", reason, kind });
    S.say("Engine reset");
  }
  hadEngine = false;
  starting({}, false);   // run.js clears results, macros, data, rows, memory and lastRun on `starting`
  const my = ++attempt;
  started.then(a => { if (my === attempt) ready(a); }, e => { if (my === attempt) failed(e); });
}

// ---- runs and Break (run.js calls run(); the toolbar calls the rest) ----

/** Run `code` (the engine must be `ready`): `running` until the result, then `ready`, unless a reset came first. */
export async function run(code: string, head: RunHead, { onLog }: { onLog?: (text: string) => void } = {}): Promise<RunResult> {
  S.engine.value = { s: "running", run: head, t0: Date.now() };
  const r = await deps.client.run(code, { onLog, fresh_locals: head.fresh_locals, plot_theme: S.resolvedTheme.value });
  const s = (S.engine.value.s as EngineStateName);   // a reset may have come meanwhile
  if (s === "running" || s === "breaking" || s === "waiting") S.engine.value = { s: "ready" };
  return r;
}

/** Break: ask the run to stop. `breaking` until it stops or the client resets it (resetAt). A page that is not
 *  cross-origin isolated resets at once (the client restarts; onRestart sets `starting`). */
export function breakRun() {
  const st = S.engine.value;
  if (st.s !== "running") return;
  deps.client.breakRun();
  const resetAt = deps.client.resetAt;
  if (resetAt !== null && S.engine.value.s === "running") S.engine.value = { s: "breaking", run: st.run, t0: st.t0, resetAt };
}

/** "Don't reset: wait for it": the Break stays asked; the run stops after this command. */
export function keepWaiting() {
  const st = S.engine.value;
  if (st.s !== "breaking") return;
  deps.client.keepWaiting();
  S.engine.value = { s: "waiting", run: st.run, t0: st.t0 };
}

/** The states reset() acts in: an engine that is up. Not while one starts (`downloading`, `starting`: the start would end
 *  the new worker), and never in `failed-twice` (it must stay stopped), `failed`, `other-tab` or with no engine. */
const RESETTABLE = new Set(["ready", "running", "breaking", "waiting"]);

/** Reset (confirmed in its dialog) and "Reset now": a new worker; the data in memory is lost, the files stay. Only in
 *  `ready`, `running`, `breaking` and `waiting`; in any other state it does nothing. */
export function reset() {
  if (!RESETTABLE.has(S.engine.value.s)) return Promise.resolve();
  return deps.client.restart("reset by you", "user").catch(() => {});   // onRestart and failed() report it
}

/** An engine op other than run (describe, browse, matrix, macros, memory, describe_file): the views' way to ask the
 *  engine (step 4c). Rejects with the client's error (kind "no-engine" with no worker, "reset" when a reset cut it). */
export function call<K extends keyof OpResults>(op: K, args?: object): Promise<OpResults[K]> { return deps.client.call(op, args); }

/** Whether a result is the client's own rc 9998, with no log of its own: a run cut (a reset, another tab, no engine) or,
 *  with kind "run-failed", a run whose op failed in the worker (the worker stays). */
export const fromClient = (r: RunResult) => r.rc === RC_RESET && "kind" in r;
