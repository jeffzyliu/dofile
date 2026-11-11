// STEP 4a: the Files pane's banner (docs/design/SPEC.md, section 3.11): { b: "not-text", path }, "survey.xlsx can't be
// opened in the editor." / Download, Dismiss. Draw it with ui/Live.tsx's <Banner kind="warn">; Dismiss calls
// dismiss(banner) from state.ts. banners.tsx (in app/) places it.
import type { BannerOf } from "../banners";

export const NotTextBanner = (_: { banner: BannerOf<"not-text"> }) => null;
