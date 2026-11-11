// STEP 4b: the banner above the editor when a save fails (OQ-16): { b: "save-failed", path, message }, an error banner
// with Download. Draw it with ui/Live.tsx's <Banner kind="error">; banners.tsx (in app/) places it.
import type { BannerOf } from "../banners";

export const SaveFailedBanner = (_: { banner: BannerOf<"save-failed"> }) => null;
