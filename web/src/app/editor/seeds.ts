// What an e2e test sets up in the tabs (e2e/seed.ts calls these through the test hook), made with the documents' own
// functions: a tab always has a document, and an unsaved one has an edit.
import type { OpenTab } from "../types.ts";
import { activate, activeTab, addDta, addText, close, stateOf, tabs, update } from "./documents.ts";

/** Give the open text tab `path` an edit (a space at the end), so it is unsaved. */
function markDirty(path: string): void {
  const st = stateOf(path);
  if (st) update(path, { changes: { from: st.doc.length, insert: " " } });
}

/** Close every tab, then open `list` (a text tab with `lines` empty lines, and an edit when it is `dirty`) and make
 *  `active` the active one. */
function showTabs(list: OpenTab[], active: string | null, lines = 1): void {
  for (const t of tabs.peek()) close(t.path);
  for (const t of list) {
    if (t.kind === "dta") addDta(t.path);
    else {
      addText(t.path, "\n".repeat(Math.max(0, lines - 1)));
      if (t.dirty) markDirty(t.path);
    }
  }
  if (active !== null) activate(active);
}

/** Select the whole lines `lines` of the active text tab (null: no selection, the caret at the start). */
function selectLines(lines: [number, number] | null): void {
  const path = activeTab.peek();
  const st = path ? stateOf(path) : undefined;
  if (!path || !st) return;
  update(path, {
    selection: lines ? { anchor: st.doc.line(lines[0]).from, head: st.doc.line(lines[1]).to } : { anchor: 0 },
  });
}

export const documentSeeds = { markDirty, showTabs, selectLines };
