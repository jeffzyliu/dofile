// The folded file list (700 to 1199 px): whether it is open, and the moves of the focus when it opens and folds. No DOM of
// its own: the Files button is the registry's `files-toggle` target (App.tsx), so a Node test runs the moves with a
// stand-in for it.

import { signal } from "@preact/signals-core";
import { focusNow, shownElement } from "../ui/focus-targets.ts";
import { focusTree } from "./tree-state.ts";

/** Whether the folded file list is shown. */
export const filesOpen = signal(false);

/** Opening focuses the list (from anywhere, so it takes the focus the button had); folding gives it back to the button,
 *  which is not drawn (so not focused) where the list is not folded: it is always shown on a wider screen, and a view of
 *  its own on a phone. Both happen in the handler, not in a later render. */
export function foldFiles(open: boolean) {
  filesOpen.value = open;
  if (!open) focusNow("files-toggle");
  else focusTree(true);
}

/** Esc in the unfolded file list folds it, unless a handler in the list already used that Esc (preventDefault). It does
 *  nothing where the list is not folded: there the Files button is not drawn. */
export function onFilesKey(e: Pick<KeyboardEvent, "key" | "defaultPrevented" | "preventDefault">) {
  if (e.key !== "Escape" || e.defaultPrevented || !filesOpen.value || !shownElement("files-toggle")) return;
  e.preventDefault();
  foldFiles(false);
}
