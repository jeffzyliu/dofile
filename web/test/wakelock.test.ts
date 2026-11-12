// The screen wake lock (src/app/wakelock.ts) with a fake `wakeLock` and a fake document, as test/app.test.ts does for the
// phone keyboard. No browser: the sentinels, the visibility and the engine state are all driven here.
import assert from "node:assert/strict";
import test from "node:test";
import { signal } from "@preact/signals-core";
import type { EngineState, EngineStateName } from "../src/app/types.ts";
import { WAKE_LOCK, wantsWakeLock, watchWakeLock } from "../src/app/wakelock.ts";

/** Every engine state name. A name missing here does not compile (the check below), and the table must have the same. */
const NAMES = [
  "checking-lock",
  "checking-cache",
  "none",
  "asking",
  "declined",
  "downloading",
  "starting-list",
  "starting-worker",
  "ready",
  "running",
  "breaking",
  "waiting",
  "failed",
  "failed-twice",
  "other-tab-idle",
  "other-tab-taking",
] as const satisfies readonly EngineStateName[];
export type NamesChecked = [EngineStateName] extends [(typeof NAMES)[number]] ? true : never;
const _checked: NamesChecked = true;
void _checked;

const WORKING = new Set<EngineStateName>([
  "downloading",
  "starting-list",
  "starting-worker",
  "running",
  "breaking",
  "waiting",
]);

test("the policy: the lock is wanted while the engine works for the visitor, in no other state, and the table has every name", () => {
  assert.deepEqual(Object.keys(WAKE_LOCK).sort(), [...NAMES].sort());
  for (const name of NAMES) assert.equal(wantsWakeLock(name), WORKING.has(name), name);
});

class Sentinel extends EventTarget {
  released = false;
  async release() {
    if (this.released) return;
    this.released = true;
    this.dispatchEvent(new Event("release"));
  }
}

/** A wakeLock whose requests wait for the test: `grant()` answers the oldest, `refuse()` rejects it. */
function fakeWakeLock() {
  const waiting: { resolve: (s: Sentinel) => void; reject: (e: Error) => void }[] = [];
  const made: Sentinel[] = [];
  let calls = 0;
  return {
    wakeLock: {
      request: (type: "screen") => {
        assert.equal(type, "screen");
        calls++;
        return new Promise<WakeLockSentinel>((resolve, reject) =>
          waiting.push({
            resolve: (s) => resolve(s as unknown as WakeLockSentinel),
            reject,
          }),
        );
      },
    },
    get calls() {
      return calls;
    },
    made,
    get held() {
      return made.filter((s) => !s.released).length;
    },
    grant() {
      const s = new Sentinel();
      made.push(s);
      waiting.shift()?.resolve(s);
      return s;
    },
    refuse() {
      waiting.shift()?.reject(new Error("NotAllowedError"));
    },
  };
}

function fakeDocument() {
  const target = new EventTarget();
  const doc = {
    visibilityState: "visible" as DocumentVisibilityState,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
  };
  return {
    doc: doc as unknown as Document,
    show: (visible: boolean) => {
      doc.visibilityState = visible ? "visible" : "hidden";
      target.dispatchEvent(new Event("visibilitychange"));
    },
  };
}

const at = (s: EngineStateName) => ({ s }) as EngineState;
const settle = () => new Promise((r) => setTimeout(r));

function setup(start: EngineStateName = "ready") {
  const engine = signal<EngineState>(at(start));
  const lock = fakeWakeLock();
  const page = fakeDocument();
  const watcher = watchWakeLock({ wakeLock: lock.wakeLock, doc: page.doc, engine });
  return { engine, lock, page, watcher, go: (s: EngineStateName) => (engine.value = at(s)) };
}

test("a run takes the lock and its end lets it go; an idle engine asks for none", async () => {
  const { lock, go } = setup();
  assert.equal(lock.calls, 0, "ready: nothing asked");
  go("running");
  assert.equal(lock.calls, 1);
  lock.grant();
  await settle();
  assert.equal(lock.held, 1);
  go("breaking");
  go("waiting");
  assert.equal(lock.calls, 1, "Break's states keep the one lock");
  assert.equal(lock.held, 1);
  go("ready");
  assert.equal(lock.held, 0);
  go("running");
  lock.grant();
  await settle();
  assert.equal(lock.calls, 2);
  assert.equal(lock.held, 1);
});

test("a page that starts in a working state asks at once", async () => {
  const { lock } = setup("downloading");
  assert.equal(lock.calls, 1);
  lock.grant();
  await settle();
  assert.equal(lock.held, 1);
});

test("hidden then shown: the browser's release is answered by a new request when the page is visible and the lock still wanted", async () => {
  const { lock, page, go } = setup("ready");
  go("running");
  const first = lock.grant();
  await settle();
  // the browser lets the lock go as the page is hidden
  page.show(false);
  await first.release();
  assert.equal(lock.calls, 1, "hidden: no new request");
  assert.equal(lock.held, 0);
  page.show(true);
  assert.equal(lock.calls, 2);
  lock.grant();
  await settle();
  assert.equal(lock.held, 1);
  // shown again with the lock still held: no second one
  page.show(true);
  assert.equal(lock.calls, 2);
  // hidden and shown after the run ended: nothing wanted, nothing asked
  go("ready");
  page.show(false);
  page.show(true);
  assert.equal(lock.calls, 2);
});

test("a state that wants the lock while the page is hidden asks when the page is shown", async () => {
  const { lock, page, go } = setup("ready");
  page.show(false);
  go("running");
  assert.equal(lock.calls, 0);
  page.show(true);
  assert.equal(lock.calls, 1);
});

test("a refused request is silent, and a later change of state still works", async () => {
  const { lock, go } = setup("ready");
  go("running");
  lock.refuse();
  await settle(); // an unhandled rejection would fail the test
  assert.equal(lock.held, 0);
  go("ready");
  go("running");
  assert.equal(lock.calls, 2);
  lock.grant();
  await settle();
  assert.equal(lock.held, 1);
});

test("a request still pending when the run ends is let go when it arrives; one that is wanted again meanwhile is kept, and there are never two", async () => {
  const { lock, go } = setup("ready");
  go("running");
  go("ready");
  const late = lock.grant();
  await settle();
  assert.equal(late.released, true);
  assert.equal(lock.held, 0);
  // wanted, not wanted, wanted again before the answer: one request, one lock
  go("running");
  go("ready");
  go("running");
  assert.equal(lock.calls, 2, "the pending request is reused");
  const kept = lock.grant();
  await settle();
  assert.equal(kept.released, false);
  assert.equal(lock.held, 1);
});

test("no wakeLock in the browser: the watcher does nothing", () => {
  const engine = signal<EngineState>(at("running"));
  const page = fakeDocument();
  const { stop } = watchWakeLock({ wakeLock: null, doc: page.doc, engine });
  engine.value = at("ready");
  page.show(false);
  stop();
  const none = watchWakeLock({ wakeLock: undefined, doc: null, engine });
  none.stop();
});

test("stop() lets the lock go, takes the listeners off, and later changes ask for nothing", async () => {
  const { lock, page, watcher, go } = setup("ready");
  go("running");
  lock.grant();
  await settle();
  assert.equal(lock.held, 1);
  watcher.stop();
  assert.equal(lock.held, 0);
  go("ready");
  go("running");
  page.show(false);
  page.show(true);
  assert.equal(lock.calls, 1);
  // a request in flight at stop() is let go on arrival
  const b = setup("running");
  b.watcher.stop();
  const late = b.lock.grant();
  await settle();
  assert.equal(late.released, true);
});
