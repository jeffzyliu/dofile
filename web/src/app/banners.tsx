// Where each banner goes, and which view draws it. A pane shows its banners above its content: <BannerSlot place>.
// Two sources:
//  - the engine's states (`engine`, `isolated`), not in `banners`: states/banners.tsx's EditorStateBanners and
//    LogStateBanners (step 4d);
//  - the `banners` signal, one entry per banner, added by its owner (state.ts addBanner) and removed by Dismiss or when
//    its cause goes (dismiss). Each kind's view is in its owner's file:
//      reset, memory, storage, download-failed: states/banners.tsx (step 4d) · not-text: files/banners.tsx (step 4a)
//      save-failed, run-changed: editor/banners.tsx (step 4b; run-changed added when 4b and 4d were joined)
// Add a kind here, in types.ts and in SPEC.md section 8 together.
// `phone: "every"`: on a phone every view's slot draws it (the phone's Data and Results views have a slot, "output", for
// these only), so it is seen whichever view is shown; the hidden views are display: none, so it is read and tabbed once.
import type { ComponentType } from "preact";
import { RunChangedBanner, SaveFailedBanner } from "./editor/banners";
import { NotTextBanner } from "./files/banners";
import { banners, isPhone } from "./state.ts";
import {
  DownloadFailedBanner,
  EditorStateBanners,
  LogStateBanners,
  MemoryBanner,
  ResetBanner,
  StorageBanner,
} from "./states/banners";
import type { Banner, BannerName } from "./types.ts";

export type BannerOf<K extends BannerName> = Extract<Banner, { b: K }>;
export type Place = "files" | "editor" | "log" | "output";

const VIEWS: { [K in BannerName]: { place: Place; phone?: "every"; view: ComponentType<{ banner: BannerOf<K> }> } } = {
  reset: { place: "log", view: ResetBanner },
  memory: { place: "log", view: MemoryBanner },
  storage: { place: "editor", view: StorageBanner },
  "download-failed": { place: "editor", phone: "every", view: DownloadFailedBanner }, // "Download all" is on every view's ⋯
  "not-text": { place: "files", view: NotTextBanner },
  "save-failed": { place: "editor", view: SaveFailedBanner },
  "run-changed": { place: "editor", phone: "every", view: RunChangedBanner }, // a run from the Log view's command line
};

export function BannerSlot({ place }: { place: Place }) {
  const mine = banners.value.filter(
    (b) => VIEWS[b.b].place === place || (isPhone.value && VIEWS[b.b].phone === "every"),
  );
  return (
    <div class="banners" data-place={place}>
      {place === "editor" && <EditorStateBanners />}
      {place === "log" && <LogStateBanners />}
      {mine.map((b) => {
        const View = VIEWS[b.b].view as ComponentType<{ banner: Banner }>;
        return <View key={`${b.b}:${"path" in b ? b.path : ""}`} banner={b} />;
      })}
    </div>
  );
}
