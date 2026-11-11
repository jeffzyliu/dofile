// STEP 4a: the editor's tabs (docs/design/SPEC.md, section 3.2), in the Editor pane's head, and the phone's file switcher.
//  - EditorTabs: role="tablist" aria-label="Open files"; one tab per open file (`tabs`, `activeTab`), the unsaved dot,
//    the × (mouse only), Delete closes; closing an unsaved tab asks (dialog "close-tab"). ui/Tablist.tsx has the
//    arrow-key pattern; the editor's tabs need the × and Delete on top of it. Closing a tab removes it from `tabs` and calls
//    editorCommands.closed(path). `dirty` is the editor's (state.js setDirty); this file never sets it.
//  - FileSwitcher: the phone's top bar title on the Editor tab (WP 1): the open file's name and ▾, a menu of the open
//    files. The default below shows the name only.
import { activeTab } from "../state.ts";

export const EditorTabs = () => null;

export const FileSwitcher = () => <>{activeTab.value?.split("/").at(-1) ?? "Editor"}</>;
