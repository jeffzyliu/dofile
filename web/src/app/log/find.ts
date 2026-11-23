// The Log head's "Find": a field over the log. Each match of its text (case ignored) is marked; Enter goes to the next
// one, Shift+Enter to the one before, and the field says "2 of 5". It searches what the log shows (the head, run-heads
// and the page's notes too), one line at a time. The state is signals, since the Log pane may be drawn again when the
// layout changes.
import { signal } from "@preact/signals-core";

export const findOpen = signal(false);
export const findText = signal("");
/** The current match, counted from 0 in the order the log shows them. */
export const findAt = signal(0);

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
