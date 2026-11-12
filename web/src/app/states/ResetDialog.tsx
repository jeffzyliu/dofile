// STEP 4d: Reset (docs/design/SPEC.md, section 3.10, S 14). The ⋯ menu's "Reset the engine…" calls askReset().
//  - askReset(): not asked while the engine is ready with no data in memory and no results (then engine.ts reset() at
//    once); else the dialog. A run in progress always asks. After a run, "nothing to lose" is checked again once run.ts
//    refreshData has described the memory afresh (words.ts resetDecision): until it answers, `data` may still be the
//    description from before that run. A press while that check is pending does nothing.
//  - ResetDialog { d: "reset" }: role alertdialog, "Reset the engine?" / "The data in memory, e() and r() results, macros
//    and graphs are cleared, as if you had reloaded. Your files are kept." / Cancel (focused), Reset (.btn.stop.live).
//    If the engine can no longer be reset while it is open (it failed, another tab took it), the dialog closes itself.
import { useEffect } from "preact/hooks";
import type { DialogOf } from "../dialogs";
import * as eng from "../engine.ts";
import { refreshData } from "../run.ts";
import { data, dialog, engine, lastRun, results } from "../state.ts";
import { Dialog } from "../ui/Dialog";
import { resetDecision } from "./words.ts";

let deciding = false; // a press is waiting for refreshData: another press does nothing

export function askReset() {
  if (deciding) return;
  deciding = true;
  const read = () => ({ state: engine.value.s, data: data.value, results: results.value, lastRun: lastRun.value });
  resetDecision(read, refreshData)
    .then((next) => {
      if (next === "ask") dialog.value = { d: "reset" };
      else if (next === "reset") eng.reset();
    })
    .finally(() => {
      deciding = false;
    });
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
