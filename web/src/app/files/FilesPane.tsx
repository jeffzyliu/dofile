// STEP 4a: the file panel (docs/design/SPEC.md, section 3.1). App.tsx draws the pane, its head ("Files") and its
// banners; this file fills the head's right side and the body.
//  - FilesHead: the head menu "File actions" (MenuButton): New .do file, New folder, Upload a folder, Download all (.zip)
//    (files.js downloadAll), Restore the sample (OQ-13; step 5's sample), Delete all files… (dialog { d: "delete-all", count }).
//  - FilesBody: the tree (role="tree", flat rows with aria-level, roving focus, row menus through ui/Menu openMenu), the
//    dropzone and "Download all (.zip)". Reads `files`, `fresh`, `tabs`, `activeTab`; changes files with store.*
//    (`import { store } from "../store.js"`), never through the worker. A change lists the store again by itself (files.js).
//    Enter or a click opens a file through files/open.js openFile(path). A rename or delete of an open file updates
//    `tabs` and `activeTab` and calls editorCommands.renamed(from, to) or closed(path) (editor/commands.js).
import { Placeholder } from "../ui/Icon";

export const FilesHead = () => null;

export const FilesBody = () => (
  <Placeholder step="4a">The file tree, the dropzone ("Drop files or folders", Upload, New .do file) and Download all (.zip).</Placeholder>
);
