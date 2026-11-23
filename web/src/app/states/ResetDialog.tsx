// Reset (docs/design/SPEC.md, section 3.10, S 14). askReset() resets at once only when the engine is ready and nothing
// has run on it since it started; otherwise it opens the dialog (words.ts resetAsks). If the engine can no longer be
// reset while the dialog is open (it failed, another tab took it), the dialog closes itself.
import { useEffect } from "preact/hooks";
import * as eng from "../engine.ts";
import { engine } from "../state/engine.ts";
import { closeDialog, openDialog } from "../state/notices.ts";
import { engineRuns } from "../state/run.ts";
import type { DialogOf } from "../types.ts";
import { Dialog } from "../ui/Dialog";
import { engineUp } from "./predicates.ts";
import { resetAsks } from "./words.ts";

export function askReset() {
  if (resetAsks(engine.value.s, engineRuns.value)) openDialog({ d: "reset" });
  else eng.reset();
}

const close = () => {
  closeDialog("reset");
};

export function ResetDialog(_: { dialog: DialogOf<"reset"> }) {
  const up = engineUp(engine.value);
  useEffect(() => {
    if (!up) close();
  }, [up]);
  return (
    <Dialog
      title="Reset the engine?"
      role="alertdialog"
      describedBy="reset-what"
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
              eng.reset();
            }}
          >
            Reset
          </button>
        </>
      }
    >
      <p id="reset-what">
        The data in memory, e() and r() results, macros and graphs are cleared, as if you had reloaded. Your files are
        kept.
      </p>
    </Dialog>
  );
}
