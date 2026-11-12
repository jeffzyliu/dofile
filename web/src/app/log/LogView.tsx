// The log (docs/design/SPEC.md, section 3.5). Reads `log` (LogItem[], run.ts writes it) and draws, top to bottom:
//  - the head (.head): the banner (aria-hidden) and "dofile 0.1.0 · OpenDTA 0c3f3a2 · Stata 14 syntax" (env.ts ABOUT),
//    "Files stay in this browser. Try: help regress";
//  - per run its run-head (.runhead, section 4; none for one command), then its text, each line by its kind from the .log
//    tokenizer (log/classify.ts; OQ-4): the echo bold (.echo), output at normal weight, the error and its r(N); red and
//    bold (.err), the engine's hint muted (.hint; its "How to fix:" and "Learn more:" bold, its `help x` a link that runs
//    it as a command, OQ-20), the path shim's lines muted (.note);
//  - after the echo of the line that drew it (RunResult.graph_lines, placed by log/align.ts; at the run's end when the
//    line is not found), each graph: a link "graph 1" (.glink) that shows it in the Graph tab, or on a phone the graph
//    itself on the card of its run's theme (4c's cardTheme), which opens full size when tapped;
//  - after the echo of a nested `do` or `include` of a file that had unsaved edits when the run started, S 15's note;
//  - at the run's end: "Go to line 17" (.jump) after its r(N); (an error in the file, not in a command); after Break,
//    "Stopped by Break before line 17. The data is as the last complete command left it." (OQ-9) with "Go to line 17"
//    and no error mark (a command from the command line names no line: "Stopped by Break. The data is ..."); the
//    files a run wrote that were not kept (`skipped`, `store_error`);
//  - the page's notes (.note), such as a reset's reason, and under an error the OQ-10 note (states/words.ts noteFor).
// On a phone the hint is a block (.explain), and a block of output wider than the screen is followed by "← wide table:
// swipe sideways →". The head, run-heads and the page's notes are shown only: Download log has the runs' text alone.
// The pane follows the end of the log unless the visitor has scrolled up. role="log".
import { type ComponentChildren, Fragment } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { codeOf, editorCommands } from "../editor/commands.ts";
import { jumpLine, runheadWords } from "../editor/words.ts";
import { ABOUT } from "../env";
import { graphAlt } from "../output/format.ts";
import { cardTheme } from "../output/GraphTab";
import { runCommand } from "../run.ts";
import { graphFull, graphIndex, graphs, isPhone, log, outputTab, split } from "../state.ts";
import { noteFor } from "../states/words.ts";
import type { Graph, LogItem, RunHead } from "../types.ts";
import { Icon, isMac } from "../ui/Icon";
import { commandEnd, echoLines, nestedTarget, unsavedTarget } from "./align.ts";
import { classify, hintParts, type LogLine } from "./classify.ts";
import { findAt, findOpen, findText, matches } from "./find.ts";

type TextItem = Extract<LogItem, { t: "text" }>;

const kinds = new WeakMap<TextItem, LogLine[]>(); // each text item's lines, worked out once (an item is replaced when it changes)
const linesOf = (item: TextItem) => {
  const known = kinds.get(item);
  if (known) return known;
  const l = classify(item.text);
  kinds.set(item, l);
  return l;
};

const ART = [
  "     ██            ▄█▀▀  ▄▄  ██",
  "     ██            ██        ██",
  "▄█▀▀▀██  ▄█▀▀▀█▄  ▀██▀▀  ██  ██   ▄█▀▀▀█▄",
  "██   ██  ██   ██   ██    ██  ██   ██▀▀▀▀▀",
  "▀█▄▄▄██  ▀█▄▄▄█▀   ██    ██  ▀█▄  ▀█▄▄▄▄▄",
]; // banner B2, "book+drop+skew" (docs/design/mockups/art.js): each line slanted by its height above the last

/** The marks of Find: a counter over the whole render, so each match has its number. */
type Marker = { n: number; query: string; at: number };

function marked(text: string, m: Marker): ComponentChildren {
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

function GraphLink({ g }: { g: Graph }) {
  const all = graphs.value;
  const i = all.findIndex((x) => x.n === g.n);
  if (isPhone.value)
    return (
      <button
        type="button"
        class="inline-graph"
        data-theme={cardTheme(g)}
        aria-label={`${graphAlt(g, all)}: open full size`}
        onClick={() => {
          graphIndex.value = i;
          graphFull.value = true;
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
        graphIndex.value = i;
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

/** A hint line: its bold words and its `help x` link. */
const hintLine = (text: string, m: Marker) =>
  hintParts(text).map((p, i) =>
    p.t === "bold" ? (
      <b key={i}>{marked(p.text, m)}</b>
    ) : p.t === "help" ? (
      <button key={i} type="button" class="help-link" onClick={() => runCommand(p.text)}>
        {marked(p.text, m)}
      </button>
    ) : (
      marked(p.text, m)
    ),
  );

const PHONE_COLUMNS = 48; // about what a phone's log shows across; a wider block of output says it scrolls sideways

/** One run's text, with what goes after its lines. A plain function that LogView calls, not a component: every match
 *  of Find is then numbered while LogView renders, in the order the log shows them, and counted before FindBar uses
 *  the count (a child component would render after LogView had read it). */
function runText(item: TextItem, head: RunHead | null, m: Marker): ComponentChildren {
  const lines = linesOf(item);
  const phone = isPhone.value;
  const after = new Map<number, ComponentChildren[]>();
  const put = (at: number, el: ComponentChildren) => after.set(at, [...(after.get(at) ?? []), el]);
  const last = lines.length - (lines.at(-1)?.text === "" ? 2 : 1); // the last line with text

  // the code it sent: kept by the editor (commands.ts codeOf); a command is its one echo
  const code = head ? codeOf.get(head) : lines.find((l) => l.kind === "echo")?.text.replace(/^\. ?/, "");
  const echoes = code === undefined ? new Map<number, number>() : echoLines(lines, code);
  for (const g of graphs.value.filter((x) => x.from === "run" && x.run === item.run)) {
    const at = g.line != null ? echoes.get(g.line) : undefined;
    put(at === undefined ? last : commandEnd(lines, at), <GraphLink key={`g${g.n}`} g={g} />);
  }
  if (item.unsaved?.length)
    for (const at of echoes.values()) {
      const target = nestedTarget(lines[at].text.replace(/^\. /, ""));
      const file = target ? unsavedTarget(target, item.unsaved) : null;
      if (!file) continue;
      const name = file.slice(file.lastIndexOf("/") + 1);
      put(
        commandEnd(lines, at),
        <span key={`u${at}`} class="warn">
          {`Note: ${name} has unsaved edits in the editor; do runs the saved file. Save it (${isMac ? "⌘" : "Ctrl"} S) to run your edits.`}
        </span>,
      );
    }

  const end = item.end;
  const jump = end ? jumpLine(end) : null;
  let rcAt = -1; // the r(N); the jump goes beside
  if (end && end.rc !== 1 && jump !== null)
    for (let i = lines.length - 1; i >= 0; i--)
      if (lines[i].kind === "err" && /^r\(\d+\);$/.test(lines[i].text)) {
        rcAt = i;
        break;
      }

  const out: ComponentChildren[] = [];
  let hint: ComponentChildren[] | null = null; // a phone's hint block in progress
  let widest = 0;
  lines.forEach((l, i) => {
    const isLast = i === lines.length - 1;
    if (isLast && l.text === "" && !after.has(i)) return; // the text's own last line break
    if (phone && l.kind === "hint") {
      hint ??= [];
      const text = l.text.replace(/^\s*(→ )?/, "");
      if (hint.length && /^(How to fix:|Learn more:)/.test(text)) hint.push(<br key={`b${i}`} />);
      else if (hint.length) hint.push(" ");
      hint.push(...[hintLine(text, m)].flat());
      if (lines[i + 1]?.kind !== "hint") {
        out.push(
          <span key={`h${i}`} class="explain">
            {hint}
          </span>,
        );
        hint = null;
      }
      return;
    }
    if (l.kind === "out") widest = Math.max(widest, l.text.length);
    out.push(
      <span key={i} class={l.kind === "out" ? undefined : l.kind}>
        {l.kind === "hint" ? hintLine(l.text, m) : marked(l.text, m)}
      </span>,
    );
    if (i === rcAt) out.push("  ", <Jump key="jump" line={jump!} path={end!.path} />);
    if (!isLast) out.push("\n");
    if (phone && widest > PHONE_COLUMNS && lines[i + 1]?.kind !== "out") {
      out.push(
        <span key={`w${i}`} class="hscroll">
          {"← wide table: swipe sideways →"}
        </span>,
      );
      widest = 0;
    } else if (lines[i + 1]?.kind !== "out") widest = 0;
    const extra = after.get(i);
    if (extra) {
      if (isLast) out.push("\n");
      out.push(...extra.flatMap((el) => [el, "\n"]));
    }
  });

  if (end?.rc === 1)
    out.push(
      <span key="break" class="note">
        {end.line !== null && end.kind !== "command"
          ? `Stopped by Break before line ${end.line}. The data is as the last complete command left it.`
          : "Stopped by Break. The data is as the last complete command left it."}
      </span>,
      jump !== null ? "  " : "",
      jump !== null ? <Jump key="jump" line={jump} path={end.path} /> : null,
      "\n",
    );
  else if (jump !== null && rcAt < 0) out.push(<Jump key="jump" line={jump} path={end!.path} />, "\n");
  // OQ-10's notes (4d's states/words.ts), under the error: the error is the run's first error line that is not r(N);
  const error = end && end.rc > 1 ? lines.find((l) => l.kind === "err" && !/^r\(\d+\);$/.test(l.text)) : undefined;
  const note = error ? noteFor(end!.rc, error.text) : null;
  if (note)
    out.push(
      <span key="oq10" class="note">
        {note}
      </span>,
      "\n",
    );
  if (end?.skipped?.length)
    out.push(
      <span key="skipped" class="note">
        {`Not kept: ${end.skipped.join(", ")}. Its folder was renamed or deleted during the run.`}
      </span>,
      "\n",
    );
  if (end?.store_error)
    out.push(
      <span key="store" class="note">
        {`The files this run wrote couldn't be kept in this browser: ${end.store_error}`}
      </span>,
      "\n",
    );
  return out;
}

/** The log's head: the banner and the versions (shown only). A plain function, as runText is. */
function logHead(m: Marker) {
  const commit = (ABOUT.engine_commit ?? "").slice(0, 7);
  return (
    <span class="head">
      <span class="art" aria-hidden="true">
        {ART.map((line, i) => (
          <span key={i} class="art-skew" style={{ "--k": ART.length - 1 - i }}>
            <span class="art-ink art-drop">{line}</span>
          </span>
        ))}
      </span>
      {marked(`dofile ${ABOUT.dofile} · OpenDTA ${commit} · Stata ${ABOUT.stata_version} syntax`, m)}
      {"\n"}
      {marked("Files stay in this browser. Try: help regress", m)}
    </span>
  );
}

/** Find's field, over the log (log/find.ts). */
function FindBar({ total, pre }: { total: number; pre: HTMLPreElement | null }) {
  if (!findOpen.value) return null;
  const at = total ? (findAt.value % total) + 1 : 0;
  const close = () => {
    findOpen.value = false;
    findText.value = "";
    // back to what opened Find (the Log head's button, or the phone's ⋯); else the log itself, never the page
    (findReturn?.isConnected && findReturn.getClientRects().length ? findReturn : pre)?.focus();
  };
  return (
    <div class="findbar">
      <input
        class="field"
        type="search"
        aria-label="Find in the log"
        placeholder="Find in the log"
        value={findText.value}
        ref={(el) => {
          if (el && findFocus) {
            findFocus = false;
            el.focus();
          }
        }}
        onInput={(e) => {
          findText.value = (e.target as HTMLInputElement).value;
          findAt.value = 0;
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            close();
          } else if (e.key === "Enter" && total) {
            e.preventDefault();
            findAt.value = (findAt.value + (e.shiftKey ? total - 1 : 1)) % total;
          }
        }}
      />
      <span class="count" aria-live="polite">
        {findText.value ? (total ? `${at} of ${total}` : "none") : ""}
      </span>
      <button type="button" class="head-link" onClick={close}>
        {"Close"}
      </button>
    </div>
  );
}
let findFocus = false;
let findReturn: HTMLElement | null = null;
/** Open Find (the Log head's button, the phone's ⋯): the field takes the focus; Esc and Close give it back to `from`
 *  (the phone's ⋯ passes none: the focus is then on the ⋯ button, which the menu gave it back to). On the desktop with
 *  the Output pane unsplit and Graph, Data or Results showing, the Log tab is shown first, so the field can be seen. */
export function openFind(from: HTMLElement | null) {
  findReturn = from ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  findFocus = true;
  if (!isPhone.value && !split.value && outputTab.value !== "log") outputTab.value = "log";
  findOpen.value = true;
}

export function LogView() {
  const pre = useRef<HTMLPreElement>(null);
  const stick = useRef(true); // following the end
  const items = log.value;
  const m: Marker = { n: 0, query: findOpen.value ? findText.value : "", at: findAt.value };
  let head: RunHead | null = null;
  const placed = new Set<number>(); // the graphs drawn inside their run's text
  for (const i of items) if (i.t === "text") for (const g of graphs.value) if (g.run === i.run) placed.add(g.n);
  // every part is drawn here, in the log's order, so Find numbers and counts its matches as they are shown
  const body = items.map((item, k) => {
    switch (item.t) {
      case "head":
        return <Fragment key={k}>{logHead(m)}</Fragment>;
      case "runhead": {
        head = item.run;
        const [bold, rest] = runheadWords(item.run, item.first, isPhone.value);
        return (
          <span key={k} class="runhead">
            <b>{marked(bold, m)}</b>
            {marked(rest, m)}
          </span>
        );
      }
      case "text": {
        const h = head;
        head = null;
        return <Fragment key={k}>{runText(item, h, m)}</Fragment>;
      }
      case "note":
        return (
          <span key={k} class="note">
            {marked(item.text, m)}
            {"\n"}
          </span>
        );
      case "graph": {
        if (placed.has(item.n)) return null;
        const g = graphs.value.find((x) => x.n === item.n);
        return g ? (
          <span key={k}>
            <GraphLink g={g} />
            {"\n"}
          </span>
        ) : null;
      }
    }
    return null;
  });
  const total = m.n;

  // follow the end unless the visitor scrolled up; Find scrolls to its match
  useLayoutEffect(() => {
    const box = pre.current?.parentElement;
    if (!box) return;
    const onScroll = () => {
      stick.current = box.scrollTop + box.clientHeight >= box.scrollHeight - 8;
    };
    box.addEventListener("scroll", onScroll, { passive: true });
    return () => box.removeEventListener("scroll", onScroll);
  }, []);
  useLayoutEffect(() => {
    const box = pre.current?.parentElement;
    if (box && stick.current && !findOpen.value) box.scrollTop = box.scrollHeight;
  });
  useLayoutEffect(() => {
    if (findOpen.value && findText.value) pre.current?.querySelector("mark.on")?.scrollIntoView({ block: "nearest" });
  }, [findAt.value, findText.value]);
  // fewer matches than before (Clear log): the current one is the first again
  useLayoutEffect(() => {
    if (findAt.value >= total && findAt.value > 0) findAt.value = 0;
  });

  return (
    <>
      <FindBar total={total} pre={pre.current} />
      <pre class="log" role="log" aria-label="Log" ref={pre} tabIndex={-1}>
        {body}
      </pre>
    </>
  );
}
