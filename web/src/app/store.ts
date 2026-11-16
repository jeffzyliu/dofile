// The page's one file store. It starts `blocked` (every change rejects): the page draws before the tab lock answers,
// and a write in that time must not go through in a tab that turns out not to own the files. own() in files.ts
// unblocks it.
import { openStore } from "../engine/store.ts";

export const store = openStore();
store.blocked = true;
