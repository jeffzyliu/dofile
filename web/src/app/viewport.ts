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

/** How much shorter than the layout viewport the visual viewport must be to count as a keyboard (a keyboard is about 260
 *  px or more; Safari's toolbars change the height by less). */
export const KEYBOARD = 120;

/** Whether `el` takes typing: a text input, a textarea, or editable content (CodeMirror). */
const isTextField = (el: Element | null | undefined) => Boolean(el?.matches?.(
  "input:not([type=checkbox], [type=radio], [type=range], [type=file], [type=button], [type=submit], [type=reset]), textarea, [contenteditable]:not([contenteditable=false])"));

/** Start watching. `enabled()` says whether to act (the phone layout); call the returned `update()` when it changes. */
export function watchViewport({ vv = globalThis.visualViewport, root = globalThis.document?.documentElement,
  layoutHeight = () => root.clientHeight, layoutWidth = () => root.clientWidth,
  typing = () => isTextField(globalThis.document?.activeElement), enabled = () => true }: { vv?: VisualViewport | null, root?: HTMLElement,
  layoutHeight?: () => number, layoutWidth?: () => number, typing?: () => boolean, enabled?: () => boolean } = {}):
  { update: () => void, stop: () => void } {
  if (!vv || !root) return { update: () => {}, stop: () => {} };
  let width = 0, tallest = 0;   // the tallest layout viewport seen at this width
  const update = () => {
    const h = layoutHeight(), w = layoutWidth();
    if (w !== width) { width = w; tallest = 0; }
    tallest = Math.max(tallest, h);
    const unzoomed = Math.abs(vv.scale - 1) < 0.01;
    const covered = h - vv.height > KEYBOARD;                // the keyboard covers the layout viewport (the default)
    const shrunk = typing() && tallest - h > KEYBOARD;       // or the browser shrank the layout viewport for it
    const open = enabled() && unzoomed && (covered || shrunk);
    if (open) {
      root.style.setProperty("--vv-height", `${vv.height}px`);
      root.style.setProperty("--vv-top", `${vv.offsetTop}px`);
      root.dataset.keyboard = "";
    } else if ("keyboard" in root.dataset) {
      root.style.removeProperty("--vv-height");
      root.style.removeProperty("--vv-top");
      delete root.dataset.keyboard;
    }
  };
  // resize: the keyboard opens or closes; scroll: the browser pans the visible area (to the focused field); focus: a
  // text field takes or loses it (after the event, when activeElement has moved)
  const later = () => setTimeout(update);
  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
  root.addEventListener?.("focusin", later);
  root.addEventListener?.("focusout", later);
  update();
  return { update, stop: () => {
    vv.removeEventListener("resize", update);
    vv.removeEventListener("scroll", update);
    root.removeEventListener?.("focusin", later);
    root.removeEventListener?.("focusout", later);
  } };
}
