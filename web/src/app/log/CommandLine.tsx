// The Log pane's foot and head actions, and the phone's strip (docs/design/SPEC.md, sections 3.5 and 3.6).
//  - CommandLine (.cmdline): prompt ".", the input aria-label="Command" (placeholder "Type a command · ↑ ↓ for earlier
//    ones"; phone: "Type a command"), "Run command" (not on a phone, as PH draws it: the keyboard's Enter runs). Enter
//    runs through run.ts's runCommand(text): when it answers `accepted` (it runs, or is queued while there is no engine)
//    the field clears; when refused (the page load, a start or a run in progress) the text stays. ↑ ↓ recall `history`,
//    and ↓ past the newest gives back what was being typed. On a phone it shows on the Log view only (App.tsx).
//    Pasted text with line breaks runs each line in turn (log/paste.ts says the rules: the next line only once the one
//    before has ended; the lines stop at one that is refused, does not run, or ends with an error, and before a block's
//    line; a toast says how many were not run, and a refused line goes back into the field).
//  - LogActions: the Log head's "Find" (log/find.ts) and "Download log" (the runs' text only, as dofile.log; no head,
//    run-head or note). App.tsx adds Split / Unsplit after them. The phone hides the Log head, so the same two are
//    logMenuItems(), which the phone's ⋯ shows on the Log view.
//  - PhoneStrip: under the phone's top bar (PH), on every view (the phone has no status bar): after a run "r(111)",
//    "line 17 · 0.38 s", "Mem 612 MB", "Go to line 17"; while running "Running lines 14–15", "Mem 612 MB"; otherwise the
//    state's words (the status bar's).
import { effect, signal } from "@preact/signals-core";
import type { ComponentChildren } from "preact";
import { useRef } from "preact/hooks";
import { since } from "../editor/clock.ts";
import { editorCommands } from "../editor/commands.ts";
import { stateWords } from "../editor/StatusBar";
import { jumpLine, linesWords, memoryWords, seconds } from "../editor/words.ts";
import { saveAs } from "../files.ts";
import { runCommand } from "../run.ts";
import { engine, history, isPhone, lastRun, log, memory, showToast } from "../state.ts";
import type { EngineState } from "../types.ts";
import type { MenuItem } from "../ui/Menu";
import { plainLog } from "./classify.ts";
import { openFind } from "./LogView";
import { inTurnWords, pastedLines, type RunOne, runInTurn } from "./paste.ts";

const field = signal(""); // the command line's text (a signal: the pane may be drawn again when the layout changes)
let recall = -1; // the history entry ↑ ↓ show, or -1 for the text being typed
let typed = ""; // what was being typed before ↑

/** The states in which a command queued for an engine that is not there is dropped: it will not run. */
const DROPPED = new Set<EngineState["s"]>(["declined", "failed", "failed-twice", "other-tab-idle", "other-tab-taking"]);

/** Wait for the end of a command just accepted: its rc once it has run (lastRun is a new run), or null when it was
 *  queued for an engine that then did not start. Resolved in a microtask after the step of the state machine that ended
 *  it (a run cannot start inside that step; the step is synchronous, so it is over by then), so the next pasted line
 *  starts before the page takes any other input: a Run or an Enter pressed between two pasted lines waits for the next
 *  line's run and is refused as during any run. The run's after-run reads (run.ts refreshData) may still be answering;
 *  the engine takes them in turn. */
function whenEnds(before: unknown): Promise<number | null> {
  return new Promise((done) => {
    let stop = () => {};
    let over = false;
    const end = (rc: number | null) => {
      if (over) return;
      over = true;
      queueMicrotask(() => {
        stop();
        done(rc);
      });
    };
    stop = effect(() => {
      const r = lastRun.value;
      if (r && r !== before) end(r.rc);
      else if (DROPPED.has(engine.value.s)) end(null);
    });
  });
}

/** One pasted line, as Enter would run it. */
const runOne: RunOne = (line) => {
  const before = lastRun.value;
  const { accepted } = runCommand(line);
  return { accepted, done: accepted ? whenEnds(before) : Promise.resolve(null) };
};

async function runPasted(lines: string[]) {
  const r = await runInTurn(lines, runOne);
  if (r.stop?.why === "refused" && !field.value) field.value = lines[r.stop.line - 1];
  const words = inTurnWords(r);
  if (words) showToast(words);
}

/** Run what the field holds (Enter, "Run command"). */
function submit() {
  if (runCommand(field.value).accepted) {
    field.value = "";
    recall = -1;
  }
}

export function CommandLine() {
  const input = useRef<HTMLInputElement>(null);
  const phone = isPhone.value;
  const onKey = (e: KeyboardEvent) => {
    const list = history.value;
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      submit();
    } else if (e.key === "ArrowUp" && list.length) {
      e.preventDefault();
      if (recall === -1) {
        typed = field.value;
        recall = list.length;
      }
      recall = Math.max(0, recall - 1);
      field.value = list[recall];
    } else if (e.key === "ArrowDown" && recall !== -1) {
      e.preventDefault();
      recall++;
      if (recall >= list.length) {
        recall = -1;
        field.value = typed;
      } else field.value = list[recall];
    }
  };
  const onPaste = (e: ClipboardEvent) => {
    const el = e.currentTarget as HTMLInputElement;
    const text = e.clipboardData?.getData("text/plain") ?? "";
    const lines = pastedLines(
      el.value.slice(0, el.selectionStart ?? el.value.length),
      text,
      el.value.slice(el.selectionEnd ?? el.value.length),
    );
    if (!lines) return; // an ordinary paste
    e.preventDefault();
    field.value = "";
    recall = -1;
    if (lines.length) runPasted(lines);
  };
  return (
    <div class="cmdline">
      <span class="prompt" aria-hidden="true">
        .
      </span>
      <input
        ref={input}
        class="field"
        type="text"
        aria-label="Command"
        placeholder={phone ? "Type a command" : "Type a command · ↑ ↓ for earlier ones"}
        autocomplete="off"
        autocapitalize="off"
        spellcheck={false}
        enterKeyHint="go"
        value={field.value}
        onInput={(e) => {
          field.value = (e.target as HTMLInputElement).value;
          recall = -1;
        }}
        onKeyDown={onKey}
        onPaste={onPaste}
      />
      {!phone && (
        <button type="button" class="btn" onClick={submit}>
          Run command
        </button>
      )}
    </div>
  );
}

function downloadLog() {
  saveAs(new Blob([plainLog(log.value)], { type: "text/plain" }), "dofile.log");
}

export const LogActions = () => (
  <>
    <button type="button" class="head-link" onClick={(e) => openFind(e.currentTarget as HTMLElement)}>
      Find
    </button>
    <button type="button" class="head-link" onClick={downloadLog}>
      Download log
    </button>
  </>
);

/** The phone's ⋯ menu items for the Log view: Find and Download log, as LogActions does them. */
export const logMenuItems = (): MenuItem[] => [
  { label: "Find", onSelect: () => openFind(null) },
  { label: "Download log", onSelect: downloadLog },
];

export function PhoneStrip() {
  const st = engine.value;
  const r = lastRun.value;
  const mem = memory.value;
  let parts: ComponentChildren;
  if (st.s === "running")
    parts = (
      <span>
        <b>{"Running"}</b>
        {st.run.lines ? ` ${linesWords(st.run.lines)}` : ""}
      </span>
    );
  else if (st.s === "ready" && r) {
    const jump = jumpLine(r);
    parts = (
      <>
        {r.rc !== 0 && <span class="rc-err">{`r(${r.rc})`}</span>}
        <span>
          {r.line !== null && r.rc !== 0 && r.kind !== "command"
            ? `${r.rc === 1 ? "before line" : "line"} ${r.line} · ${seconds(r.seconds)}`
            : `${r.rc === 0 ? "Last run " : ""}${seconds(r.seconds)}`}
        </span>
        {mem && <span>{memoryWords(mem, true)}</span>}
        <span class="spacer" />
        {jump !== null && (
          <button type="button" class="jump" onClick={() => editorCommands.goToLine(jump, r.path)}>
            {`Go to line ${jump}`}
          </button>
        )}
      </>
    );
  } else {
    const [bold, rest] = stateWords(st);
    parts = (
      <span>
        {bold && <b>{bold}</b>}
        {rest}
        {(st.s === "breaking" || st.s === "waiting") && ` · ${seconds(since(st.t0))}`}
      </span>
    );
  }
  return (
    <div class="phone-strip">
      {parts}
      {!(st.s === "ready" && r) && mem && <span>{memoryWords(mem, true)}</span>}
    </div>
  );
}
