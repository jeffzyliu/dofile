// The Log pane's command line (docs/design/SPEC.md, section 3.5): the field, its history (↑ ↓) and its Run button.
import { signal } from "@preact/signals-core";
import { useRef } from "preact/hooks";
import { isTypedInput, straightenInserted } from "../../stata/straighten.ts";
import { refusedRunWords } from "../editor/words.ts";
import { runCommand } from "../run.ts";
import { startEngine, startHint, startOffer } from "../start.ts";
import { engine } from "../state/engine.ts";
import { history } from "../state/run.ts";
import { isPhone, showToast } from "../state.ts";
import { takesRun } from "../states/predicates.ts";
import { Icon } from "../ui/Icon";
import { ignoreHeldEnter } from "../ui/keys.ts";
import { inTurnWords, runInTurn } from "./paste.ts";
import { pastePlan, putBack, runOne } from "./pasterun.ts";

// the command line's text; a signal, as the pane may be drawn again when the layout changes
const field = signal("");
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
  } else if (field.value.trim()) {
    sayRefused();
  }
}

export function CommandLine() {
  const input = useRef<HTMLInputElement>(null);
  const phone = isPhone.value;
  // not null: no engine, so the field is off and the button starts the engine
  const offer = startOffer(engine.value);
  // the engine takes no command now: the button is off
  const busy = offer === null && !takesRun(engine.value);

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
      } else {
        field.value = list[recall];
      }
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

    // no line break, or no engine (the field is read-only then)
    if (plan.do === "ordinary") return;
    e.preventDefault();

    if (plan.do === "refused") {
      // the field stays exactly as it was
      showToast(plan.words, "error");
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
        // off with no engine: aria-disabled and read-only, not `disabled`, so a field that has the focus keeps it (a
        // disabled element loses the focus to the page, and the states change under the visitor's hands: a start that
        // fails while a command is typed, "Start engine" pressed, which becomes the off "Run command" in its place)
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
            if (busy) {
              sayRefused();
            } else if (field.value.trim()) {
              submit();
            }

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
            if (busy) {
              sayRefused();
            } else {
              submit();
            }
          }}
        >
          Run command
        </button>
      )}
    </div>
  );
}
