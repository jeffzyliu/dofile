// The banner above the editor when a save fails (OQ-16): { b: "save-failed", path, message }, an error banner. The
// editor's Save adds it (one per file; a later save of that file that works removes it, and so does the editor's reload:
// "Reload from the run", "Replace with uploaded") and says it in the live region.
// Its words are drafts for the maintainer: "analysis.do couldn't be saved: <the store's reason>. Your edits are still in
// the editor; download them to keep a copy." / "Download" (the editor's text, saved or not, with the file's line break,
// as a file of that name), "Dismiss". banners.tsx (in app/) places it. Both banners here hand the focus on when they go
// with the focus in them (states/focus.ts useFocusOnLeave), as every banner with controls does.
import type { BannerOf } from "../banners";
import { baseName } from "../files/tree.ts";
import { saveAs, textInStore } from "../files.ts";
import { dismiss } from "../state.ts";
import { useFocusOnLeave } from "../states/focus.ts";
import { Banner } from "../ui/Live";
import { editorCommands } from "./commands.ts";
import { savedIsText, textOf } from "./Editor";

export const SaveFailedBanner = ({ banner }: { banner: BannerOf<"save-failed"> }) => {
  const name = baseName(banner.path);
  const ref = useFocusOnLeave<HTMLDivElement>(); // Dismiss by keyboard: the focus goes on, not to the page
  const download = () => {
    const text = textOf(banner.path);
    if (text !== null) saveAs(new Blob([text], { type: "text/plain" }), name);
  };
  return (
    <Banner
      kind="error"
      bannerRef={ref}
      actions={
        <>
          <button type="button" class="btn" onClick={download}>
            Download
          </button>
          <button type="button" class="btn quiet" onClick={() => dismiss(banner)}>
            Dismiss
          </button>
        </>
      }
    >
      <b>{`${name} couldn't be saved:`}</b> {`${banner.message.replace(/\.$/, "")}.`}{" "}
      {"Your edits are still in the editor; download them to keep a copy."}
    </Banner>
  );
};

// The banner above the editor when a run rewrote an open file that has unsaved edits, or wrote something that is not
// text over an open file: { b: "run-changed", path }, a warning (files.ts afterRun adds it; the joining of 4b and 4d, in
// place of a question: several files at once, a dialog already open and the phone made a dialog the harder path; on a
// phone it shows on every view, banners.tsx). The editor keeps its text and the tab stays unsaved, so a Save then
// replaces the run's version knowingly. Draft words: "The run changed t.csv. Your unsaved edits are still in the
// editor; saving them overwrites the file the run wrote." / "Reload from the run" (the store's version, the edits dropped),
// "Dismiss"; when the run's version is not text: "The run changed t.csv, and it is no longer text. The editor still
// shows your text; saving it overwrites the file the run wrote." / "Dismiss". A save or a reload of the file removes it; a close
// or a delete of the file removes it, and a rename moves it to the new name (Editor.tsx).
export const RunChangedBanner = ({ banner }: { banner: BannerOf<"run-changed"> }) => {
  const name = baseName(banner.path);
  const text = savedIsText(banner.path);
  const ref = useFocusOnLeave<HTMLDivElement>(); // Dismiss or "Reload from the run" by keyboard: the focus goes on
  const reload = async () => {
    const text = await textInStore(banner.path);
    if (text !== null) editorCommands.reload(banner.path, text);
    dismiss(banner);
  };
  return (
    <Banner
      kind="warn"
      bannerRef={ref}
      actions={
        <>
          {text && (
            <button type="button" class="btn" onClick={reload}>
              Reload from the run
            </button>
          )}
          <button type="button" class="btn quiet" onClick={() => dismiss(banner)}>
            Dismiss
          </button>
        </>
      }
    >
      {text ? (
        <>
          <b>{`The run changed ${name}.`}</b>{" "}
          {"Your unsaved edits are still in the editor; saving them overwrites the file the run wrote."}
        </>
      ) : (
        <>
          <b>{`The run changed ${name}, and it is no longer text.`}</b>{" "}
          {"The editor still shows your text; saving it overwrites the file the run wrote."}
        </>
      )}
    </Banner>
  );
};
