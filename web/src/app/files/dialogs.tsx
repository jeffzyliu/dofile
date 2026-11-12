// The dialogs of the file panel (docs/design/SPEC.md, section 3.10), each drawn with ui/Dialog.tsx while `dialog` holds
// its kind. dialogs.tsx (in app/) maps each kind to its view.
//  - ClashDialog { d: "clash", path, index, total }: "data/wages.dta is already here" (role alertdialog; "Keep mine"
//    focused, so Enter keeps this one). Its other facts come from actions.ts clashNow(); the answer goes to
//    answerClash(), and upload() then writes and asks the next clash. Esc keeps yours for every clash left.
//  - DeleteDialog { d: "delete", paths }: "Delete clean.do?" (Cancel focused; Delete is .btn.stop.live).
//  - DeleteAllDialog { d: "delete-all", count }: "Delete all 12 files?" / Cancel (focused), "Delete all".
//  - CloseTabDialog { d: "close-tab", path }: "Save changes to clean.do?" / Save (focused), "Don't save", Cancel; Esc is
//    Cancel. Save: editorCommands.save(path), the dialog open until it answers, then the tab closes (it stays open when
//    save resolves false: no editor, or the store refused); Don't save: the tab closes and editorCommands.closed(path)
//    drops the edits. Once the tab has closed the focus goes to the tab now selected (EditorTabs.tsx focusAfterClose),
//    not to the page.
// The host draws a new dialog for each new value (clash 2 after clash 1); a view unmounted with no answer (another dialog
// replaced it) answers Cancel: Esc's meaning (for a clash, "keep yours for every clash left").
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { DialogOf } from "../dialogs";
import { editorCommands } from "../editor/commands.ts";
import { replaceWithSample } from "../sample.ts";
import { dialog, files } from "../state.ts";
import { Dialog } from "../ui/Dialog";
import { answerClash, type ClashAnswer, clashNow, closeTab, deleteAll, deleteEntries } from "./actions.ts";
import { focusAfterClose } from "./EditorTabs";
import { baseName, formatSize, shortDate } from "./tree.ts";

const close = () => {
  dialog.value = null;
};

/** After a delete the row that opened the dialog is gone and the focus with it: give it to the tree's row in the tab
 *  order, once the list has been read again. */
const refocus = () =>
  setTimeout(() => {
    if (document.activeElement && document.activeElement !== document.body) return;
    document.querySelector<HTMLElement>('.files [role="treeitem"][tabindex="0"]')?.focus();
  }, 100);

/** Run `cancel` when the view is unmounted before it answered. Returns `answered()`, to call when it answers. A layout
 *  effect, so the cleanup is there from the first render: an effect runs after the paint, and a view replaced before
 *  that would never cancel. */
function useAnswer(cancel: () => void) {
  const done = useRef(false);
  const later = useRef(cancel);
  later.current = cancel;
  useLayoutEffect(
    () => () => {
      if (!done.current) later.current();
    },
    [],
  );
  return () => {
    done.current = true;
  };
}

export function ClashDialog({ dialog: d }: { dialog: DialogOf<"clash"> }) {
  const facts = clashNow();
  const [same, setSame] = useState(false);
  const answered = useAnswer(() => answerClash("stop"));
  const give = (a: ClashAnswer) => {
    answered();
    close();
    answerClash(a);
  };
  const left = facts?.left ?? d.total - d.index;
  const others = facts?.others ?? 0;
  return (
    <Dialog
      role="alertdialog"
      title={`${d.path} is already here`}
      describedBy="clash-question"
      onCancel={() => give("stop")}
      actions={
        <>
          <button type="button" class="btn" onClick={() => give({ replace: true, same })}>
            Replace with uploaded
          </button>
          <button type="button" class="btn primary" data-autofocus onClick={() => give({ replace: false, same })}>
            Keep mine
          </button>
        </>
      }
    >
      <p id="clash-question">
        The upload has a file with the same name. Keep yours, or replace it with the uploaded one?
      </p>
      {facts?.unsaved && <p>{baseName(d.path)} is open with unsaved edits; replacing it discards them.</p>}
      <p class="meta">
        {facts && `Yours: ${formatSize(facts.yours.size)}, ${shortDate(facts.yours.mtime)} · `}
        {facts && `uploaded: ${formatSize(facts.uploaded)} · `}
        {`clash ${d.index} of ${d.total}`}
        {others > 0 && ` · the other ${others === 1 ? "file is" : `${others} files are`} uploaded`}.
      </p>
      {left > 0 && (
        <label class="check">
          <input type="checkbox" checked={same} onChange={(e) => setSame(e.currentTarget.checked)} />
          Do the same for the other {left === 1 ? "clash" : `${left} clashes`}
        </label>
      )}
    </Dialog>
  );
}

export function DeleteDialog({ dialog: d }: { dialog: DialogOf<"delete"> }) {
  const dirs = new Set(files.value.filter((f) => f.dir).map((f) => f.path));
  const names = d.paths.map((p) => (dirs.has(p) ? `${p}/` : p));
  const folder = d.paths.some((p) => dirs.has(p));
  const remove = () => {
    close();
    deleteEntries(d.paths).then(refocus, (e) => console.warn(`[dofile] delete: ${e?.message ?? e}`));
  };
  return (
    <Dialog
      role="alertdialog"
      title={`Delete ${names.join(", ")}?`}
      onCancel={close}
      actions={
        <>
          <button type="button" class="btn" data-autofocus onClick={close}>
            Cancel
          </button>
          <button type="button" class="btn stop live" onClick={remove}>
            Delete
          </button>
        </>
      }
    >
      <p>
        {folder
          ? "The folder and its files exist only in this browser. This can't be undone."
          : "It exists only in this browser. This can't be undone."}
      </p>
    </Dialog>
  );
}

export function DeleteAllDialog({ dialog: d }: { dialog: DialogOf<"delete-all"> }) {
  const remove = () => {
    close();
    deleteAll().catch((e) => console.warn(`[dofile] delete all: ${e?.message ?? e}`));
  };
  return (
    <Dialog
      role="alertdialog"
      title={`Delete all ${d.count} ${d.count === 1 ? "file" : "files"}?`}
      onCancel={close}
      actions={
        <>
          <button type="button" class="btn" data-autofocus onClick={close}>
            Cancel
          </button>
          <button type="button" class="btn stop live" onClick={remove}>
            Delete all
          </button>
        </>
      }
    >
      <p>This removes every file dofile keeps in this browser. This can't be undone.</p>
    </Dialog>
  );
}

/** Step 5: "Restore the sample" found files of the sample with other contents. Not drawn in the mockups; the words are a
 *  draft (SPEC 8, step 5). Cancel is focused. */
export function RestoreSampleDialog({ dialog: d }: { dialog: DialogOf<"restore-sample"> }) {
  const replace = () => {
    close();
    replaceWithSample();
  };
  return (
    <Dialog
      role="alertdialog"
      title="Restore the sample?"
      onCancel={close}
      actions={
        <>
          <button type="button" class="btn" data-autofocus onClick={close}>
            Cancel
          </button>
          <button type="button" class="btn stop live" onClick={replace}>
            Replace
          </button>
        </>
      }
    >
      <p>
        {d.paths.join(", ")} {d.paths.length === 1 ? "differs" : "differ"} from the sample. Replacing{" "}
        {d.paths.length === 1 ? "it discards" : "them discards"} your changes. Your other files are untouched.
      </p>
    </Dialog>
  );
}

export function CloseTabDialog({ dialog: d }: { dialog: DialogOf<"close-tab"> }) {
  const saving = useRef(false);
  // the dialog stays open while the file is written, so the focus moves once: to the tab now selected when the save
  // closes the tab, back to the opener when it fails (and a second press saves nothing twice)
  const save = async () => {
    if (saving.current) return;
    saving.current = true;
    const saved = await editorCommands.save(d.path);
    if (dialog.value === d) close(); // not a dialog that replaced this one meanwhile
    if (saved) {
      closeTab(d.path);
      focusAfterClose();
    }
  };
  const discard = () => {
    close();
    closeTab(d.path);
    focusAfterClose();
  };
  return (
    <Dialog
      title={`Save changes to ${baseName(d.path)}?`}
      onCancel={close}
      actions={
        <>
          <button type="button" class="btn" onClick={close}>
            Cancel
          </button>
          <button type="button" class="btn" onClick={discard}>
            Don't save
          </button>
          <button type="button" class="btn primary" data-autofocus onClick={save}>
            Save
          </button>
        </>
      }
    />
  );
}
