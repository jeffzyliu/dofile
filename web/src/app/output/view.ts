// The Output tabs' own state: signals that live as long as the page, so a tab that is unmounted and mounted again when
// the layout changes (a phone turned, a window resized) comes back as it was. The shared signals (graphs, rows,
// pickedVar ...) are in state.ts; these are only the 4c views'. No other part reads or writes them.

import { signal } from "@preact/signals-core";
import type { Matrix, Results } from "../../engine/types.ts";

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
/** The row just copied, by row key: its action cell says "✓ Copied" for a while (ResultsTab.tsx, COPIED_MS). */
export const copiedRow = signal<string | null>(null);

/** A matrix opened in place. It belongs to the `results` it was read for: after another run it is no longer shown (its
 *  values could be another model's), and View reads it again. */
export type OpenMatrix =
  | { for: Results; status: "loading" }
  | { for: Results; status: "ready"; matrix: Exclude<Matrix, { error: string }> }
  | { for: Results; status: "error"; message: string };
export const openMatrices = signal<Readonly<Record<string, OpenMatrix>>>({});

/** A .dta tab's variables as describe_file answered, by path, for the file as it was when asked (`key`: size and time). */
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

/** What opened the full-size view, for the focus to return to: Safari does not focus a button when it is pressed, so the
 *  active element is not enough. The Graph tab's "Open full size" sets it; the view takes it and clears it. */
export const fullOpener: { el: HTMLElement | null } = { el: null };
