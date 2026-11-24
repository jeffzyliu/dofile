// The full-size graph view (docs/design/SPEC.md, section 3.7), over the whole page; open while state/run.ts `graphFull` is
// true. A fixed overlay, not a native modal <dialog>: the browser's top layer would cover the toast ("Copied" after
// Copy image). So it keeps the dialog's promises itself: role="dialog" aria-modal, focus in, Tab kept inside, focus
// back.

import { useEffect, useRef, useState } from "preact/hooks";

import { say as announce } from "../state/notices.ts";
import { closeFullSize, graphFull, graphIndex, graphs, selectGraphAt } from "../state/run.ts";

import { Key } from "../ui/Icon";
import { useModalTrap } from "../ui/modal-trap.ts";

import { canCopyImage, copyImage, exportPng } from "./clip.ts";
import { graphAlt, graphTitle } from "./format.ts";
import { GraphCard, Thumbs } from "./GraphTab";

function Viewer() {
  const [said, say] = useState("");
  const saidTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(saidTimer.current), []);
  const list = graphs.value;
  const at = graphIndex.value;
  const g = list[at];
  const move = (by: number) => selectGraphAt(at + by);
  // the focus goes to the view itself, so a Space that opened it cannot press Close, the first button
  const root = useModalTrap<HTMLDivElement>({
    first: (view) => view,
    onEscape: closeFullSize,
    onKey: (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      move(e.key === "ArrowLeft" ? -1 : 1);
    },
  });

  // a move to another graph is said once (not on open: the view's name says what it is)
  const seen = useRef(g.n);
  useEffect(() => {
    if (seen.current === g.n) return;
    seen.current = g.n;
    announce(graphAlt(g, list));
  }, [g.n]);

  return (
    <div class="viewer" ref={root} role="dialog" aria-modal="true" aria-label="Full-size graph" tabIndex={-1}>
      <div class="vhead">
        <button type="button" class="btn quiet vclose" aria-keyshortcuts="Escape" onClick={closeFullSize}>
          Close <Key k="Esc" />
        </button>
        <span class="vtitle">{graphTitle(g, list)}</span>
        <span class="spacer" />
        <button type="button" class="head-link" onClick={() => exportPng(g)}>
          Export PNG
        </button>
        <button
          type="button"
          class="head-link"
          disabled={!canCopyImage()}
          onClick={async () => {
            if (await copyImage(g)) {
              say("Copied");
              clearTimeout(saidTimer.current); // a second copy keeps its own 2.5 s
              saidTimer.current = setTimeout(() => say(""), 2500);
            }
          }}
        >
          Copy image
        </button>
        <span class="vsaid" aria-hidden="true">
          {said}
        </span>
      </div>
      <div class="vbody">
        <GraphCard g={g} list={list} />
        <div class="strip">
          <Thumbs list={list} current={at} label="Graphs" />
        </div>
      </div>
      <div class="vfoot">
        <button type="button" class="btn" disabled={at === 0} onClick={() => move(-1)}>
          Previous
        </button>
        <button type="button" class="btn" disabled={at === list.length - 1} onClick={() => move(1)}>
          Next
        </button>
      </div>
    </div>
  );
}

export function FullSize() {
  const open = graphFull.value;
  const none = graphs.value.length === 0;
  // with no graph left (Clear log) there is nothing to show: close it, from an effect, not while drawing
  useEffect(() => {
    if (open && none) closeFullSize();
  }, [open, none]);
  return open && !none ? <Viewer /> : null;
}
