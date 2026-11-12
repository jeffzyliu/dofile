// STEP 4d: Reset (docs/design/SPEC.md, section 3.10, S 14). The ⋯ menu's "Reset the engine…" calls askReset().
//  - askReset(): not asked while the engine is ready with no data in memory and no results (then engine.ts reset() at
//    once); else the dialog. A run in progress, or one whose data is not described yet, always asks (words.ts resetAsks).
//  - ResetDialog { d: "reset" }: role alertdialog, "Reset the engine?" / "The data in memory, e() and r() results, macros
//    and graphs are cleared, as if you had reloaded. Your files are kept." / Cancel (focused), Reset (.btn.stop.live).
//    If the engine can no longer be reset while it is open (it failed, another tab took it), the dialog closes itself.
import { useEffect } from "preact/hooks";
import type { DialogOf } from "../dialogs";
import * as eng from "../engine.ts";
import { data, dialog, engine, lastRun, results } from "../state.ts";
import { Dialog } from "../ui/Dialog";
import { resetAsks } from "./words.ts";

export function askReset() {
  if (resetAsks(engine.value.s, data.value, results.value, lastRun.value)) dialog.value = { d: "reset" };
  else eng.reset();
}

const close = () => {
  if (dialog.value?.d === "reset") dialog.value = null;
};

export function ResetDialog(_: { dialog: DialogOf<"reset"> }) {
  const s = engine.value.s;
  const up = s === "ready" || s === "running" || s === "breaking" || s === "waiting";
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
