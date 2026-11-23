// The inline rename and the draft rows: the field's record, how it starts and how it ends (Enter, Esc, leaving the
// field). Plain TypeScript (no JSX), so the Node tests run it; FilesPane.tsx draws the field.
import { signal } from "@preact/signals-core";
import { isConflict } from "../../engine/store.ts";
import { refresh } from "../files.ts";
import { files, say, showToast } from "../state.ts";
import { store } from "../store.ts";
import { openFile } from "./open.ts";
import { createEntry, fail, NEW_NAMES, renameEntry } from "./ops.ts";
import {
  baseName,
  freeName,
  joinPath,
  movedPath,
  NAME_NOT_ALLOWED,
  nameProblem,
  newPathProblem,
  parentOf,
} from "./tree.ts";
import { currentDir, focusRow, focusTree, focusWanted, rovingPath, unfold } from "./tree-state.ts";

export interface Renaming {
  id: number; // which field: a commit that ends after another one began leaves it alone
  path: string; // a draft: the name it was offered, picked in the tap
  problem: string | null;
  draft?: keyof typeof NEW_NAMES; // a new file or folder: nothing is written until the field is left
  from: string | null; // the row in the tab order before the field: a draft's Esc gives the focus back to it
}
export const renaming = signal<Renaming | null>(null);
let fields = 0;

export function startRename(path: string, draft?: Renaming["draft"]) {
  renaming.value = { id: ++fields, path, problem: null, draft, from: rovingPath.value };
  rovingPath.value = path;
  focusWanted.value = null; // the field takes the focus: a waiting request ends
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

let ending = false; // an endRename is in progress (Enter, then the blur as the field goes)

/** Keep the field `r` open with `problem` under it, unless it has gone. */
function keepOpen(r: Renaming, problem: string) {
  if (renaming.value?.id === r.id) renaming.value = { ...r, problem };
  say(problem);
}

/** End the inline rename: `name` is the new name, or null to cancel. Keeps the field open when the name cannot be used.
 *  `leaving`: the field was left, not Enter pressed. A draft is written here, whatever the name (endDraft). */
export async function endRename(name: string | null, leaving = false) {
  const r = renaming.value;
  if (!r || ending) return;
  if (r.draft) return endDraft(r, name, leaving);
  const dir = parentOf(r.path);
  const to = name === null ? r.path : joinPath(dir, name);
  if (to !== r.path) {
    const problem = nameProblem(
      name!,
      dir,
      files.value.map((f) => f.path),
      r.path,
    );
    if (problem) return keepOpen(r, problem);
    ending = true;
    try {
      await renameEntry(r.path, to);
    } catch (e) {
      // the list was not current: the store says why
      return keepOpen(r, isConflict(e) ? `${name} already exists here.` : NAME_NOT_ALLOWED);
    } finally {
      ending = false;
    }
    currentDir.value = movedPath(currentDir.value, r.path, to); // the current folder, or one above it, was renamed
  }
  if (renaming.value?.id !== r.id) return; // another field was started meanwhile
  renaming.value = null;
  focusRow(to);
}

/** The end of a draft's field. Esc writes nothing. Enter writes the typed name, or the free default when it is empty or
 *  unchanged; a name in use keeps the field open. Leaving the field always writes: a name that cannot be used makes the
 *  free default (a toast says so), and nothing opens, so the focus stays where the visitor tapped. */
async function endDraft(r: Renaming, name: string | null, leaving: boolean) {
  const kind = r.draft!;
  const what = kind === "file" ? "file" : "folder";
  if (name === null) {
    renaming.value = null;
    rovingPath.value = r.from; // the row the visitor came from, not the draft's path or the open file's row
    focusTree();
    return;
  }
  const dir = parentOf(r.path);
  const asked = name.trim() === "" || name === baseName(r.path) ? undefined : name;
  // a draft's name may be a path: "sub/x.do" makes sub
  let problem = asked === undefined ? null : newPathProblem(asked, dir, files.value);
  if (problem && !leaving) return keepOpen(r, problem);
  if (leaving && rovingPath.value === r.path) rovingPath.value = r.from; // the draft's path is not a row
  ending = true;
  let to: string;
  try {
    try {
      to = await createEntry(kind, dir, problem ? undefined : asked);
    } catch (e) {
      if (asked === undefined || problem || !isConflict(e)) throw e;
      problem = `${asked} already exists here.`; // the list was not current
      if (!leaving) return keepOpen(r, problem);
      to = await createEntry(kind, dir);
    }
    await refresh();
  } catch (e) {
    fail(`New ${what}`, `Couldn't create the ${what}`)(e);
    if (renaming.value?.id === r.id) {
      renaming.value = null;
      focusTree();
    }
    return;
  } finally {
    ending = false;
  }
  if (problem)
    showToast(`${problem} Made ${baseName(to)} instead.`); // the reason line is gone with the field
  else if (asked?.includes("/")) unfold(parentOf(to)); // a folder the name went through may be folded
  // leaving: the visitor's tap decides what is open and where the focus is
  if (kind === "file" && !leaving) openFile(to);
  if (renaming.value?.id !== r.id) return; // another field was started meanwhile
  renaming.value = null;
  if (!leaving) focusRow(to);
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
