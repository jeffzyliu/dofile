// The Log head's "Find" (OQ-16 left its behavior open; step 4b's choice): a field over the log, "Find in the log". Each
// match of its text (case ignored) is marked; Enter goes to the next one, Shift+Enter to the one before, and the field
// says "2 of 5". Esc closes it and gives the focus back to what opened it. It searches what the log shows of the runs
// (the head, run-heads and the page's notes too), one line at a time. The view's state, as signals, since the Log pane
// may be drawn again when the layout changes. Plain TypeScript: tested in Node (test/editor.test.ts).
import { signal } from "@preact/signals-core";

export const findOpen = signal(false);
export const findText = signal("");
/** The current match, counted from 0 in the order the log shows them. */
export const findAt = signal(0);

/** Where `query` occurs in `line`, case ignored: [from, to) pairs, none for an empty query. */
export function matches(line: string, query: string): [number, number][] {
  if (!query) return [];
  const out: [number, number][] = [];
  const hay = line.toLowerCase(),
    needle = query.toLowerCase();
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length))
    out.push([i, i + needle.length]);
  return out;
}
