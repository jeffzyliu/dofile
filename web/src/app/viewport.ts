// The phone's on-screen keyboard. By default iOS Safari, Chrome (108+) and Firefox (132+) on Android shrink only the
// visual viewport when the keyboard opens, not the layout viewport (index.html sets no `interactive-widget`, so Android
// keeps that default): the keyboard covers the bottom of the page, where the command line and the tab bar are, and the
// browser pans the visual viewport to show the field. So on a phone this module watches window.visualViewport and, while
// the keyboard is open, sets on <html>:
//   data-keyboard     the keyboard is open: the visual viewport is shorter than the layout viewport by more than
//                     KEYBOARD px, at a zoom of 1;
//   --vv-height       the height of the visible area above the keyboard, in CSS px;
//   --vv-top          how far the browser has panned that area down from the layout viewport's top.
// app.css then puts .app exactly in that area, hides the tab bar and puts the toast above the command line there.
// A browser that still shrinks the layout viewport (an older one) shows no difference between the two; there the
// keyboard counts as open while a text field has the focus and the page is more than KEYBOARD px shorter than the
// tallest it has been at this width (a new width, a rotation, starts again). The same attributes are set.
// With the keyboard closed, nothing is set and .app simply fills the window (position: fixed; inset: 0).
// Zoomed in (a pinch), the visual viewport is small because of the zoom, not a keyboard: nothing is set then either.
// A real keyboard cannot be tested here: test/app.test.ts drives this with a fake visualViewport.
//
// An experiment (docs/phone-keyboard-experiment.md): Safari pans the visual viewport to the focused field before the
// page hears of it, so the page jumps. `mode` (?kb=…, app/env.ts) picks how the page answers, to compare them on a real
// iPhone; "top", the default, is the behavior described above, unchanged:
//   top        .app follows the visible area: top --vv-top, height --vv-height (app.css);
//   transform  the same, with .app moved by a transform instead of `top` (app.css; a transformed .app holds its fixed
//              children, the toasts and the full-size graph, so their rules there count from .app's top);
//   height     .app stays at the layout viewport's top, only its height follows: --vv-top is always 0;
//   unpan      as height, and while the keyboard is open a pan (offsetTop or scrollY above 0) is scrolled back to 0;
//   pre        on a text field's focusin, before the keyboard opens, the area above a predicted keyboard is set at once
//              (the visible height seen last at this width, else PREDICT of the layout viewport), and an editor's
//              caret scrolled above it, so the browser may find nothing to reveal; then as unpan. With no keyboard
//              within HOLD ms (a hardware keyboard) the prediction goes;
//   focus      for the command line (log/CommandLine.tsx), which takes the focus itself; here the same as top.

/** How much shorter than the layout viewport the visual viewport must be to count as a keyboard (a keyboard is about 260
 *  px or more; Safari's toolbars change the height by less). */
export const KEYBOARD = 120;

/** The keyboard experiment's strategies (?kb=…, above); "top" is the default. */
export const KB_MODES = ["top", "transform", "height", "unpan", "pre", "focus"] as const;
export type KbMode = (typeof KB_MODES)[number];
/** The strategy a URL's query names; without one, or an unknown one, "top". */
export const kbModeOf = (query: URLSearchParams): KbMode => KB_MODES.find((m) => m === query.get("kb")) ?? "top";

/** pre: the share of the layout viewport's height predicted to stay above the keyboard before one was seen at a width,
 *  and how long a prediction is held without a keyboard (ms). */
export const PREDICT = 0.55;
export const HOLD = 1000;
/** pre: how far above the predicted keyboard an editor's caret is put (px). */
const CARET_MARGIN = 24;

/** Whether `el` takes typing: a text input, a textarea, or editable content (CodeMirror). */
const isTextField = (el: Element | null | undefined) =>
  Boolean(
    el?.matches?.(
      "input:not([type=checkbox], [type=radio], [type=range], [type=file], [type=button], [type=submit], [type=reset]), textarea, [contenteditable]:not([contenteditable=false])",
    ),
  );

/** Start watching. `enabled()` says whether to act (the phone layout); call the returned `update()` when it changes. */
export function watchViewport({
  vv = globalThis.visualViewport,
  root = globalThis.document?.documentElement,
  layoutHeight = () => root.clientHeight,
  layoutWidth = () => root.clientWidth,
  typing = () => isTextField(globalThis.document?.activeElement),
  enabled = () => true,
  mode = "top",
  now = () => performance.now(),
  scrollTop = () => {
    globalThis.scrollTo(0, 0);
    if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
  },
  panned = () => (globalThis.scrollY ?? 0) > 0,
  caret = caretBottom,
  later = (fn: () => void, ms = 0) => setTimeout(fn, ms),
}: {
  vv?: VisualViewport | null;
  root?: HTMLElement;
  layoutHeight?: () => number;
  layoutWidth?: () => number;
  typing?: () => boolean;
  enabled?: () => boolean;
  /** the strategy (?kb=…); "focus" acts here as "top" */
  mode?: KbMode;
  now?: () => number;
  /** unpan, pre: scroll the page back to its top */
  scrollTop?: () => void;
  /** whether the page itself is scrolled (scrollY), besides the visual viewport's offsetTop */
  panned?: () => boolean;
  /** pre: the bottom of the caret in `el` (or of the field), in px from the layout viewport's top; null if unknown */
  caret?: (el: Element) => number | null;
  later?: (fn: () => void, ms?: number) => unknown;
} = {}): { update: () => void; stop: () => void } {
  if (!vv || !root) return { update: () => {}, stop: () => {} };
  let width = 0,
    tallest = 0, // the tallest layout viewport seen at this width
    holdUntil = -Infinity; // pre: a prediction stands until then without a keyboard
  const seen = new Map<number, number>(); // pre: the visible height with the keyboard open, by layout width
  const follow = mode === "top" || mode === "transform" || mode === "focus"; // .app follows offsetTop
  const unpan = mode === "unpan" || mode === "pre";
  const set = (height: number, top: number) => {
    root.style.setProperty("--vv-height", `${height}px`);
    root.style.setProperty("--vv-top", `${top}px`);
    root.dataset.keyboard = "";
  };
  const update = () => {
    const h = layoutHeight(),
      w = layoutWidth();
    if (w !== width) {
      width = w;
      tallest = 0;
    }
    tallest = Math.max(tallest, h);
    const unzoomed = Math.abs(vv.scale - 1) < 0.01;
    const covered = h - vv.height > KEYBOARD; // the keyboard covers the layout viewport (the default)
    const shrunk = typing() && tallest - h > KEYBOARD; // or the browser shrank the layout viewport for it
    const open = enabled() && unzoomed && (covered || shrunk);
    if (open) {
      holdUntil = -Infinity;
      seen.set(w, vv.height);
      set(vv.height, follow ? vv.offsetTop : 0);
      if (unpan && (vv.offsetTop > 0 || panned())) scrollTop();
    } else if ("keyboard" in root.dataset && !(enabled() && now() < holdUntil)) {
      holdUntil = -Infinity;
      root.style.removeProperty("--vv-height");
      root.style.removeProperty("--vv-top");
      delete root.dataset.keyboard;
    }
  };
  // pre: a text field takes the focus with the keyboard closed: the area above the predicted keyboard, at once
  const predict = (e: Event) => {
    const el = e.target as Element | null;
    if (!el || !enabled() || "keyboard" in root.dataset || !isTextField(el)) return;
    const height = seen.get(layoutWidth()) ?? Math.round(layoutHeight() * PREDICT);
    holdUntil = now() + HOLD;
    set(height, 0);
    const bottom = caret(el); // reads the layout, so the new height is laid out before the browser looks
    const scroller = el.closest?.(".cm-scroller");
    if (scroller && bottom !== null && bottom > height - CARET_MARGIN)
      scroller.scrollTop += bottom - (height - CARET_MARGIN);
    later(update, HOLD);
  };
  // resize: the keyboard opens or closes; scroll: the browser pans the visible area (to the focused field); focus: a
  // text field takes or loses it (after the event, when activeElement has moved)
  const soon = () => later(update);
  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
  if (mode === "pre") root.addEventListener?.("focusin", predict); // first, so it acts before anything else
  root.addEventListener?.("focusin", soon);
  root.addEventListener?.("focusout", soon);
  update();
  return {
    update,
    stop: () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      root.removeEventListener?.("focusin", predict);
      root.removeEventListener?.("focusin", soon);
      root.removeEventListener?.("focusout", soon);
    },
  };
}

/** The bottom of the caret when it is in `el` (editable content: CodeMirror), else of `el` (an input), in px from the
 *  layout viewport's top; null without either. */
function caretBottom(el: Element): number | null {
  const sel = globalThis.getSelection?.();
  if (sel?.rangeCount && el.contains(sel.anchorNode)) {
    const r = sel.getRangeAt(0).getClientRects()[0];
    if (r) return r.bottom;
  }
  return el.getBoundingClientRect?.().bottom ?? null;
}
