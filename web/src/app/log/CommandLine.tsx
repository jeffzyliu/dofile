// The Log pane's foot and head actions, and the phone's strip (docs/design/SPEC.md, sections 3.5 and 3.6).
//  - CommandLine (.cmdline): prompt ".", the input aria-label="Command" (placeholder "Type a command · ↑ ↓ for earlier
//    ones"; phone: "Type a command"), "Run command" (a text button; on a phone a compact icon button, .send, that keeps
//    the field's focus so the keyboard stays open, and has aria-disabled while the field is empty). Typed curly quotes
//    and the em dash become ' " and -- (stata/straighten.ts; a paste is left as pasted). Enter
//    runs through run.ts's runCommand(text): when it answers `accepted` (it runs, or is queued while there is no engine)
//    the field clears; when refused (the page load, a start or a run in progress) the text stays. ↑ ↓ recall `history`,
//    and ↓ past the newest gives back what was being typed. On a phone it shows on the Log view only (App.tsx).
//    Pasted text with line breaks runs each line in turn (log/paste.ts says the rules: the next line only once the one
//    before has ended; the lines stop at one that is refused, does not run, or ends with an error, and before a block's
//    line; a toast says how many were not run, and a refused line goes back into the field).
//  - LogActions: the Log head's "Find" (log/find.ts) and "Download log" (the runs' text only, as dofile.log; no head,
//    run-head or note) and "Clear…" (asks first: ClearLogDialog; disabled when canClearLog() is false). It draws both forms: the three links (.log-link) and one "Log actions" ⋯ menu button
//    (.log-more, logMenuItems()); ui.css shows one by a container query on the head's width (the unsplit head, .tabbed, only: the
//    split layout's Log head always has room), so the tabs are never clipped.
//    App.tsx adds Split / Unsplit after them, always visible (icon and word; the word goes first when the head is very narrow). The phone hides the Log head, so the same logMenuItems()
//    are the phone's "Log ⋯" button in the strip, shown on the Log view.
//  - PhoneStrip: under the phone's top bar (PH), on every view (the phone has no status bar): after a run "r(111)",
//    "line 17 · 0.38 s", "Mem 612 MB", "Go to line 17"; while running "Running lines 14–15", "Mem 612 MB"; otherwise the
//    state's words (the status bar's). Its children go at its right end (App.tsx: "Files ⋯" on the Files view, "Log ⋯" on the Log view).
import { signal } from "@preact/signals-core";
import type { ComponentChildren } from "preact";
import { useRef } from "preact/hooks";
import { isTypedInput, straightenInserted } from "../../stata/straighten.ts";
import { since } from "../editor/clock.ts";
import { editorCommands } from "../editor/commands.ts";
import { stateWords } from "../editor/StatusBar";
import { jumpLine, linesWords, memoryWords, seconds } from "../editor/words.ts";
import { saveAs } from "../files.ts";
import { canClearLog, runCommand } from "../run.ts";
import { dialog, engine, history, isPhone, lastRun, log, memory, showToast } from "../state.ts";
import { Icon } from "../ui/Icon";
import { MenuButton, type MenuItem } from "../ui/Menu";
import { plainLog } from "./classify.ts";
import { openFind } from "./LogView";
import { inTurnWords, pastedLines, runInTurn } from "./paste.ts";
import { runOne } from "./pasterun.ts";

const field = signal(""); // the command line's text (a signal: the pane may be drawn again when the layout changes)
let recall = -1; // the history entry ↑ ↓ show, or -1 for the text being typed
let typed = ""; // what was being typed before ↑

async function runPasted(lines: string[]) {
  const r = await runInTurn(lines, runOne);
  if (r.stop?.why === "refused" && !field.value) field.value = lines[r.stop.line - 1];
  const words = inTurnWords(r);
  if (words) showToast(words, "error");
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
  // Typed text only (not a paste or a drop, and not what is already in the field): a phone's Smart Punctuation makes
  // curly quotes and dashes of what was typed, which Stata-syntax code cannot use (stata/straighten.ts).
  const onInput = (e: Event) => {
    const el = e.currentTarget as HTMLInputElement;
    const ie = e as InputEvent;
    const data = ie.data ?? ie.dataTransfer?.getData("text/plain") ?? "";
    const fixed =
      isTypedInput(ie.inputType) && data ? straightenInserted(el.value, el.selectionStart ?? 0, data) : null;
    if (fixed) {
      el.value = fixed.value;
      el.setSelectionRange(fixed.caret, fixed.caret);
    }
    field.value = el.value;
    recall = -1;
  };
  const keepFocus = (e: Event) => e.preventDefault();
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
        autocorrect="off"
        spellcheck={false}
        enterKeyHint="go"
        inputMode="text"
        data-1p-ignore
        data-lpignore="true"
        data-form-type="other"
        value={field.value}
        onInput={onInput}
        onKeyDown={onKey}
        onPaste={onPaste}
      />
      {phone ? (
        // A tap must not take the focus from the field, or the keyboard closes: mousedown and pointerdown are cancelled
        // (a pressed button then takes no focus), and the click gives the focus back as a fallback. aria-disabled, not
        // disabled: a tap on a disabled button lands on the page and closes the keyboard.
        <button
          type="button"
          class="send"
          aria-label="Run command"
          aria-disabled={field.value.trim() ? undefined : "true"}
          onPointerDown={keepFocus}
          onMouseDown={keepFocus}
          onClick={() => {
            if (field.value.trim()) submit();
            input.current?.focus({ preventScroll: true });
          }}
        >
          <Icon name="play" />
        </button>
      ) : (
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

/** "Clear log…" asks first (ClearLogDialog): the log and the graphs cannot be brought back. */
const askClearLog = () => {
  dialog.value = { d: "clear-log" };
};

export const LogActions = () => (
  <>
    <button type="button" class="head-link log-link" onClick={(e) => openFind(e.currentTarget as HTMLElement)}>
      Find
    </button>
    <button type="button" class="head-link log-link" onClick={downloadLog}>
      Download log
    </button>
    <button
      type="button"
      class="head-link log-link danger"
      aria-label="Clear log…"
      disabled={!canClearLog()}
      onClick={askClearLog}
    >
      Clear…
    </button>
    <MenuButton label="Log actions" class="head-link icon log-more" items={logMenuItems}>
      <Icon name="more" />
    </MenuButton>
  </>
);

/** The Log head's actions as menu items, in the head's order (as LogActions does them): the phone's "Log ⋯" button in the
 *  strip, since the phone hides the Log head. */
export const logMenuItems = (): MenuItem[] => [
  { label: "Find", onSelect: () => openFind(null) },
  { label: "Download log", onSelect: downloadLog },
  { label: "Clear log…", danger: true, disabled: !canClearLog(), onSelect: askClearLog },
];

export function PhoneStrip({ children }: { children?: ComponentChildren }) {
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
            : `${r.rc === 0 ? "Last run: " : ""}${seconds(r.seconds)}`}
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
      {children}
    </div>
  );
}
