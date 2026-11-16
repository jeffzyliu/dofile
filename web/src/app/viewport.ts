// The phone's on-screen keyboard. While it is open, <html> gets `data-keyboard` and `--vv-height` (the height of the
// visible area above it, in CSS px), and app.css fits .app to that area. The iPhone measurements behind it:
// docs/phone-keyboard-experiment.md.
import { EditorView } from "@codemirror/view";

/** How much shorter than the layout viewport the visual viewport must be to count as a keyboard (a keyboard is about 260
 *  px or more; Safari's toolbars change the height by less). */
export const KEYBOARD = 120;
/** How far clear of the editor's edges (so of the keyboard) its caret is put (px). */
const CARET_MARGIN = 24;
/** How long the viewport must be quiet before the keyboard counts as settled and the caret is revealed again (ms). On
 *  an iPhone the last event of an opening came about 300 ms after the tap. */
export const SETTLE = 300;

/** Whether `el` takes typing: a text input, a textarea, or editable content (CodeMirror). */
const isTextField = (el: Element | null | undefined) =>
  Boolean(
    el?.matches?.(
      "input:not([type=checkbox], [type=radio], [type=range], [type=file], [type=button], [type=submit], [type=reset]), textarea, [contenteditable]:not([contenteditable=false])",
    ),
  );

/** A move shorter than this (px) on both axes gives no axis to judge by. */
const TAP = 4;

/** Whether `el` can still scroll in the drag's direction: (dx, dy) is the finger's last move, so a finger moving up
 *  (dy > 0) scrolls the content towards its end. The axis counts that the finger mostly moves along; under TAP either
 *  may go (a zero move, either way). */
const scrolls = (el: Element, dx: number, dy: number) => {
  const style = getComputedStyle(el),
    room = (overflow: string, at: number, end: number, move: number) =>
      /auto|scroll/.test(overflow) && (move > 0 ? at < end - 1 : move < 0 ? at > 0 : at > 0 || at < end - 1),
    y = room(style.overflowY, el.scrollTop, el.scrollHeight - el.clientHeight, dy),
    x = room(style.overflowX, el.scrollLeft, el.scrollWidth - el.clientWidth, dx);
  return Math.max(Math.abs(dx), Math.abs(dy)) < TAP ? x || y : Math.abs(dy) >= Math.abs(dx) ? y : x;
};

/** Whether the touch is on selected text, in the page or in a field (a drag of a selection handle): left to the browser.
 *  Not on what holds the selection (the page, .app, the editor): that would switch the guard off. */
const selecting = (target: Element) => {
  const selection = globalThis.getSelection?.(),
    field = target as HTMLInputElement; // a field's own selection is not in getSelection()
  return (
    (selection?.isCollapsed === false && // a caret alone is not a selection
      selection.containsNode(target, true) &&
      !target.contains(selection.getRangeAt(0).commonAncestorContainer)) ||
    (field.selectionStart ?? 0) !== (field.selectionEnd ?? 0)
  );
};

/** Start watching. `enabled()` says whether to act (the phone layout); call the returned `update()` when it changes. */
export function watchViewport({
  vv = globalThis.visualViewport,
  root = globalThis.document?.documentElement,
  layoutHeight = () => root.clientHeight,
  layoutWidth = () => root.clientWidth,
  typing = () => isTextField(globalThis.document?.activeElement),
  enabled = () => true,
  scrollTop = () => {
    globalThis.scrollTo(0, 0);
    if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
  },
  panned = () => (globalThis.scrollY ?? 0) > 0,
  later = (fn: () => void, ms = 0) => setTimeout(fn, ms),
  reveal = revealCaret,
  touch = globalThis.document,
  canScroll = scrolls,
  onSelection = selecting,
}: {
  vv?: VisualViewport | null;
  root?: HTMLElement;
  layoutHeight?: () => number;
  layoutWidth?: () => number;
  typing?: () => boolean;
  enabled?: () => boolean;
  /** scroll the page back to its top */
  scrollTop?: () => void;
  /** whether the page itself is scrolled (scrollY), besides the visual viewport's offsetTop */
  panned?: () => boolean;
  later?: (fn: () => void, ms?: number) => unknown;
  /** scroll the focused editor's caret into its visible part (the editor is above the keyboard) */
  reveal?: () => void;
  /** where the touches are heard: the drag guard's listeners go here while the keyboard is open */
  touch?: EventTarget;
  /** whether an element can scroll in a drag's direction (see `scrolls`) */
  canScroll?: (el: Element, dx: number, dy: number) => boolean;
  /** whether a touch's target is selected text (see `selecting`) */
  onSelection?: (target: Element) => boolean;
} = {}): { update: () => void; stop: () => void } {
  if (!vv || !root) return { update: () => {}, stop: () => {} };
  let width = 0,
    tallest = 0, // the tallest layout viewport seen at this width
    quiet = 0; // counts the updates, so only the last one's timer reveals
  // The drag guard. While the keyboard is open, iOS lets a drag scroll the window by the keyboard's height from
  // anything that cannot scroll, even with overflow: hidden; scrolling back would only snap it each frame, and CSS
  // touch-action was not enough on an iPhone. So a touchmove that nothing under the finger can follow is cancelled. Its
  // limits: docs/phone-keyboard-experiment.md, "The drag guard".
  let x = 0,
    y = 0,
    guarding = false;
  const start = (e: Event) => {
    ({ clientX: x, clientY: y } = (e as TouchEvent).touches[0]);
  };
  const drag = (e: Event) => {
    const { touches } = e as TouchEvent;
    if (touches.length !== 1) return; // a pinch
    const [dx, dy] = [x - touches[0].clientX, y - touches[0].clientY];
    ({ clientX: x, clientY: y } = touches[0]);
    const target = e.target as Element;
    if (onSelection(target)) return;
    for (let el: Element | null = target; el; el = el.parentElement) if (canScroll(el, dx, dy)) return;
    e.preventDefault();
  };
  const guard = (on: boolean) => {
    if (on === guarding) return;
    guarding = on;
    const listen = on ? "addEventListener" : "removeEventListener";
    touch?.[listen]("touchstart", start, { passive: true, capture: true });
    touch?.[listen]("touchmove", drag, { passive: false, capture: true });
  };
  const update = () => {
    const h = layoutHeight(),
      w = layoutWidth();
    if (w !== width) {
      width = w;
      tallest = 0;
    }
    tallest = Math.max(tallest, h);
    // zoomed in (a pinch), the visual viewport is small because of the zoom, not a keyboard
    const unzoomed = Math.abs(vv.scale - 1) < 0.01;
    // iOS Safari, Chrome 108+ and Firefox 132+ on Android shrink only the visual viewport for the keyboard, which then
    // covers the page's bottom (index.html sets no `interactive-widget`, so Android keeps that default)
    const covered = h - vv.height > KEYBOARD;
    // an older browser shrinks the layout viewport too, so the two match: compare with the tallest at this width
    const shrunk = typing() && tallest - h > KEYBOARD;
    const open = enabled() && unzoomed && (covered || shrunk);
    if (open) {
      const opening = !("keyboard" in root.dataset);
      root.style.setProperty("--vv-height", `${vv.height}px`);
      root.dataset.keyboard = "";
      // Safari pans the page up to the focused field before the page hears of it: scroll straight back, so the pan
      // shows for one frame and .app stays at the top
      if (vv.offsetTop > 0 || panned()) scrollTop();
      guard(true);
      // scrolling back hides the editor's caret again: reveal it now, and again once the viewport has settled
      if (opening) reveal();
      const n = ++quiet;
      later(() => {
        if (n === quiet && "keyboard" in root.dataset) reveal();
      }, SETTLE);
    } else if ("keyboard" in root.dataset) {
      root.style.removeProperty("--vv-height");
      delete root.dataset.keyboard;
      guard(false);
      // a scroll after the last update (reveal on a field that then lost the focus) would keep the page panned, and
      // .app, fixed to the layout viewport, short
      if (panned()) scrollTop();
    }
  };
  // resize: the keyboard opens or closes; scroll: the browser pans the visible area (to the focused field); focus: a
  // text field takes or loses it (after the event, when activeElement has moved)
  const soon = () => later(update);
  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
  root.addEventListener?.("focusin", soon);
  root.addEventListener?.("focusout", soon);
  update();
  return {
    update,
    stop: () => {
      guard(false);
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      root.removeEventListener?.("focusin", soon);
      root.removeEventListener?.("focusout", soon);
    },
  };
}

/** Scroll the focused editor's caret into its visible part (the editor ends above the keyboard). CodeMirror's own
 *  scrollIntoView, in its next measure: the layout is final there (the pan scrolled back), and it finds the caret on an
 *  empty line, where a DOM range has no box. */
function revealCaret() {
  const active = globalThis.document?.activeElement;
  const editor = active?.closest<HTMLElement>(".cm-editor");
  const view = editor ? EditorView.findFromDOM(editor) : null;
  if (view)
    view.dispatch({
      effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: "nearest", yMargin: CARET_MARGIN }),
    });
  else if (active?.matches?.("input, textarea") && isTextField(active)) active.scrollIntoView({ block: "nearest" }); // a plain field in a scroller (the Files pane's draft)
}
