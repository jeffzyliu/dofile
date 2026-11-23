// The dialogs of the file panel (docs/design/SPEC.md, section 3.10), each drawn with ui/Dialog.tsx while `dialog` holds
// its kind. The host draws a new dialog for each new value (clash 2 after clash 1); a view unmounted with no answer
// answers Cancel: Esc's meaning (for a clash, "keep yours for every clash left").
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { formatSize } from "../bytes.ts";
import { close as closeTab, save as saveTab } from "../editor/documents.ts";
import { refresh } from "../files.ts";
import { files } from "../state/files.ts";
import { closeDialog } from "../state/notices.ts";
import type { DialogOf } from "../types.ts";
import { Dialog } from "../ui/Dialog";
import { focusAfterClose } from "./close-focus.ts";
import { deleteAll, deleteEntries } from "./ops.ts";
import { baseName, shortDate } from "./tree.ts";
import { focusTree } from "./tree-state.ts";
import type { ClashAnswer } from "./upload.ts";
import { answerClash, clashNow, WORDS } from "./upload.ts";

const close = () => {
  closeDialog();
};

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
  const [isForRest, setForRest] = useState(false);
  const answered = useAnswer(() => answerClash("stop"));
  const give = (a: ClashAnswer) => {
    answered();
    close();
    answerClash(a);
  };
  const remainingCount = facts?.remainingCount ?? d.total - d.index;
  const unaskedCount = facts?.unaskedCount ?? 0;
  const words = facts?.words ?? WORDS.upload;
  return (
    <Dialog
      role="alertdialog"
      title={facts?.changedWhileAsked ? words.changedTitle(d.path) : words.title(d.path)}
      describedBy="clash-question"
      onCancel={() => give("stop")}
      actions={
        <>
          <button type="button" class="btn" onClick={() => give({ replace: true, isForRest })}>
            {words.replace}
          </button>
          <button type="button" class="btn primary" data-autofocus onClick={() => give({ replace: false, isForRest })}>
            Keep mine
          </button>
        </>
      }
    >
      <p id="clash-question">{facts?.changedWhileAsked ? words.changedQuestion : words.question}</p>
      {facts?.hasUnsavedEdits && <p>{baseName(d.path)} is open with unsaved edits; replacing it discards them.</p>}
      <p class="meta">
        {facts?.yours && `Yours: ${formatSize(facts.yours.size)}, ${shortDate(facts.yours.mtime)} · `}
        {facts && `${words.theirs}: ${formatSize(facts.uploadedBytes)} · `}
        {`clash ${d.index} of ${d.total}`}
        {unaskedCount > 0 && ` · ${words.others(unaskedCount)}`}.
      </p>
      {remainingCount > 0 && (
        <label class="check">
          <input type="checkbox" checked={isForRest} onChange={(e) => setForRest(e.currentTarget.checked)} />
          Do the same for the other {remainingCount === 1 ? "clash" : `${remainingCount} clashes`}
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
    // the row that opened the dialog goes, and the focus with it: the tree's row in the tab order takes it once the
    // list has been read again (a list made after the delete, so the row is gone from it)
    deleteEntries(d.paths)
      .then(refresh)
      .then(
        () => focusTree(),
        (e) => console.warn(`[dofile] delete: ${e?.message ?? e}`),
      );
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

export function CloseTabDialog({ dialog: d }: { dialog: DialogOf<"close-tab"> }) {
  const saving = useRef(false);
  // the dialog stays open while the file is written, so the focus moves once: to the tab now selected when the save
  // closes the tab, back to the opener when it fails (and a second press saves nothing twice)
  const save = async () => {
    if (saving.current) return;
    saving.current = true;
    const saved = await saveTab(d.path);
    closeDialog(d); // not a dialog that replaced this one meanwhile
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
