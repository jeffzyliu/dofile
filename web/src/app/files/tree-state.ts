// The file tree's view state: what is folded, the row in the tab order, the current folder, and the focus request the rows
// take (docs/web-page-flows.md, section 1). Plain TypeScript (no JSX), so the Node tests run it.
import { computed, signal } from "@preact/signals-core";

import { within } from "../paths.ts";

import { files } from "../state/files.ts";

import type { From } from "../ui/focus-targets.ts";
import { ask, cancel, focusRequest, fromAnywhere, fromNothing, shownElement } from "../ui/focus-targets.ts";

import { folderOrAbove, parentOf } from "./tree.ts";

export const folded = signal<ReadonlySet<string>>(new Set());
export const rovingPath = signal<string | null>(null); // the row in the tab order, once one was focused
// the current folder ("" is the top): where the "+", New .do file and New folder make their file
export const currentDir = signal("");
// the waiting request when it is for the tree, as the test hook reads it: the row of `path`, or with no path the row in
// the tab order (`anywhere`: also from outside the tree). The request is the registry's (docs/web-page-flows.md, section 1)
export const focusWanted = computed<{ path: string | null; anywhere?: boolean } | null>(() => {
  const request = focusRequest.value;
  if (request?.name !== "tree") return null;
  return request.key !== undefined ? { path: request.key } : { path: null, anywhere: request.from === fromAnywhere };
});

/** A tree request lands only where the focus is free: on the page body, where a removed rename field leaves it, or in the
 *  tree. */
const fromTree: From = (at) => fromNothing(at) || !!at?.closest('[role="tree"]');

/** Whether the tree is on screen with its rows (not folded away, not on another phone view, not empty). */
export const treeShown = () => !!shownElement("tree")?.closest('[role="tree"]');

/** Make `path` the row in the tab order and have it take the focus when it is drawn (at once for a row on screen; after
 *  a rename, once the store has been listed again), unless the focus has gone out of the tree by then (TreeRow). */
export function focusRow(path: string) {
  rovingPath.value = path;
  ask("tree", { key: path, from: fromTree });
}

/** Have the tree's row in the tab order take the focus when it is drawn. */
export function focusTree(anywhere = false) {
  ask("tree", { from: anywhere ? fromAnywhere : fromTree });
}

/** A visitor focused or clicked the row `path`: it is the roving one, and a request for another row ends there. */
export function rove(path: string) {
  rovingPath.value = path;
  if (focusRequest.peek()?.name === "tree" && focusRequest.peek()?.key !== path) cancel("tree");
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
