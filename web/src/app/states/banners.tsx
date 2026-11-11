// STEP 4d: the banners of the engine's states and of the reset (docs/design/SPEC.md, sections 3.10 and 5). Draw each
// with ui/Live.tsx's <Banner>.
//  - EditorStateBanners: above the editor, from `engine` alone (not in `banners`): no engine (`declined`, S 5), did not
//    start (`failed`, S 6, role alert), failed twice (S 7). `failed` has `reason` ("updated": the site changed since the
//    page loaded, offer "Reload the page"; "download": "Try again", engine.ts start(); "memory"; "no-wasm"; "unknown") and
//    `message`; `failed-twice` has `reason` and `message` too. Decide from `reason`, never from the text.
//  - LogStateBanners: above the log, from `engine` and `isolated`: running (E?r), stopping (S 9, after 1 s), waiting
//    (S 9b, takes the focus), "Break resets the engine on this page" (not isolated, with the first run).
//  - ResetBanner { b: "reset", reason, kind } above the log (P/Notices): "The engine was reset: <reason>." / "Run the file
//    again" (editor/commands.ts runFile), "Dismiss". `kind` words it: "break" (Break ran out of time, or the page cannot
//    ask a run to stop), "crash", "user" (Reset, "Reset now"). engine.ts adds it (the machine's effect add-reset-banner)
//    on a reset, unless the worker was still starting.
//  - StorageBanner { b: "storage" } above the editor (S 19): files.ts adds it, once per visit, when persisted() is false
//    and the files change. MemoryBanner { b: "memory" }: not in P1 (OQ-8).
//  - DownloadFailedBanner { b: "download-failed" } above the editor (on a phone on every view): built in step 3, so a failed "Download all" shows
//    (files.ts adds it, one at a time, and removes it when a later download works). 4d may restyle or reword it with the
//    other storage states (OQ-16). No role="alert": files.ts says it once in the live region.
import type { BannerOf } from "../banners";
import { downloadAll } from "../files.ts";
import { dismiss } from "../state.ts";
import { Banner } from "../ui/Live";

export const EditorStateBanners = () => null;
export const LogStateBanners = () => null;
export const ResetBanner = (_: { banner: BannerOf<"reset"> }) => null;
export const StorageBanner = (_: { banner: BannerOf<"storage"> }) => null;
export const MemoryBanner = (_: { banner: BannerOf<"memory"> }) => null;

export const DownloadFailedBanner = ({ banner }: { banner: BannerOf<"download-failed"> }) => (
  <Banner
    kind="error"
    actions={
      <>
        <button
          type="button"
          class="btn"
          onClick={() => {
            downloadAll();
          }}
        >
          Try again
        </button>
        <button type="button" class="btn quiet" onClick={() => dismiss(banner)}>
          Dismiss
        </button>
      </>
    }
  >
    <b>Your files couldn't be downloaded:</b> this browser didn't open the storage where dofile keeps them.
  </Banner>
);
