// The file tree's view state: what is folded, the row in the tab order, the current folder, and the focus request the rows
// take (docs/web-page-flows.md, section 1). Plain TypeScript (no JSX), so the Node tests run it.
import { signal } from "@preact/signals-core";
import { files } from "../state.ts";
import { folderOrAbove, parentOf, within } from "./tree.ts";

export const folded = signal<ReadonlySet<string>>(new Set());
export const rovingPath = signal<string | null>(null); // the row in the tab order, once one was focused
// the current folder ("" is the top): where the "+", New .do file and New folder make their file
export const currentDir = signal("");
// the focus request (docs/web-page-flows.md, section 1): the row of `path` takes it once drawn; with no path, the row
// in the tab order. `anywhere`: also from outside the tree
export const focusWanted = signal<{ path: string | null; anywhere?: boolean } | null>(null); // the test hook reads it
let treeList: HTMLUListElement | null = null; // the tree, drawn while it has rows
export const setTree = (el: HTMLUListElement | null) => {
  treeList = el;
};

/** Whether the tree is on screen with its rows (not folded away, not on another phone view, not empty). */
export const treeShown = () => (treeList?.getClientRects().length ?? 0) > 0;

/** Make `path` the row in the tab order and have it take the focus when it is drawn (at once for a row on screen; after
 *  a rename, once the store has been listed again), unless the focus has gone out of the tree by then (TreeRow). */
export function focusRow(path: string) {
  rovingPath.value = path;
  focusWanted.value = { path };
}

/** Have the tree's row in the tab order take the focus when it is drawn. */
export function focusTree(anywhere = false) {
  focusWanted.value = { path: null, anywhere };
}

/** A visitor focused or clicked the row `path`: it is the roving one, and a request for another row ends there. */
export function rove(path: string) {
  rovingPath.value = path;
  if (focusWanted.value && focusWanted.value.path !== path) focusWanted.value = null;
}

/** Fold or unfold a folder (`open`: unfold, else swap). Folding the current folder, or one above it, makes the folded
 *  folder's parent current. */
export function toggle(path: string, open?: boolean) {
  const next = new Set(folded.value);
  if (open ?? next.has(path)) next.delete(path);
  else {
    next.add(path);
    if (within(currentDir.value, path)) currentDir.value = parentOf(path);
  }
  folded.value = next;
}

/** Unfold `dir` and every folder above it, so a row inside it is drawn. */
export function unfold(dir: string) {
  const next = new Set(folded.value);
  for (let p = dir; p; p = parentOf(p)) next.delete(p);
  folded.value = next;
}

/** The folder the "+" makes a file in (docs/web-page-flows.md, section 1): the current folder, or the nearest one above
 *  it that exists (the current folder may have been deleted); else the top. */
export const newFileDir = () => folderOrAbove(currentDir.value, files.value);
