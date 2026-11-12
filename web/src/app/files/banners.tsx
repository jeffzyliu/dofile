// The Files pane's banner (docs/design/SPEC.md, section 3.11, P/.xlsx): { b: "not-text", path }, a warning: "survey.xlsx
// can't be opened in the editor. It isn't UTF-8 text, so the editor would change it. Download it to edit it elsewhere."
// / Download, Dismiss. files/open.ts adds it (one at a time); banners.tsx (in app/) places it. Dismiss by keyboard hands
// the focus on (states/focus.ts useFocusOnLeave), as every banner with controls does.
import type { BannerOf } from "../banners";
import { dismiss } from "../state.ts";
import { useFocusOnLeave } from "../states/focus.ts";
import { Banner } from "../ui/Live";
import { downloadEntry } from "./actions.ts";
import { baseName } from "./tree.ts";

export function NotTextBanner({ banner }: { banner: BannerOf<"not-text"> }) {
  const ref = useFocusOnLeave<HTMLDivElement>(); // Dismiss by keyboard: the focus goes on, not to the page
  return (
    <Banner
      kind="warn"
      bannerRef={ref}
      actions={
        <>
          <button
            type="button"
            class="btn"
            onClick={() => {
              downloadEntry(banner.path);
            }}
          >
            Download
          </button>
          <button type="button" class="btn quiet" onClick={() => dismiss(banner)}>
            Dismiss
          </button>
        </>
      }
    >
      <b>{baseName(banner.path)} can't be opened in the editor.</b> It isn't UTF-8 text, so the editor would change it.
      Download it to edit it elsewhere.
    </Banner>
  );
}
