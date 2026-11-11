// STEP 4b: the Log pane's foot and the phone's.
//  - CommandLine (.cmdline, section 3.5): prompt ".", the input aria-label="Command" (placeholder "Type a command · ↑ ↓
//    for earlier ones"; phone: "Type a command"), "Run command". Enter runs through run.ts's runCommand(text) (kind
//    "command", fresh_locals false). It answers { accepted, done } at once: accepted (it runs now, or is queued while there
//    is no engine) means it is in `history` and the field clears; refused (a start or a run in progress) means not in
//    `history`, and the text stays in the field. ↑ ↓ recall `history`.
//    On a phone it shows on the Log view only (App.tsx; WP 1 has none on the Editor view).
//  - LogActions: the Log head's "Find" and "Download log" (App.tsx adds Split / Unsplit after them). The phone hides the
//    Log head (the top bar names the view), so the same actions are logMenuItems(): the phone's ⋯ menu adds them while
//    the Log view is shown (App.tsx's phoneMoreItems).
//  - PhoneStrip: the phone's strip under the top bar (PH; App.tsx places it): "r(111)", "line 17 · 0.38 s",
//    "Mem 612 MB", "Go to line 17"; while running "Running lines 14–15".
import { Placeholder } from "../ui/Icon";
import type { MenuItem } from "../ui/Menu";

export const CommandLine = () => (
  <div class="cmdline"><Placeholder step="4b">The command line.</Placeholder></div>
);

export const LogActions = () => null;

/** The phone's ⋯ menu items for the Log view: Find and Download log, as LogActions does them. */
export const logMenuItems = (): MenuItem[] => [];

export const PhoneStrip = () => null;
