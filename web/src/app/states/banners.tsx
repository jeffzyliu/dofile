// STEP 4d: the banners of the engine's states and of the reset (docs/design/SPEC.md, sections 3.10 and 5), drawn with
// ui/Live.tsx's <Banner>.
//  - EditorStateBanners: above the editor, from `engine` alone (not in `banners`): no engine (`declined`, S 5; its
//    button is "Start engine", as the toolbar's, and opens the download prompt), did not
//    start (`failed`, S 6), failed twice (S 7); neither has role="alert": the machine's `say` says each once in the live
//    region (a banner in the editor slot is display:none on a phone's other views, where an alert is never announced). The action follows the `reason` (words.ts
//    failedActions), never the text: no-wasm "Browsers that work"; download "Try again"; updated "Reload the
//    page"; unknown both. "Download all (.zip)" is off while the store has no file (`hasFiles`).
//  - LogStateBanners: above the log, from `engine` and `isolated`: running (E?r; with no cross-origin isolation S 11 says
//    what Break does instead), stopping (S 9, once the Break has been pending 1 s, takes the focus on "Don't reset: wait
//    for it"; at 0 s it says the reset is under way), waiting (S 9b, takes the focus). With no cross-origin isolation the
//    running banner is a warning, as S 11 draws it.
//  - ResetBanner { b: "reset", reason, kind, run } above the log (P/Notices): "Run the file again" only when the reset cut
//    a run of a file and the visitor did not ask for it (words.ts rerunPath); it runs that file (editorCommands.runFile(path),
//    on while the engine is ready and the file is open as text). "Dismiss". engine.ts adds it on a reset.
//  - StorageBanner { b: "storage" } above the editor (S 19).
//  - DownloadFailedBanner { b: "download-failed" } above the editor (on a phone on every view; no role="alert": files.ts
//    says it once in the live region).
// Focus: a banner with controls hands it on as it goes (focus.ts useFocusOnLeave); one that takes it does so on mount
// (useFocusOnMount). docs/web-page-flows.md, section 1.
// The words the spec does not give are drafts (words.ts; SPEC section 8, "Step 4d: draft words").
import { useRef } from "preact/hooks";
import type { BannerOf } from "../banners";
import { editorCommands } from "../editor/commands.ts";
import * as eng from "../engine.ts";
import { LANDING_URL } from "../env";
import { downloadAll } from "../files.ts";
import { dismiss, engine, engineBytes, hasFiles, isolated, tabs } from "../state.ts";
import { useFocusOnMount } from "../ui/focus-hooks.ts";
import { Banner } from "../ui/Live";
import { useNow } from "./clock.ts";
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
  secs,
  twiceWords,
} from "./words.ts";

/** Where "Browsers that work" (S 6) goes (OQ-18, a proposal): the landing page's section of that name (`/#browsers`). */
export const BROWSERS_URL = `${LANDING_URL}#browsers`;

const aboutMB = engineBytes ? `about ${Math.round(engineBytes / 1e6)} MB` : null;

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

/** S 5. The banner goes while the prompt is open, so the focus moves to the editor first: the prompt gives it back there. */
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
  const now = useNow(200);
  const time = secs(Math.max(0, (now - t0) / 1000));
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

function StoppingBanner({ resetAt }: { resetAt: number }) {
  const now = useNow(200);
  const left = Math.max(0, Math.ceil((resetAt - now) / 1000));
  const button = useRef<HTMLButtonElement>(null);
  const ref = useFocusOnLeave<HTMLDivElement>();
  useFocusOnMount(button);
  return (
    <Banner
      kind="warn"
      bannerRef={ref}
      actions={
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
      }
    >
      <b>Stopping…</b> This command can't stop until it ends. <b>{resetIn(left)}</b> the data in memory is lost; your
      files are kept.
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
  if (st.s === "breaking") return <BreakingBanner t0={st.t0} resetAt={st.resetAt} run={st.run} />;
  return null;
}

/** `breaking`: the running banner for the first second (a run that stops at once never shows S 9), then S 9. */
function BreakingBanner({ t0, resetAt, run }: { t0: number; resetAt: number; run: Parameters<typeof runningWhat>[0] }) {
  const now = useNow(200);
  const pending = GRACE_S - (resetAt - now) / 1000;
  return pending >= STOPPING_AFTER_S ? <StoppingBanner resetAt={resetAt} /> : <RunningBanner t0={t0} run={run} />;
}

export function ResetBanner({ banner }: { banner: BannerOf<"reset"> }) {
  const w = resetWords(banner.kind, banner.reason, isolated.value);
  const path = rerunPath(banner.kind, banner.run);
  const canRun = engine.value.s === "ready" && tabs.value.some((t) => t.path === path && t.kind === "text");
  const ref = useFocusOnLeave<HTMLDivElement>();
  return (
    <Banner
      bannerRef={ref}
      kind={banner.kind === "crash" ? "error" : banner.kind === "break" ? "warn" : "info"}
      actions={
        <>
          {path && (
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
          )}
          <button type="button" class="btn quiet" onClick={() => dismiss(banner)}>
            Dismiss
          </button>
        </>
      }
    >
      <b>{w.head}</b> {w.rest}
    </Banner>
  );
}

export function StorageBanner({ banner }: { banner: BannerOf<"storage"> }) {
  const ref = useFocusOnLeave<HTMLDivElement>();
  return (
    <Banner
      kind="warn"
      bannerRef={ref}
      actions={
        <>
          <DownloadAllButton />
          <button type="button" class="btn quiet" onClick={() => dismiss(banner)}>
            Dismiss
          </button>
        </>
      }
    >
      <b>This browser may clear your files</b> when it needs space. Download all to keep a copy.
    </Banner>
  );
}

export function DownloadFailedBanner({ banner }: { banner: BannerOf<"download-failed"> }) {
  const ref = useFocusOnLeave<HTMLDivElement>();
  return (
    <Banner
      kind="error"
      bannerRef={ref}
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
      <b>Your files couldn't be downloaded.</b> This browser wouldn't open the storage where dofile keeps your files.
      Try again, or reload the page.
    </Banner>
  );
}
