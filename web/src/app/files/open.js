// @ts-check
// STEP 4a fills in openFile(). Opening a file (docs/design/SPEC.md, section 3.11): the file tree's Enter and click, the
// phone's file switcher, and 4b's "Go to line" for a file that is not open (editor/commands.js goToLine) all go through
// openFile(path), so the rules of 3.11 live in one place:
//  - text (decodeText is not null): a tab { path, kind: "text" } in `tabs`, made active, then editorCommands.open(path, text);
//    an open one is only made active;
//  - .dta: a tab { path, kind: "dta" }, made active; App.tsx shows output/DtaView.tsx (4c) in the editor's place;
//  - for both, on a phone (state.js layout "phone"): phoneTab = "editor", so the tab shows (the Files view opened it);
//  - .png: run.js addFileGraph(path, base64), then the Graph tab (desktop: outputTab "graph"; phone: state.js graphFull);
//  - anything else: no tab; the banner { b: "not-text", path } (state.js addBanner).
// Plain JavaScript, so the Node tests can run it.

/** A file's text when its bytes are strict UTF-8 (the test the proof-of-concept page used; a leading BOM is dropped),
 *  else null: the editor would change such a file, so it is not opened as text.
 *  @param {Uint8Array} bytes @returns {string | null} */
export function decodeText(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Open `path` from the store as section 3.11 says (see above). Resolves once it is shown. STEP 4a: does nothing yet.
 *  @param {string} _path @returns {Promise<void>} */
export async function openFile(_path) {}
