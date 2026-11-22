// The banners above the editor. A save that failed: one per file, removed by a later save that works or by a reload.
// Download is the editor's text, saved or not, in the file's line break. Both banners hand the focus on when they go
// with the focus in them (useFocusOnLeave).

import { saveAs } from "../files/save.ts";
import { baseName } from "../files/tree.ts";
import { reloadFromStore } from "../files.ts";
import { dismiss } from "../state.ts";
import { useFocusOnLeave } from "../states/focus.ts";
import type { BannerOf } from "../types.ts";
import { Banner } from "../ui/Live";
import { savedIsText, textOf } from "./documents.ts";

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

// A run rewrote an open file that has unsaved edits, or wrote something that is not text over an open file. The editor
// keeps its text and the tab stays unsaved, so a Save then replaces the run's version knowingly. "Reload from the run"
// takes the store's version and drops the edits. A save, a reload, a close or a delete of the file removes the banner;
// a rename moves it (documents.ts).
export const RunChangedBanner = ({ banner }: { banner: BannerOf<"run-changed"> }) => {
  const name = baseName(banner.path);
  const text = savedIsText(banner.path);
  const ref = useFocusOnLeave<HTMLDivElement>(); // Dismiss or "Reload from the run" by keyboard: the focus goes on
  const reload = async () => {
    await reloadFromStore(banner.path);
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
