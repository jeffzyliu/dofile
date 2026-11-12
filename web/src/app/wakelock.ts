// Keep the screen awake while the engine is working for the visitor. On a phone, when the screen locks during the
// download (about 48 MB), the engine's start or a long run, the browser suspends the page and may discard it, and the
// work is lost. The Screen Wake Lock API (`navigator.wakeLock.request("screen")`) asks the browser not to lock the screen.
//
// The policy is one table, WAKE_LOCK: the engine's state name to whether the lock is wanted there. It is a Record over
// every state name, so a state added to the machine does not compile until it has an answer here. To widen or narrow the
// policy, change a line of it. This module only reads the `engine` signal; it decides no engine state.
//
// What the module does: it asks for the lock when the state first wants it and lets it go when the state no longer does.
// The browser lets a lock go by itself when the page is hidden (and for other reasons, such as a low battery), so it
// listens to the lock's `release` event and to `visibilitychange`, and asks again when the page is visible and the lock is
// still wanted. A request can be refused (not allowed, low battery, page hidden): then it does nothing, says nothing and
// tries again at the next change. At most one lock is held; a lock that arrives after it is no longer wanted is let go
// at once. A browser without the API: the watcher does nothing. There is no setting and no message to the visitor.
// test/wakelock.test.ts drives this with a fake `wakeLock` and a fake document.

import type { ReadonlySignal } from "@preact/signals-core";
import * as S from "./state.ts";
import type { EngineState, EngineStateName } from "./types.ts";

/** Whether the lock is wanted in each engine state: while the engine works for the visitor (the download, each stage of
 *  the start, a run and Break's waiting states), not while it is idle, absent, failed, waiting for the visitor's answer
 *  or another tab's. */
export const WAKE_LOCK: Record<EngineStateName, boolean> = {
  "checking-lock": false, // the page load, a moment: no work yet
  "checking-cache": false,
  none: false, // ?test=manual: no engine
  asking: false, // the download dialog is on, waiting for the visitor
  declined: false,
  downloading: true,
  "starting-list": true,
  "starting-worker": true,
  ready: false, // idle
  running: true,
  breaking: true, // Break is waiting for the engine to stop
  waiting: true, // Break's "keep waiting" state
  failed: false,
  "failed-twice": false,
  "other-tab-idle": false, // another tab owns the engine
  "other-tab-taking": false,
};

/** Whether the screen lock is wanted in the engine state called `name`. */
export const wantsWakeLock = (name: EngineStateName): boolean => WAKE_LOCK[name];

/** What the watcher uses of the browser's `navigator.wakeLock`. */
export type WakeLockLike = { request(type: "screen"): Promise<WakeLockSentinel> };
/** What it uses of `document`. */
export type VisibilityDocument = Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;

/** Start watching the engine's state. Returns `stop`, which lets the lock go and removes the listeners. */
export function watchWakeLock({
  wakeLock = globalThis.navigator?.wakeLock,
  doc = globalThis.document,
  engine = S.engine,
}: {
  wakeLock?: WakeLockLike | null;
  doc?: VisibilityDocument | null;
  engine?: ReadonlySignal<EngineState>;
} = {}): { stop: () => void } {
  if (!wakeLock || !doc) return { stop: () => {} };
  let held: WakeLockSentinel | null = null;
  let pending = false; // a request is in flight
  let stopped = false;
  const wanted = () => !stopped && wantsWakeLock(engine.value.s);

  const drop = (sentinel: WakeLockSentinel) => {
    sentinel.release().catch(() => {}); // already released: nothing to do
  };
  const sync = () => {
    if (!wanted()) {
      if (held) {
        const sentinel = held;
        held = null; // before release(), so the sentinel's own `release` event finds it gone
        drop(sentinel);
      }
      return; // a request still in flight is let go when it arrives
    }
    if (held || pending || doc.visibilityState !== "visible") return;
    pending = true;
    wakeLock.request("screen").then(
      (sentinel) => {
        pending = false;
        if (!wanted() || held) return drop(sentinel); // too late, or already one
        held = sentinel;
        sentinel.addEventListener("release", () => {
          if (held !== sentinel) return; // let go by us
          held = null;
          sync(); // the browser took it: ask again if the page is visible and it is still wanted
        });
      },
      () => {
        pending = false; // refused: nothing to say; the next change tries again
      },
    );
  };

  doc.addEventListener("visibilitychange", sync);
  const unsubscribe = engine.subscribe(sync); // calls back at once with the current state, then after each change
  return {
    stop: () => {
      stopped = true;
      unsubscribe();
      doc.removeEventListener("visibilitychange", sync);
      sync(); // not wanted now: lets the lock go
    },
  };
}
