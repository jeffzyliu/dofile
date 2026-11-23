// The inline rename and the draft rows: the field's record, how it starts and how it ends (Enter, Esc, leaving the
// field). Plain TypeScript (no JSX), so the Node tests run it; TreeRow.tsx's RenameField draws the field.
import { signal } from "@preact/signals-core";
import { isConflict } from "../../engine/store.ts";
import { refresh } from "../files.ts";
import { movedPath } from "../paths.ts";
import { files, say, showToast } from "../state.ts";
import { store } from "../store.ts";
import { cancel } from "../ui/focus-targets.ts";
import { openFile } from "./open.ts";
import { createEntry, fail, NEW_NAMES, renameEntry } from "./ops.ts";
import { baseName, freeName, joinPath, NAME_NOT_ALLOWED, nameProblem, newPathProblem, parentOf } from "./tree.ts";
import { currentDir, focusRow, focusTree, rovingPath, unfold } from "./tree-state.ts";

export interface Renaming {
  id: number; // which field: a commit that ends after another one began leaves it alone
  path: string; // a draft: the name it was offered, picked in the tap
  problem: string | null;
  draft?: keyof typeof NEW_NAMES; // a new file or folder: nothing is written until the field is left
  from: string | null; // the row in the tab order before the field: a draft's Esc gives the focus back to it
}
export const renaming = signal<Renaming | null>(null);
let lastFieldId = 0;

export function startRename(path: string, draft?: Renaming["draft"]) {
  renaming.value = { id: ++lastFieldId, path, problem: null, draft, from: rovingPath.value };
  rovingPath.value = path;
  cancel("tree"); // the field takes the focus: a waiting request ends
}

/** "New .do file", "New folder" and the "+": draw the name field at once in `dir` (unfolded, made current), writing
 *  nothing yet: on iOS the focus that raises the keyboard has to be made in the tap (docs/web-page-flows.md, section 1,
 *  rule 8). endRename writes it. */
export function startDraft(kind: keyof typeof NEW_NAMES, dir: string) {
  const what = kind === "file" ? "file" : "folder";
  if (store.blocked)
    return fail(`New ${what}`, `Couldn't create the ${what}`)(new Error("the files are another tab's"));
  unfold(dir);
  currentDir.value = dir;
  startRename(
    freeName(
      dir,
      NEW_NAMES[kind],
      files.value.map((f) => f.path),
    ),
    kind,
  );
}

let isEnding = false; // an endRename is in progress (Enter, then the blur as the field goes)

/** Keep the field `field` open with `problem` under it, unless it has gone. */
function keepOpen(field: Renaming, problem: string) {
  if (renaming.value?.id === field.id) renaming.value = { ...field, problem };
  say(problem);
}

/** End the inline rename: `name` is the new name, or null to cancel. Keeps the field open when the name cannot be used.
 *  `leaving`: the field was left, not Enter pressed. A draft is written here, whatever the name (endDraft). */
export async function endRename(name: string | null, leaving = false) {
  const field = renaming.value;
  if (!field || isEnding) return;
  if (field.draft) return endDraft(field, name, leaving);
  const dir = parentOf(field.path);
  const newPath = name === null ? field.path : joinPath(dir, name);
  if (newPath !== field.path) {
    const problem = nameProblem(
      name!,
      dir,
      files.value.map((f) => f.path),
      field.path,
    );
    if (problem) return keepOpen(field, problem);
    isEnding = true;
    try {
      await renameEntry(field.path, newPath);
    } catch (e) {
      // the list was not current: the store says why
      return keepOpen(field, isConflict(e) ? `${name} already exists here.` : NAME_NOT_ALLOWED);
    } finally {
      isEnding = false;
    }
    currentDir.value = movedPath(currentDir.value, field.path, newPath); // the current folder, or one above it, was renamed
  }
  if (renaming.value?.id !== field.id) return; // another field was started meanwhile
  renaming.value = null;
  focusRow(newPath);
}

/** The end of a draft's field. Esc writes nothing. Enter writes the typed name, or the free default when it is empty or
 *  unchanged; a name in use keeps the field open. Leaving the field always writes: a name that cannot be used makes the
 *  free default (a toast says so), and nothing opens, so the focus stays where the visitor tapped. */
async function endDraft(field: Renaming, name: string | null, leaving: boolean) {
  const kind = field.draft!;
  const what = kind === "file" ? "file" : "folder";
  if (name === null) {
    renaming.value = null;
    rovingPath.value = field.from; // the row the visitor came from, not the draft's path or the open file's row
    focusTree();
    return;
  }
  const dir = parentOf(field.path);
  const askedName = name.trim() === "" || name === baseName(field.path) ? undefined : name;
  // a draft's name may be a path: "sub/x.do" makes sub
  let problem = askedName === undefined ? null : newPathProblem(askedName, dir, files.value);
  if (problem && !leaving) return keepOpen(field, problem);
  if (leaving && rovingPath.value === field.path) rovingPath.value = field.from; // the draft's path is not a row
  isEnding = true;
  let newPath: string;
  try {
    try {
      newPath = await createEntry(kind, dir, problem ? undefined : askedName);
    } catch (e) {
      if (askedName === undefined || problem || !isConflict(e)) throw e;
      problem = `${askedName} already exists here.`; // the list was not current
      if (!leaving) return keepOpen(field, problem);
      newPath = await createEntry(kind, dir);
    }
    await refresh();
  } catch (e) {
    fail(`New ${what}`, `Couldn't create the ${what}`)(e);
    if (renaming.value?.id === field.id) {
      renaming.value = null;
      focusTree();
    }
    return;
  } finally {
    isEnding = false;
  }
  if (problem)
    showToast(`${problem} Made ${baseName(newPath)} instead.`); // the reason line is gone with the field
  else if (askedName?.includes("/")) unfold(parentOf(newPath)); // a folder the name went through may be folded
  // leaving: the visitor's tap decides what is open and where the focus is
  if (kind === "file" && !leaving) openFile(newPath);
  if (renaming.value?.id !== field.id) return; // another field was started meanwhile
  renaming.value = null;
  if (!leaving) focusRow(newPath);
}

/** The visitor typed in the field `field`: its problem sentence goes. */
export function clearProblem(field: Renaming) {
  if (field.problem) renaming.value = { ...field, problem: null };
}

/** The field `field` was left with `name` in it (blur). A draft is written. A rename goes through when the name can be
 *  used, else it is cancelled. Nothing happens when another field has taken its place. */
export async function leaveField(field: Renaming, name: string): Promise<void> {
  if (renaming.value?.id !== field.id) return;
  if (field.draft) return endRename(name, true); // a draft is written when the field is left
  // leaving the field: rename when the name can be used, else cancel
  const usable =
    name === baseName(field.path) ||
    !nameProblem(
      name,
      parentOf(field.path),
      files.value.map((f) => f.path),
      field.path,
    );
  return endRename(usable ? name : null);
}
