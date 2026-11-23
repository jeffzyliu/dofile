// The banners of the engine's states and of the reset (docs/design/SPEC.md, sections 3.10 and 5), drawn with
// ui/Live.tsx's <Banner>. The engine-state banners above the editor have no role="alert": the machine's `say` says each
// once, since a banner in the editor slot is display:none on a phone's other views, where an alert is never announced.
// Focus: docs/web-page-flows.md, section 1.
import { useRef } from "preact/hooks";
import { megabytes } from "../bytes.ts";
import { breakPending, resetsIn, since } from "../editor/clock.ts";
import { editorCommands } from "../editor/commands.ts";
import { tabs } from "../editor/documents.ts";
import { canRunFile } from "../editor/runnable.ts";
import { ticking } from "../editor/words.ts";
import * as eng from "../engine.ts";
import { LANDING_URL } from "../env";
import { downloadAll } from "../files.ts";
import { engine, engineBytes, isolated } from "../state/engine.ts";
import { hasFiles } from "../state/files.ts";
import { dismiss } from "../state/notices.ts";
import type { BannerOf, EngineStateOf } from "../types.ts";
import { DismissibleBanner } from "../ui/DismissibleBanner";
import { useFocusOnMount } from "../ui/focus-hooks.ts";
import { Banner } from "../ui/Live";
import { focusStable, useFocusOnLeave } from "./focus.ts";
import {
  FAILED_HEAD,
  FILES_SAFE,
  failedActions,
  GRACE_S,
  rerunPath,
  resetIn,
  resetWords,
  runningWhat,
  STOPPING_AFTER_S,
  twiceWords,
} from "./words.ts";

/** Where "Browsers that work" (S 6) goes: the landing page's section of that name (`/#browsers`). */
export const BROWSERS_URL = `${LANDING_URL}#browsers`;

const aboutMB = engineBytes ? `about ${megabytes(engineBytes, 0)} MB` : null;

const DownloadAllButton = () => (
  <button
    type="button"
    class="btn"
    disabled={!hasFiles.value}
    onClick={() => {
      downloadAll();
    }}
  >
    Download all (.zip)
  </button>
);

function FailedBanner({
  reason,
  twice,
  message,
}: {
  reason: Parameters<typeof failedActions>[0];
  twice: boolean;
  message: string;
}) {
  // failed twice: it won't start again by itself, and "Try again" would be another try the page chose not to make (S 7)
  const actions: ReturnType<typeof failedActions> = twice ? ["reload", "download-all"] : failedActions(reason);
  const w = twiceWords(reason);
  const first = (a: string) => actions[0] === a;
  const ref = useFocusOnLeave<HTMLDivElement>();
  return (
    <Banner
      kind="error"
      bannerRef={ref}
      actions={actions.map((a) => {
        switch (a) {
          case "browsers":
            return (
              <a key={a} class={`btn${first(a) ? " primary" : ""}`} href={BROWSERS_URL} target="_blank" rel="noopener">
                Browsers that work
              </a>
            );
          case "try-again":
            return (
              <button
                key={a}
                type="button"
                class={`btn${first(a) ? " primary" : ""}`}
                onClick={() => {
                  eng.start();
                }}
              >
                Try again
              </button>
            );
          case "reload":
            return (
              <button
                key={a}
                type="button"
                class={`btn${first(a) ? " primary" : ""}`}
                onClick={() => location.reload()}
              >
                Reload the page
              </button>
            );
          default:
            return <DownloadAllButton key={a} />;
        }
      })}
    >
      {twice ? (
        <>
          <b>{w.head}</b> {w.rest}
        </>
      ) : (
        <>
          <b>{FAILED_HEAD}</b> {message} {FILES_SAFE}
        </>
      )}
    </Banner>
  );
}

/** S 5. The banner goes while the prompt is open, so the focus moves to the editor first: the prompt gives it back
 *  there. */
function DeclinedBanner() {
  return (
    <Banner
      actions={
        <button
          type="button"
          class="btn primary"
          onClick={() => {
            focusStable();
            eng.ask();
          }}
        >
          Start engine
        </button>
      }
    >
      <b>The engine isn't downloaded.</b> You can open, edit, upload and download files; running code needs the engine
      {aboutMB ? ` (${aboutMB})` : ""}.
    </Banner>
  );
}

export function EditorStateBanners() {
  const st = engine.value;
  if (st.s === "declined") return <DeclinedBanner />;
  if (st.s === "failed") return <FailedBanner reason={st.reason} twice={false} message={st.message} />;
  if (st.s === "failed-twice") return <FailedBanner reason={st.reason} twice message={st.message} />;
  return null;
}

// ---- above the log ----

function RunningBanner({ t0, run }: { t0: number; run: Parameters<typeof runningWhat>[0] }) {
  const time = ticking(since(t0)); // the clock and the formatter of the status bar and the Break pill
  return (
    <Banner kind={isolated.value ? "info" : "warn"}>
      {isolated.value ? (
        <>
          Running {runningWhat(run)} · <b>{time}</b>. Break stops between commands. If one long command doesn't stop
          within {GRACE_S} s, the engine is reset: <b>the data in memory is lost</b>; your files are kept.
        </>
      ) : (
        <>
          Running {runningWhat(run)} · <b>{time}</b>. <b>Break resets the engine on this page</b>, because the page
          isn't cross-origin isolated (some hosts, or plain HTTP on a local network). The data in memory is lost; your
          files are kept.
        </>
      )}
    </Banner>
  );
}

/** "Don't reset: wait for it". It takes the focus when it appears (useFocusOnMount). */
function KeepWaitingButton() {
  const button = useRef<HTMLButtonElement>(null);
  useFocusOnMount(button);
  return (
    <button
      ref={button}
      type="button"
      class="btn"
      data-autofocus
      onClick={() => {
        eng.keepWaiting();
      }}
    >
      Don't reset: wait for it
    </button>
  );
}

/** `breaking`, from the press until the engine confirms (the run ends, or a reset). Its button and the focus come after
 *  STOPPING_AFTER_S, so a Break that lands at once flashes no button. */
function StoppingBanner({ st }: { st: EngineStateOf<"breaking"> }) {
  const ref = useFocusOnLeave<HTMLDivElement>();
  return (
    <Banner kind="warn" bannerRef={ref} actions={breakPending(st) >= STOPPING_AFTER_S && <KeepWaitingButton />}>
      <b>Stopping…</b> This command can't stop until it ends. <b>{resetIn(resetsIn(st))}</b> the data in memory is lost;
      your files are kept.
    </Banner>
  );
}

function WaitingBanner() {
  const box = useFocusOnLeave<HTMLDivElement>();
  useFocusOnMount(box);
  return (
    <Banner focusable bannerRef={box}>
      <b>Waiting for this command to end.</b> The Break is still pending: the run stops after this command, with the
      data kept. If it never ends, <b>Reset now</b> resets the engine: the data in memory is lost; your files are kept.
    </Banner>
  );
}

export function LogStateBanners() {
  const st = engine.value;
  if (st.s === "running") return <RunningBanner t0={st.t0} run={st.run} />;
  if (st.s === "waiting") return <WaitingBanner />;
  if (st.s === "breaking") return <StoppingBanner st={st} />;
  return null;
}

export function ResetBanner({ banner }: { banner: BannerOf<"reset"> }) {
  const w = resetWords(banner.kind, banner.cause, banner.reason, isolated.value);
  const path = rerunPath(banner.kind, banner.run);
  const canRun = canRunFile(engine.value, path) && tabs.value.some((t) => t.path === path && t.kind === "text");
  return (
    <DismissibleBanner
      banner={banner}
      kind={banner.kind === "crash" ? "error" : banner.kind === "break" ? "warn" : "info"}
      actions={
        path && (
          <button
            type="button"
            class="btn primary"
            disabled={!canRun}
            onClick={() => {
              editorCommands.runFile(path);
              dismiss(banner);
            }}
          >
            Run the file again
          </button>
        )
      }
    >
      <b>{w.head}</b> {w.rest}
    </DismissibleBanner>
  );
}

export function StorageBanner({ banner }: { banner: BannerOf<"storage"> }) {
  return (
    <DismissibleBanner banner={banner} kind="warn" actions={<DownloadAllButton />}>
      <b>This browser may clear your files</b> when it needs space. Download all to keep a copy.
    </DismissibleBanner>
  );
}

export function StoreFailedBanner({ banner }: { banner: BannerOf<"store-failed"> }) {
  return (
    <DismissibleBanner
      banner={banner}
      kind="error"
      actions={
        <button type="button" class="btn" onClick={() => location.reload()}>
          Reload the page
        </button>
      }
    >
      {banner.cause === "open" ? (
        <>
          <b>Your files couldn't be opened:</b> the browser refused to store them.
        </>
      ) : (
        <b>Your files couldn't be loaded into the engine.</b>
      )}{" "}
      Reload the page to try again.
    </DismissibleBanner>
  );
}

export function DownloadFailedBanner({ banner }: { banner: BannerOf<"download-failed"> }) {
  return (
    <DismissibleBanner
      banner={banner}
      kind="error"
      actions={
        <button
          type="button"
          class="btn"
          onClick={() => {
            downloadAll();
          }}
        >
          Try again
        </button>
      }
    >
      <b>Your files couldn't be downloaded.</b> This browser wouldn't open the storage where dofile keeps your files.
      Try again, or reload the page.
    </DismissibleBanner>
  );
}
