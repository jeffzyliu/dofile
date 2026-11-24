// The Log head's "Find": a field over the log. Each match of its text (case ignored) is marked; Enter goes to the next
// one, Shift+Enter to the one before, and the field says "2 of 5". It searches what the log shows (the head, run-heads
// and the page's notes too), one line at a time. The state is signals, since the Log pane may be drawn again when the
// layout changes.
import { signal } from "@preact/signals-core";

import { isPhone, outputTab, split } from "../state/layout.ts";

import { ask, fromAnywhere } from "../ui/focus-targets.ts";

export const findOpen = signal(false);
export const findText = signal("");
/** The current match, counted from 0 in the order the log shows them. */
export const findAt = signal(0);
export let findReturn: HTMLElement | null = null;
/** Open Find: the field takes the focus; Esc and Close give it back to `from` (the phone's ⋯ passes none: the focus is
 *  then on the ⋯ button, which the menu gave it back to). On the desktop with the Output pane unsplit and another tab
 *  showing, the Log tab is shown first, so the field can be seen. */
export function openFind(from: HTMLElement | null) {
  findReturn = from ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  if (!isPhone.value && !split.value && outputTab.value !== "log") outputTab.value = "log";
  findOpen.value = true;
  ask("find-field", { from: fromAnywhere }); // the field takes it when drawn, once per openFind
}

/** Where `query` occurs in `line`, case ignored: [from, to) pairs, none for an empty query. */
export function matches(line: string, query: string): [number, number][] {
  if (!query) return [];
  const out: [number, number][] = [];
  const hay = line.toLowerCase();
  const needle = query.toLowerCase();
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length))
    out.push([i, i + needle.length]);
  return out;
}
