// Where the focus goes after a tab closed from the keyboard or the close-tab dialog. Plain TypeScript (no JSX), so the Node
// tests run it; the tabs, the tree's rows and the editor take the request from their render (ui/focus-targets.ts).
import { activeTab } from "../editor/documents.ts";
import { ask, fromAnywhere, fromNothing, shownElement } from "../ui/focus-targets.ts";
import { focusTree, treeShown } from "./tree-state.ts";

/** After a tab closed (its element, which may have had the focus, is gone): the selected tab takes the focus, else the
 *  file tree's row in the tab order when the list is shown, else the editor; never the page itself. Each takes it from
 *  its render that follows, once the closed tab has left the page (the editor shows its empty view only then); the choice
 *  is made now, from the tabs as they stand and the strip as it is drawn. */
export function focusAfterClose() {
  if (activeTab.value !== null && shownElement("open-file-tab")) {
    ask("open-file-tab", { from: (at) => fromNothing(at) || !!at?.closest(".file-tabs") }); // a closed tab leaves it on nothing
  } else if (treeShown()) focusTree();
  else ask("editor", { from: fromAnywhere });
}
