// The Output tabs' own state: signals that live as long as the page, so a tab unmounted and mounted again when the
// layout changes (a phone turned, a window resized) comes back as it was. The shared signals are in state/.

import type { ReadonlySignal } from "@preact/signals-core";
import { signal } from "@preact/signals-core";
import type { Macros, Matrix, Results } from "../../engine/types.ts";

/** The variable the Data tab picked: it scrolls Browse to its column and marks it; null: none. */
const picked = signal<string | null>(null);
export const pickedVar: ReadonlySignal<string | null> = picked;
export function pickVar(name: string | null) {
  picked.value = name;
}
/** The Data tab's "Filter variables" text. */
export const filterText = signal("");
/** The Data tab's variable name that has the focus (the one in the tab order; arrows move it). */
export const focusVar = signal<string | null>(null);
/** The Browse cells shown whole, by "observation:variable". */
export const openCells = signal<ReadonlySet<string>>(new Set());
/** "Show 50 more" is on its way: the button waits. */
export const loadingRows = signal(false);

/** The Results tab's groups the visitor folded or unfolded, by group id; a group not here has its own default. */
export const folds = signal<Readonly<Record<string, boolean>>>({});
/** The row just copied, by row key, and the results and macros it was copied from: its copy icon is a check for a
 *  while (matrix.ts, COPIED_MS), and not on a newer run's row of the same name. */
export const copiedRow = signal<{ key: string; for: Results | null; macros: Macros | null } | null>(null);

/** A matrix opened in place. It belongs to the `results` it was read for: after another run it is no longer shown (its
 *  values could be another model's), and View reads it again. */
export type OpenMatrix =
  | { for: Results; status: "loading" }
  | { for: Results; status: "ready"; matrix: Exclude<Matrix, { error: string }> }
  | { for: Results; status: "error"; message: string };
export const openMatrices = signal<Readonly<Record<string, OpenMatrix>>>({});

/** A .dta tab's variables as describe_file answered, by path, for the file as it was when asked (`key`: size and
 *  time). */
export interface DtaVariable {
  name: string;
  label: string | null;
  type: string;
  format: string;
}
export interface DtaInfo {
  key: string;
  result: { nobs: number; nvars: number; variables: DtaVariable[] } | { error: string };
}
export const dtaInfo = signal<Readonly<Record<string, DtaInfo>>>({});
