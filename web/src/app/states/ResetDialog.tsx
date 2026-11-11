// STEP 4d: Reset (docs/design/SPEC.md, section 3.10, S 14). The ⋯ menu's "Reset the engine…" calls askReset().
//  - askReset(): not asked with no data in memory and no results (then engine.js reset() at once); else the dialog.
//  - ResetDialog { d: "reset" }: role alertdialog, "Reset the engine?" / "The data in memory, e() and r() results,
//    macros and graphs are cleared, as if you had reloaded. Your files are kept." / Cancel (focused), Reset (.btn.stop.live).
import { dialog } from "../state.ts";
import type { DialogOf } from "../dialogs";

export function askReset() {
  dialog.value = { d: "reset" };
}

export const ResetDialog = (_: { dialog: DialogOf<"reset"> }) => null;
