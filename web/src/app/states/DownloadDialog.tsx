// The engine's dialogs: the download prompt and its progress (S 1, S 2, S 3; phone S 8), and "dofile is open in another
// tab" (WS 6). The latter's first focus is "Close editor": taking over ends the other tab's engine and the data in its
// memory, so a stray Enter must not do it. WS 6 draws "Close this tab", but a page may close only a tab a script
// opened, so the button leaves the editor for the landing page instead (LANDING_URL; e2e/landing.spec.ts checks it).
// The take-over button is aria-disabled (and `.off`) while `other-tab-taking` (a few ms): the machine ignores a second
// press.

import { megabytes } from "../bytes.ts";
import * as eng from "../engine.ts";
import { LANDING_URL, snapshotStart } from "../env";
import { dialog, engine, engineBytes, graphicsPart } from "../state.ts";
import type { DialogOf, Stage } from "../types.ts";
import { Dialog } from "../ui/Dialog";
import { useNow } from "./clock.ts";
import { engineLoading, engineStarting } from "./predicates.ts";
import { ofTotal, secs, stageNow, stagesOf } from "./words.ts";

/** "48 MB": the download size from the build (start-files.json's compressed total, in the page's meta tag). */
const size = engineBytes ? `${megabytes(engineBytes, 0)} MB` : null;

export function DownloadDialog(_: { dialog: DialogOf<"download"> }) {
  const st = engine.value;
  if (st.s === "asking" || st.s === "none" || st.s === "declined") {
    return (
      <Dialog
        key="ask"
        title="Download the engine?"
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
  const busy = engineStarting(st);
  const now = useNow(250, busy);
  const close = () => {
    dialog.value = null;
  };
  const stages = stagesOf(snapshotStart);
  const pct = st.s === "downloading" && st.total ? Math.min(100, (100 * st.received) / st.total) : null;
  const current: Stage | null = st.s === "downloading" ? "download" : busy ? st.stage : null;
  const done = engineLoading(st) ? st.done : {};
  const elapsed = busy ? Math.max(0, (now - st.t0) / 1000) : 0;
  const stepNo = current ? stages.indexOf(current) + 1 : 0;
  // the graphics part is not in the bar (it follows the start): said under it
  const part = graphicsPart.value,
    later = part && part.state !== "landed" ? `${megabytes(part.total, 1)} MB` : null;
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
          {later && <p class="meta">{`+ ${later} of graphics after the start`}</p>}
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
                  ? s === "download" && size && !part // not the whole size when a part is still to come
                    ? `${size} · ${secs(done[s] ?? 0)}`
                    : secs(done[s] ?? 0)
                  : null;
            return (
              <li class={finished ? "done" : s === current ? "now" : "todo"}>
                {finished ? <span class="ico i-check" aria-hidden="true" /> : <span class="spin" aria-hidden="true" />}
                {stageNow[s]}
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
  const inProgress = engine.value.s === "other-tab-taking";
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
            class={`btn primary${inProgress ? " off" : ""}`}
            aria-disabled={inProgress ? "true" : undefined}
            onClick={() => {
              if (!inProgress) eng.takeOver(); // a second press does nothing, and adds no drop to the machine's record
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
