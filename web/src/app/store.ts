// The page's one file store (IndexedDB database `dofile`, src/engine/store.js). Views change files through it directly:
// store.write, mkdir, rename, remove, read, zip (docs/design/SPEC.md, section 7). In a tab without the tab lock it is
// `blocked` and every change rejects ("dofile is open in another tab"). It starts blocked: the page draws before the tab
// lock answers, and a write in that time must not go through in a tab that turns out not to own the files. engine.js
// unblocks it once the lock is this tab's.
import { openStore } from "../engine/store.ts";

export const store = openStore();
store.blocked = true;
