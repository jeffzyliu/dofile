// The Clear log dialog (docs/design/SPEC.md, sections 3.5 and 3.10). Opened by the Log head's "Clear…" and the menus'
// "Clear log…" (CommandLine.tsx), which are disabled when run.ts canClearLog() is false.
//  - ClearLogDialog { d: "clear-log" }: role alertdialog, "Clear the log?" / "This removes the log and the graphs. Your
//    data and your files stay." / Cancel (focused), "Clear log" (.btn.stop.live). Esc is Cancel. The focus goes back to
//    what opened it, as the Delete-all dialog's does (ui/Dialog.tsx); a menu's item gives it to the menu's button.
//    It may be open during a run: clearLog() keeps the streaming run's text item.
import type { DialogOf } from "../dialogs";
import { clearLog } from "../run.ts";
import { dialog } from "../state.ts";
import { Dialog } from "../ui/Dialog";

const close = () => {
  dialog.value = null;
};

export function ClearLogDialog(_: { dialog: DialogOf<"clear-log"> }) {
  return (
    <Dialog
      role="alertdialog"
      title="Clear the log?"
      onCancel={close}
      actions={
        <>
          <button type="button" class="btn" data-autofocus onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            class="btn stop live"
            onClick={() => {
              close();
              clearLog();
            }}
          >
            Clear log
          </button>
        </>
      }
    >
      <p>This removes the log and the graphs. Your data and your files stay.</p>
    </Dialog>
  );
}
