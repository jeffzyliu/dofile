// STEP 4d: where the focus goes when a banner that holds it goes away (its Dismiss, "Try again", the run ending under
// "Don't reset: wait for it"), so it does not fall to <body>: the editor (editorCommands.focus(), which 4b's editor fills;
// or with a .dta tab active its tab or Load), else, when the Editor pane is hidden (another phone view), the top bar's
// "More actions" button, which every width shows and nothing disables. ui/Dialog.tsx uses it too, for a dialog whose
// opener has left the page.
// A view that takes the focus when it appears (the stopping and waiting banners, a dialog) does so in a useLayoutEffect, so
// it has the focus before the hand-off below looks: the focus then goes straight to it, never through the editor.
import { useLayoutEffect, useRef } from "preact/hooks";
import { editorCommands } from "../editor/commands.ts";

/** Put the focus on the editor, or on the visible "More actions" button when the editor cannot take it. editorCommands.focus()
 *  must focus at once (not later), for the check that follows it. With a .dta tab active the editor's own target wins (its
 *  tab in "Open files", or its view's Load: editor/Editor.tsx focus()), so the focus moves once; "More actions" only when
 *  editorCommands.focus() moved it nowhere (the Editor pane hidden, a phone on another view). */
export function focusStable(doc: Document = document) {
  const before = doc.activeElement;
  editorCommands.focus();
  const at = doc.activeElement;
  if (at?.closest("[data-editor]") || (at && at !== before && at !== doc.body)) return;
  [...doc.querySelectorAll<HTMLElement>('button[aria-label="More actions"]')]
    .find((b) => b.getClientRects().length > 0)
    ?.focus();
}

/** A ref for a banner's root: when the banner unmounts with the focus inside it, the focus goes to focusStable(), unless
 *  something else has taken it by then.
 *  - The cleanup must be a useLayoutEffect's, not a useEffect's: Preact (11) runs a layout cleanup while the banner's nodes
 *    are still in the page, so the focus is still inside; it runs a useEffect cleanup after paint, once they are removed
 *    and the focus is on <body>, so the check below would never pass.
 *  - The hand-off waits for a microtask: Preact renders the queued components in one microtask, each with its layout
 *    effects, so by then a banner or dialog that replaced this one has taken the focus (the waiting banner after the
 *    stopping one, the other-tab dialog), and nothing is done. Only a focus left on nothing is moved. */
export function useFocusOnLeave<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    return () => {
      if (!el?.contains(el.ownerDocument.activeElement)) return;
      const doc = el.ownerDocument;
      queueMicrotask(() => {
        if (!doc.activeElement || doc.activeElement === doc.body) focusStable(doc);
      });
    };
  }, []);
  return ref;
}
