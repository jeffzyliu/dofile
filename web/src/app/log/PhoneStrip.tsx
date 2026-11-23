// The phone's strip (docs/design/SPEC.md, section 3.6): under the phone's top bar, on every view (the phone has no
// status bar): the last run, or the state's words. Its children go at its right end.
import type { ComponentChildren } from "preact";
import { since } from "../editor/clock.ts";
import { editorCommands } from "../editor/commands.ts";
import { GraphsLoading, stateWords } from "../editor/StatusBar";
import { jumpLine, linesWords, memoryTitle, memoryWords, seconds, ticking } from "../editor/words.ts";
import { engine, lastRun, memory } from "../state.ts";
import { breakAsked } from "../states/predicates.ts";

export function PhoneStrip({ children }: { children?: ComponentChildren }) {
  const st = engine.value;
  const r = lastRun.value;
  const mem = memory.value;
  let parts: ComponentChildren;

  if (st.s === "running") {
    parts = (
      <span>
        <b>{"Running"}</b>
        {st.run.lines ? ` ${linesWords(st.run.lines)}` : ""}
      </span>
    );
  } else if (st.s === "ready" && r) {
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
