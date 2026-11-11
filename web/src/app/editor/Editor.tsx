// STEP 4b: the editor (docs/design/SPEC.md, section 3.3): CodeMirror 6 with stata/language.ts, one EditorState per open
// tab (`tabs`, `activeTab`; the text lives in CodeMirror, not in a signal), the line marks (selected, running, error),
// Save (store.write, toast "Saved analysis.do"), Ctrl/Cmd+Enter and Ctrl/Cmd+S. It fills editor/commands.js
// (runFile, runSelection, save, focus, `selection`) when it mounts. Keep the `data-editor` attribute on the element that
// takes the focus: commands.js's default focus() looks for it. The phone shows the same editor on the Editor tab.
import { Placeholder } from "../ui/Icon";

export const Editor = () => (
  <div class="editor-host" data-editor tabIndex={-1}>
    <Placeholder step="4b">The editor (CodeMirror 6), one state per open tab, with the run and error line marks.</Placeholder>
  </div>
);
