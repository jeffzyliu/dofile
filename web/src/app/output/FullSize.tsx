// The full-size graph view (docs/design/SPEC.md, section 3.7; P/Full size, WP 6), over the whole page. App.tsx places
// <FullSize /> once, for every width. It is open while state.ts `graphFull` is true and shows graphs[graphIndex].
// Who opens it: the Graph tab's "Open full size", a tap on an inline graph in the phone's log (4b), a .png opened on a
// phone (4a). Esc or Close sets `graphFull` false and gives the focus back to what opened it; ← and → move between the
// session's graphs; the strip at the right (under the graph on a phone) shows them all.
//
// It is a fixed overlay, not a native modal <dialog>: the browser's top layer would cover the toast ("Copied" after Copy
// image). So it keeps the dialog's promises itself: role="dialog" aria-modal, the focus moves in and Tab stays inside,
// and the opener gets the focus back. On a phone (CSS only) it is the full-screen graph of the wireframe: Close,
// the title, Export PNG at the top and Previous and Next at the foot.

import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { graphFull, graphIndex, graphs } from "../state.ts";
import { Key } from "../ui/Icon";
import { canCopyImage, copyImage, exportPng } from "./clip.ts";
import { graphAlt, graphTitle } from "./format.ts";
import { GraphCard, shownGraph, Thumbs } from "./GraphTab";
import { fullOpener } from "./view.ts";

const close = () => {
  graphFull.value = false;
};

function Viewer() {
  const root = useRef<HTMLDivElement>(null);
  const [said, say] = useState("");
  const list = graphs.value;
  const at = shownGraph(list, graphIndex.value);
  const g = list[at];
  const move = (by: number) => {
    graphIndex.value = Math.min(Math.max(at + by, 0), list.length - 1);
  };
  const keys = useRef({ move, at });
  keys.current = { move, at };

  // the focus goes in on open (to the view itself, so a Space that opened it cannot press Close) and back on close; a
  // layout effect, so the keys work from the first frame the view is seen in
  useLayoutEffect(() => {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const opener = fullOpener.el?.isConnected ? fullOpener.el : active;
    fullOpener.el = null;
    root.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        keys.current.move(e.key === "ArrowLeft" ? -1 : 1);
      } else if (e.key === "Tab") {
        const shown = (el: HTMLElement) => el.getClientRects().length > 0; // Previous and Next are hidden on a desktop
        const stops = [...(root.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? [])].filter(shown);
        if (!stops.length) return;
        const first = stops[0],
          last = stops[stops.length - 1],
          now = document.activeElement;
        if (!root.current?.contains(now) || (e.shiftKey && (now === first || now === root.current))) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        } else if (!e.shiftKey && now === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  return (
    <div class="viewer" ref={root} role="dialog" aria-modal="true" aria-label="Full-size graph" tabIndex={-1}>
      <div class="vhead">
        <button type="button" class="btn quiet vclose" aria-keyshortcuts="Escape" onClick={close}>
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
              setTimeout(() => say(""), 2500);
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
      <span class="visually-hidden" aria-live="polite">
        {graphAlt(g, list)}
      </span>
    </div>
  );
}

export function FullSize() {
  const open = graphFull.value;
  const none = graphs.value.length === 0;
  // with no graph left (Clear log) there is nothing to show: close it, from an effect, not while drawing
  useEffect(() => {
    if (open && none) close();
  }, [open, none]);
  return open && !none ? <Viewer /> : null;
}
