// The Run gate (docs/design/SPEC.md, section 3.4): Run is offered for .do and .ado tabs only. One rule decides it for the
// toolbar's Run, Run selection, the phone's Run, the reset banner's "Run the file again" and Ctrl/Cmd+Enter; the engine's
// own gate (takesRun) combines with it in canRunFile. A typed `do x.txt` is not gated: it keeps Stata's behaviour.

import type { ReadonlySignal } from "@preact/signals-core";
import { computed } from "@preact/signals-core";
import { extOf } from "../files/tree.ts";
import { takesRun } from "../states/predicates.ts";
import type { EngineState } from "../types.ts";
import { activeTab } from "./documents.ts";

/** Why Run is off on a tab that is not a .do or .ado file: the button's title and the toast of Ctrl/Cmd+Enter. */
export const NOT_RUNNABLE = "Only .do and .ado files can run";

/** The reason Run is off for the tab `path`, or null when it can run (a .do or .ado file) or there is no tab. */
export function runRefusal(path: string | null): string | null {
  if (path === null) return null;
  const ext = extOf(path);
  return ext === ".do" || ext === ".ado" ? null : NOT_RUNNABLE;
}

/** The reason Run is off for the active tab, or null. */
export const activeRunRefusal: ReadonlySignal<string | null> = computed(() => runRefusal(activeTab.value));

/** A run of the file `path` can be sent now: the engine takes a run and the path is a .do or .ado file. */
export const canRunFile = (st: EngineState, path: string | null): boolean => takesRun(st) && runRefusal(path) === null;
