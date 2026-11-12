// The engine's dialogs: the download prompt and its progress (S 1, S 2, S 3; phone S 8), and "dofile is open in another
// tab" (WS 6). Step 3 built them as far as the start and the tab lock need (the words of the drawings, the actions).
// STEP 4d finished them: S 2's stage list with each stage's time and S 3, the progress bar's aria-valuetext as the
// stages, the times ("14.2 of 48 MB · 6 s"); the take-over button is aria-disabled while `other-tab-taking`.
// "dofile is open in another tab" (WS 6): "Close editor" (the first focus: taking over ends the other tab's engine and
// the data in its memory, so a stray Enter must not do it) and "Use dofile in this tab". WS 6 draws "Close this tab",
// but a page may close only a tab a script opened, so the button leaves the editor for the landing page instead.
// That page is step 5's: until it exists, LANDING_URL is a dead link (step 5 checks this button).
// While a take-over is in progress the engine is `other-tab-taking` (a few milliseconds): the machine ignores a second
// press of "Use dofile in this tab". 4d may mark the button aria-disabled then, with the same label.

import type { DialogOf } from "../dialogs";
import * as eng from "../engine.ts";
import { LANDING_URL, snapshotStart } from "../env";
import { dialog, engine, engineBytes } from "../state.ts";
import type { Stage } from "../types.ts";
import { Dialog } from "../ui/Dialog";
import { useNow } from "./clock.ts";
import { ofTotal, secs, stageNow } from "./words.ts";

/** "48 MB": the download size from the build (start-files.json's compressed total, in the page's meta tag). */
export const mb = (bytes: number) => `${Math.round(bytes / 1e6)} MB`;
const size = engineBytes ? mb(engineBytes) : null;

export function DownloadDialog({ dialog: d }: { dialog: DialogOf<"download"> }) {
  const st = engine.value;
  if (st.s === "asking" || st.s === "none" || st.s === "declined") {
    return (
      <Dialog
        key="ask"
        title={d.forRun ? "Download the engine to run code" : "Download the engine?"}
        describedBy="download-what"
        actions={
          <>
            <button type="button" class="btn" onClick={eng.decline}>
              Not now
            </button>
            <button
              type="button"
              class="btn primary"
              data-autofocus
              onClick={() => {
                eng.start();
              }}
            >
              {size ? `Download ${size}` : "Download"}
            </button>
          </>
        }
      >
        <p id="download-what">
          dofile runs your code inside this page, so the first time your browser downloads the engine
          {size ? (
            <>
              : <b>about {size}</b>
            </>
          ) : null}
          . Later visits use the copy your browser keeps and start in a few seconds.
        </p>
        <p class="meta">On a phone, Wi-Fi is best. Your files stay in this browser; they are never sent anywhere.</p>
      </Dialog>
    );
  }
  return <ProgressDialog />;
}

/** S 2 and S 3 (phone S 8): downloading, then the stages. "Edit files while it loads" only closes the dialog. */
function ProgressDialog() {
  const st = engine.value;
  const busy = st.s === "downloading" || st.s === "starting-list" || st.s === "starting-worker";
  const now = useNow(250, busy);
  const close = () => {
    dialog.value = null;
  };
  const stages = eng.stagesOf(snapshotStart);
  const pct = st.s === "downloading" && st.total ? Math.min(100, (100 * st.received) / st.total) : null;
  const current: Stage | null = st.s === "downloading" ? "download" : busy ? (st as { stage: Stage }).stage : null;
  const done = st.s === "starting-list" || st.s === "starting-worker" ? st.done : {};
  const elapsed = busy ? Math.max(0, (now - (st as { t0: number }).t0) / 1000) : 0;
  const stepNo = current ? stages.indexOf(current) + 1 : 0;
  return (
    <Dialog
      key="progress"
      title="Getting the engine ready"
      onCancel={close}
      actions={
        <>
          {st.s === "downloading" && (
            <button type="button" class="btn quiet" onClick={eng.stopDownload}>
              Stop download
            </button>
          )}
          <span class="spacer" />
          <button type="button" class="btn" data-autofocus onClick={close}>
            Edit files while it loads
          </button>
        </>
      }
    >
      {st.s === "downloading" ? (
        <>
          <div class="row">
            <b>Downloading</b>
            <span class="spacer" />
            <span>{st.total ? `${ofTotal(st.received, st.total)} · ${secs(elapsed)}` : secs(elapsed)}</span>
          </div>
          <div
            class="progress"
            role="progressbar"
            aria-label="Download"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pct ?? 0)}
            aria-valuetext={`${stageNow.download}, step 1 of ${stages.length}`}
          >
            <i style={{ width: `${pct ?? 0}%` }} />
          </div>
        </>
      ) : current ? (
        <div class="row">
          <b>{stageNow[current]}</b>
          <span class="spacer" />
          <span>
            step {stepNo} of {stages.length} · {secs((done[current] ?? 0) + elapsed)}
          </span>
        </div>
      ) : null}
      {current && (
        <ol class="stages">
          {stages.map((s) => {
            const finished = done[s] !== undefined && s !== current;
            const when =
              s === "download" && st.s === "downloading" && st.total
                ? ofTotal(st.received, st.total)
                : finished
                  ? s === "download" && size
                    ? `${size} · ${secs(done[s] ?? 0)}`
                    : secs(done[s] ?? 0)
                  : null;
            return (
              <li class={finished ? "done" : s === current ? "now" : "todo"}>
                {finished ? <span class="ico i-check" aria-hidden="true" /> : <span class="spin" aria-hidden="true" />}
                {eng.stageWords[s]}
                {when && <span class="when">{when}</span>}
              </li>
            );
          })}
        </ol>
      )}
    </Dialog>
  );
}

export function OtherTabDialog(_: { dialog: DialogOf<"other-tab"> }) {
  const taking = engine.value.s === "other-tab-taking";
  return (
    <Dialog
      title="dofile is open in another tab"
      role="alertdialog"
      describedBy="other-tab-why"
      actions={
        <>
          <button
            type="button"
            class="btn"
            data-autofocus
            onClick={() => {
              location.assign(LANDING_URL);
            }}
          >
            Close editor
          </button>
          <button
            type="button"
            class="btn primary"
            aria-disabled={taking ? "true" : undefined}
            onClick={() => {
              if (!taking) eng.takeOver();
            }}
          >
            Use dofile in this tab
          </button>
        </>
      }
    >
      <p id="other-tab-why">
        Only one tab can use your files at a time, so they are not overwritten. The other tab keeps its data until you
        take over here.
      </p>
    </Dialog>
  );
}
