// The banner above the editor when a save fails (OQ-16): { b: "save-failed", path, message }, an error banner. The
// editor's Save adds it (one per file; a later save of that file that works removes it) and says it in the live region.
// Its words are drafts for the maintainer: "analysis.do couldn't be saved: <the store's reason>. Your edits are still in
// the editor; download them to keep a copy." / "Download" (the editor's text, saved or not, as a file of that name),
// "Dismiss". banners.tsx (in app/) places it.
import type { BannerOf } from "../banners";
import { baseName } from "../files/tree.ts";
import { saveAs } from "../files.ts";
import { dismiss } from "../state.ts";
import { Banner } from "../ui/Live";
import { textOf } from "./Editor";

export const SaveFailedBanner = ({ banner }: { banner: BannerOf<"save-failed"> }) => {
  const name = baseName(banner.path);
  const download = () => {
    const text = textOf(banner.path);
    if (text !== null) saveAs(new Blob([text], { type: "text/plain" }), name);
  };
  return (
    <Banner
      kind="error"
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
