// The folded file list (700 to 1199 px): whether it is open, the Files button that opens it, and the moves of the focus
// when it opens and folds. No DOM of its own: the button is held as the two calls the moves make on it, so a Node test
// runs the moves with a stand-in for it.

import { signal } from "@preact/signals-core";
import { focusTree } from "./tree-state.ts";

/** The Files button, as far as the moves need it. A button with no client rects is not drawn (the list is not folded:
 *  it is always shown on a wider screen, and a view of its own on a phone). */
interface FoldToggle {
  focus(): void;
  getClientRects(): { length: number };
}

/** Whether the folded file list is shown. */
export const filesOpen = signal(false);
let filesToggle: FoldToggle | null = null;

/** The Files button's ref: it is held here, next to the moves that focus it. */
export function holdFilesToggle(el: FoldToggle | null) {
  filesToggle = el;
}

/** Opening focuses the list (from anywhere, so it takes the focus the button had); folding gives it back to the button.
 *  Both happen in the handler, not in a later render. */
export function foldFiles(open: boolean) {
  filesOpen.value = open;
  if (!open) filesToggle?.focus();
  else focusTree(true);
}

/** Esc in the unfolded file list folds it, unless a handler in the list already used that Esc (preventDefault). It does
 *  nothing where the list is not folded: there the Files button is not drawn. */
export function onFilesKey(e: Pick<KeyboardEvent, "key" | "defaultPrevented" | "preventDefault">) {
  if (e.key !== "Escape" || e.defaultPrevented || !filesOpen.value || !filesToggle?.getClientRects().length) return;
  e.preventDefault();
  foldFiles(false);
}
