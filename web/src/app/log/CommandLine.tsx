// The Log pane's foot and head actions, and the phone's strip (docs/design/SPEC.md, sections 3.5 and 3.6).
//  - CommandLine: Enter runs the field through runCommand; when the command is "started" the field clears, when it is
//    "refused" the text stays and a toast says why. ↑ ↓ recall `history`, and ↓ past the newest gives back what was
//    being typed. The field stays on while the engine is on its way but not `ready`, so a draft can be typed; the
//    button is off. With no engine the field is off and keeps its text, and the button is "Start engine".
//    Nothing here is ever `disabled`: an off field is aria-disabled and read-only, an off button aria-disabled and
//    `.off`. A disabled element loses the focus to the page, and the states change under the visitor's hands (a start
//    that fails while a command is typed; "Start engine" pressed, which becomes the off "Run command" in its place).
//  - LogActions: the Log head's three links (.log-link) and one "Log actions" ⋯ menu button (.log-more); ui.css shows
//    one by a container query on the head's width (the unsplit head only), so the tabs are never clipped. The phone
//    hides the Log head, so the same logMenuItems() are the "Log ⋯" button in its strip.
//  - PhoneStrip: under the phone's top bar, on every view (the phone has no status bar): the last run, or the state's
//    words. Its children go at its right end.
import { signal } from "@preact/signals-core";
import type { ComponentChildren } from "preact";
import { useRef } from "preact/hooks";
import { isTypedInput, straightenInserted } from "../../stata/straighten.ts";
import { since } from "../editor/clock.ts";
import { editorCommands } from "../editor/commands.ts";
import { GraphsLoading, stateWords } from "../editor/StatusBar";
import { jumpLine, linesWords, memoryTitle, memoryWords, refusedRunWords, seconds, ticking } from "../editor/words.ts";
import { saveAs } from "../files.ts";
import { canClearLog, runCommand } from "../run.ts";
import { startEngine, startHint, startOffer } from "../start.ts";
import { dialog, engine, history, isPhone, lastRun, log, memory, showToast } from "../state.ts";
import { breakAsked } from "../states/predicates.ts";
import { Icon } from "../ui/Icon";
import { ignoreHeldEnter } from "../ui/keys.ts";
import { MenuButton, type MenuItem } from "../ui/Menu";
import { plainLog } from "./classify.ts";
import { openFind } from "./LogView";
import { inTurnWords, runInTurn } from "./paste.ts";
import { pastePlan, putBack, runOne } from "./pasterun.ts";

const field = signal(""); // the command line's text; a signal, as the pane may be drawn again when the layout changes
let recall = -1; // the history entry ↑ ↓ show, or -1 for the text being typed
let typed = ""; // what was being typed before ↑

async function runPasted(lines: string[]) {
  const r = await runInTurn(lines, runOne);
  const back = putBack(lines, r, field.value);
  if (back !== null) field.value = back;
  const words = inTurnWords(r);
  if (words) showToast(words, "error");
}

/** Why the engine takes no command now, in a toast. */
function sayRefused() {
  const words = refusedRunWords(engine.value.s);
  if (words) showToast(words, "error");
}

/** Run what the field holds (Enter, "Run command"). A command the engine does not take stays in the field, and a toast
 *  says why; an empty field says nothing. */
function submit() {
  if (runCommand(field.value).how === "started") {
    field.value = "";
    recall = -1;
  } else if (field.value.trim()) sayRefused();
}

export function CommandLine() {
  const input = useRef<HTMLInputElement>(null);
  const phone = isPhone.value;
  const offer = startOffer(engine.value); // not null: no engine, so the field is off and the button starts the engine
  const busy = offer === null && engine.value.s !== "ready"; // the engine takes no command now: the button is off
  const onKey = (e: KeyboardEvent) => {
    const list = history.value;
    if (offer !== null) {
      // read-only: no key changes it, and Enter says what its hint says
      if (e.key === "Enter" && !e.isComposing) {
        e.preventDefault();
        if (!e.repeat) showToast(startHint(offer), "error");
      }
      return;
    }
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      if (!e.repeat) submit();
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
  // curly quotes and dashes of it, which Stata-syntax code cannot use.
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
    const plan = pastePlan(
      el.value.slice(0, el.selectionStart ?? el.value.length),
      text,
      el.value.slice(el.selectionEnd ?? el.value.length),
    );
    if (plan.do === "ordinary") return; // no line break, or no engine (the field is read-only then)
    e.preventDefault();
    if (plan.do === "refused") {
      showToast(plan.words, "error"); // the field stays exactly as it was
      return;
    }
    field.value = "";
    recall = -1;
    if (plan.lines.length) runPasted(plan.lines);
  };
  // On a phone a tap on the unfocused field focuses it here, with preventScroll: the browser's own focus scrolls the
  // page up to the field, which iOS does before the page can stop it (app/viewport.ts). The caret goes to the end.
  const onTouchEnd = (e: TouchEvent) => {
    const el = input.current;
    if (!el || document.activeElement === el) return;
    e.preventDefault();
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
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
        placeholder={
          offer !== null ? startHint(offer) : phone ? "Type a command" : "Type a command · ↑ ↓ for earlier ones"
        }
        // off with no engine: aria-disabled and read-only, not `disabled`, so a field that has the focus keeps it
        aria-disabled={offer !== null ? "true" : undefined}
        readOnly={offer !== null}
        autocomplete="off"
        autocapitalize="off"
        // autoCorrect, not autocorrect: Preact sets a prop the element has as a property, and where a browser has
        // `autocorrect` (Safari, Firefox) it is a boolean, so the string "off" would turn it on. This spelling is no
        // property, so it is set as the attribute (HTML lowercases the name).
        autoCorrect="off"
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
        onTouchEnd={phone ? onTouchEnd : undefined}
      />
      {offer !== null ? (
        // No engine: the one action is to start it, in words on a phone too (wider than the icon; the field shrinks).
        // Where nothing can start it from here it is off, and a press says so.
        <button
          type="button"
          class={`btn start${phone ? " primary" : ""}${offer === "off" ? " off" : ""}`}
          aria-disabled={offer === "off" ? "true" : undefined}
          onKeyDown={ignoreHeldEnter}
          onClick={() => {
            if (startEngine() === "off") showToast(startHint("off"), "error");
          }}
        >
          Start engine
        </button>
      ) : phone ? (
        // A tap must not take the focus from the field, or the keyboard closes: mousedown and pointerdown are cancelled
        // (a pressed button then takes no focus), and the click gives the focus back as a fallback. aria-disabled, not
        // disabled: a tap on a disabled button lands on the page and closes the keyboard.
        <button
          type="button"
          class="send"
          aria-label="Run command"
          aria-disabled={busy || !field.value.trim() ? "true" : undefined}
          onPointerDown={keepFocus}
          onMouseDown={keepFocus}
          onKeyDown={ignoreHeldEnter}
          onClick={() => {
            if (busy) sayRefused();
            else if (field.value.trim()) submit();
            input.current?.focus({ preventScroll: true });
          }}
        >
          <Icon name="play" />
        </button>
      ) : (
        <button
          type="button"
          class={`btn${busy ? " off" : ""}`}
          aria-disabled={busy ? "true" : undefined}
          onKeyDown={ignoreHeldEnter}
          onClick={() => {
            if (busy) sayRefused();
            else submit();
          }}
        >
          Run command
        </button>
      )}
    </div>
  );
}

function downloadLog() {
  saveAs(new Blob([plainLog(log.value)], { type: "text/plain" }), "dofile.log");
}

/** Asks first (ClearLogDialog): the log and the graphs cannot be brought back. */
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

/** The Log head's actions as menu items, in the head's order. */
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
        {mem && <span title={memoryTitle}>{memoryWords(mem, true)}</span>}
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
        {breakAsked(st) && ` · ${ticking(since(st.t0))}`}
      </span>
    );
  }
  return (
    <div class="phone-strip">
      {parts}
      {!(st.s === "ready" && r) && mem && <span title={memoryTitle}>{memoryWords(mem, true)}</span>}
      <GraphsLoading />
      {children}
    </div>
  );
}
