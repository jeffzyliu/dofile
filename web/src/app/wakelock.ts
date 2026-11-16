// Keeps the screen awake while the engine works for the visitor: on a phone, a locked screen during the download, the
// start or a long run suspends the page, and the browser may discard it. Uses the Screen Wake Lock API; a browser
// without it gets no lock and no message. test/wakelock.test.ts drives this with a fake `wakeLock` and document.

import type { ReadonlySignal } from "@preact/signals-core";
import * as S from "./state.ts";
import type { EngineState, EngineStateName } from "./types.ts";

/** Whether the lock is wanted in each engine state: while the engine works for the visitor, not while it is idle,
 *  absent, failed, or waiting for an answer. A Record, so a state added to the machine needs an answer here. */
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

/** Ask for the lock when the engine state first wants it and let it go when it no longer does. The browser also
 *  releases it by itself (page hidden, low battery), so this asks again on `release` and `visibilitychange` while it is
 *  still wanted. A refused request is silent and tried again at the next change. At most one lock is held.
 *  @returns `stop`, which lets the lock go and removes the listeners. */
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
