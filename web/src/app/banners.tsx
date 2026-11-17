// Where each banner goes, and which view draws it: a pane shows its banners above its content (<BannerSlot place>).
// The engine's states (`engine`, `isolated`) are not in `banners`: states/banners.tsx draws them. Add a kind here, in
// types.ts and in SPEC.md section 8 together.
// `phone: "every"`: on a phone every view's slot draws it, so it is seen whichever view is shown.
import type { ComponentType } from "preact";
import { RunChangedBanner, SaveFailedBanner } from "./editor/banners";
import { NotTextBanner } from "./files/banners";
import { banners, isPhone } from "./state.ts";
import {
  DownloadFailedBanner,
  EditorStateBanners,
  LogStateBanners,
  ResetBanner,
  StorageBanner,
  StoreFailedBanner,
} from "./states/banners";
import type { Banner, BannerName } from "./types.ts";

export type BannerOf<K extends BannerName> = Extract<Banner, { b: K }>;
export type Place = "files" | "editor" | "log" | "output";

const VIEWS: { [K in BannerName]: { place: Place; phone?: "every"; view: ComponentType<{ banner: BannerOf<K> }> } } = {
  reset: { place: "log", view: ResetBanner },
  storage: { place: "editor", view: StorageBanner },
  "store-failed": { place: "editor", phone: "every", view: StoreFailedBanner },
  // "Download all" is on every view's ⋯
  "download-failed": { place: "editor", phone: "every", view: DownloadFailedBanner },
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
