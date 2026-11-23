// The log (docs/design/SPEC.md, section 3.5). Reads `log` (LogItem[]) and draws the head, then per run its run-head and
// its text (run-parts.ts makes its parts, LogParts.tsx draws them), each line by its kind (classify.ts). The head,
// run-heads and the page's notes are shown only: Download log has the runs' text alone.
import { Fragment, type RefObject } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { codeOf } from "../editor/commands.ts";
import { runheadWords } from "../editor/words.ts";
import { ABOUT } from "../env";
import { graphs, isPhone, log, wrap } from "../state.ts";
import type { RunHead } from "../types.ts";
import { useFocusRequest } from "../ui/focus-hooks.ts";
import { fromAnywhere } from "../ui/focus-targets.ts";
import { isMac } from "../ui/Icon";
import { findAsked, findAt, findOpen, findReturn, findText } from "./find.ts";
import { useFollowEnd } from "./follow.ts";
import { drawRunParts, GraphLink, type Marker, marked } from "./LogParts.tsx";
import { runParts } from "./run-parts.ts";

const ART = [
  "     ██            ▄█▀▀  ▄▄  ██",
  "     ██            ██        ██",
  "▄█▀▀▀██  ▄█▀▀▀█▄  ▀██▀▀  ██  ██   ▄█▀▀▀█▄",
  "██   ██  ██   ██   ██    ██  ██   ██▀▀▀▀▀",
  "▀█▄▄▄██  ▀█▄▄▄█▀   ██    ██  ▀█▄  ▀█▄▄▄▄▄",
]; // banner B2, "book+drop+skew" (docs/design/mockups/art.js): each line slanted by its height above the last

/** The log's head: the banner and the versions (shown only). A plain function, as drawRunParts is. */
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

/** Find's field, over the log. */
function FindBar({ total, pre }: { total: number; pre: RefObject<HTMLPreElement | null> }) {
  const field = useRef<HTMLInputElement>(null);
  // once per openFind: a LogView drawn again with Find open (another Output tab and back) takes no focus
  useFocusRequest(
    findOpen.value && findAsked.value,
    field,
    () => {
      findAsked.value = false;
    },
    fromAnywhere,
  );
  if (!findOpen.value) return null;
  const at = total ? (findAt.value % total) + 1 : 0;
  const close = () => {
    findOpen.value = false;
    findText.value = "";
    // back to what opened Find (the Log head's button, or the phone's ⋯); else the log itself, never the page
    (findReturn?.isConnected && findReturn.getClientRects().length ? findReturn : pre.current)?.focus();
  };
  return (
    <div class="findbar">
      <input
        class="field"
        type="search"
        aria-label="Find in the log"
        placeholder="Find in the log"
        autocomplete="off"
        autoCorrect="off"
        autocapitalize="off"
        spellcheck={false}
        value={findText.value}
        ref={field}
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
        {findText.value ? (total ? `${at} of ${total}` : "no match") : ""}
      </span>
      <button type="button" class="head-link" onClick={close}>
        {"Close"}
      </button>
    </div>
  );
}
export function LogView() {
  const pre = useRef<HTMLPreElement>(null);
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
        const parts = runParts(item, {
          head: h,
          phone: isPhone.value,
          graphs: graphs.value,
          mac: isMac,
          sentCode: (run) => codeOf.get(run),
        });
        return <Fragment key={k}>{drawRunParts(parts, m)}</Fragment>;
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

  useFollowEnd(pre);
  // Find scrolls to its match
  useLayoutEffect(() => {
    if (findOpen.value && findText.value) pre.current?.querySelector("mark.on")?.scrollIntoView({ block: "nearest" });
  }, [findAt.value, findText.value]);
  // fewer matches than before (Clear log): the current one is the first again
  useLayoutEffect(() => {
    if (findAt.value >= total && findAt.value > 0) findAt.value = 0;
  });

  return (
    <>
      <FindBar total={total} pre={pre} />
      <pre class={wrap.value ? "log wrap" : "log"} role="log" aria-label="Log" ref={pre} tabIndex={-1}>
        {body}
      </pre>
    </>
  );
}
