// The Files pane's banner for a file the editor cannot open (docs/design/SPEC.md, section 3.11). open.ts adds it.

import type { BannerOf } from "../types.ts";
import { DismissibleBanner } from "../ui/DismissibleBanner";
import { downloadEntry } from "./actions.ts";
import { baseName } from "./tree.ts";

export function NotTextBanner({ banner }: { banner: BannerOf<"not-text"> }) {
  return (
    <DismissibleBanner
      banner={banner}
      kind="warn"
      actions={
        <button
          type="button"
          class="btn"
          onClick={() => {
            downloadEntry(banner.path);
          }}
        >
          Download
        </button>
      }
    >
      <b>{baseName(banner.path)} can't be opened in the editor.</b> It isn't UTF-8 text, so the editor would change it.
      Download it to edit it elsewhere.
    </DismissibleBanner>
  );
}
