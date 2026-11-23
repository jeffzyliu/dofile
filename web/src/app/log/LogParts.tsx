// What the log draws from its parts (run-parts.ts) and its other items: Find's marks, graph links, `help x` links, Go to
// line.
import type { ComponentChildren } from "preact";
import { editorCommands } from "../editor/commands.ts";
import { refusedRunWords } from "../editor/words.ts";
import { graphOpenName } from "../output/format.ts";
import { cardTheme } from "../output/GraphTab";
import { runCommand } from "../run.ts";
import { startFirst, startOffer } from "../start.ts";
import { engine, graphs, isPhone, outputTab, selectGraph, showFullSize, showToast } from "../state.ts";
import type { Graph } from "../types.ts";
import { Icon } from "../ui/Icon";
import { ignoreHeldEnter } from "../ui/keys.ts";
import { hintParts } from "./classify.ts";
import { matches } from "./find.ts";
import type { RunPart } from "./run-parts.ts";

/** The marks of Find: a counter over the whole render, so each match has its number. */
export type Marker = { n: number; query: string; at: number };

export function marked(text: string, m: Marker): ComponentChildren {
  const found = matches(text, m.query);
  if (!found.length) return text;
  const out: ComponentChildren[] = [];
  let last = 0;
  for (const [from, to] of found) {
    out.push(text.slice(last, from));
    const k = m.n++;
    out.push(
      <mark key={k} class={k === m.at ? "on" : undefined} data-find={k}>
        {text.slice(from, to)}
      </mark>,
    );
    last = to;
  }
  out.push(text.slice(last));
  return out;
}

export function GraphLink({ g }: { g: Graph }) {
  const all = graphs.value;
  if (isPhone.value)
    return (
      <button
        type="button"
        class="inline-graph"
        data-theme={cardTheme(g)}
        aria-label={graphOpenName(g, all)}
        onClick={() => {
          selectGraph(g.n);
          showFullSize();
        }}
      >
        <img src={`data:image/png;base64,${g.png}`} alt="" />
      </button>
    );
  return (
    <button
      type="button"
      class="glink"
      onClick={() => {
        selectGraph(g.n);
        outputTab.value = "graph";
      }}
    >
      <Icon name="graph" />
      {`graph ${g.n}`}
    </button>
  );
}

const Jump = ({ line, path }: { line: number; path?: string }) => (
  <button type="button" class="jump" onClick={() => editorCommands.goToLine(line, path)}>
    {`Go to line ${line}`}
  </button>
);

/** A hint's `help x` link: it runs the command. With no engine it is off, aria-disabled and `.off`, still focusable,
 *  and a press only says why in a toast. While a run or a start is on, the command is refused and the toast says why. A
 *  held Enter's repeats are ignored (ui/keys.ts), so the toast shows once and `help x` is not run again when the engine
 *  is free. */
function HelpLink({ command, children }: { command: string; children: ComponentChildren }) {
  const offer = startOffer(engine.value);
  const off = offer !== null;
  return (
    <button
      type="button"
      class={`help-link${off ? " off" : ""}`}
      aria-disabled={off ? "true" : undefined}
      onKeyDown={ignoreHeldEnter}
      onClick={() => {
        if (offer !== null) showToast(startFirst(offer, `see ${command}`), "error");
        else if (runCommand(command).how === "refused") {
          const words = refusedRunWords(engine.value.s);
          if (words) showToast(words, "error");
        }
      }}
    >
      {children}
    </button>
  );
}

/** A hint line: its bold words and its `help x` link. */
const hintLine = (text: string, m: Marker) =>
  hintParts(text).map((p, i) =>
    p.t === "bold" ? (
      <b key={i}>{marked(p.text, m)}</b>
    ) : p.t === "help" ? (
      <HelpLink key={i} command={p.text}>
        {marked(p.text, m)}
      </HelpLink>
    ) : (
      marked(p.text, m)
    ),
  );

/** The parts of one run's text, drawn in order: a plain function that LogView calls, not a component, so every match of
 *  Find is numbered while LogView renders and counted before FindBar uses the count (a child component would render
 *  after LogView had read it). */
export function drawRunParts(parts: readonly RunPart[], m: Marker): ComponentChildren {
  return parts.map((p) => drawPart(p, m));
}

function drawPart(p: RunPart, m: Marker): ComponentChildren {
  switch (p.t) {
    case "line":
      return (
        <span key={p.key} class={p.kind === "out" ? undefined : p.kind}>
          {p.kind === "hint" ? hintLine(p.text, m) : marked(p.text, m)}
        </span>
      );
    case "explain":
      return (
        <span key={p.key} class="explain">
          {p.pieces.flatMap((piece, i) => [
            ...(piece.before === "br" ? [<br key={`b${i}`} />] : piece.before === "space" ? [" "] : []),
            ...[hintLine(piece.text, m)].flat(),
          ])}
        </span>
      );
    case "space":
      return p.text;
    case "graph":
      return <GraphLink key={p.key} g={p.graph} />;
    case "unsaved":
      return (
        <span key={p.key} class="warn">
          {p.text}
        </span>
      );
    case "jump":
      return <Jump key={p.key} line={p.line} path={p.path} />;
    case "wide":
      return (
        <span key={p.key} class="hscroll">
          {"← wide table: swipe sideways →"}
        </span>
      );
    case "stopped":
      // the notes at the run's end are blocks that wrap (.endnote), so a long one and its "Go to line" stay in the
      // pane; each ends with its line break, which a block's last line does not show, so the log's text keeps its lines
      return (
        <span key={p.key} class="endnote">
          <span class="note">{p.text}</span>
          {p.jump !== null && "  "}
          {p.jump !== null && <Jump line={p.jump.line} path={p.jump.path} />}
          {"\n"}
        </span>
      );
    case "endnote":
      return (
        <span key={p.key} class="note endnote">
          {p.text}
          {"\n"}
        </span>
      );
  }
}
