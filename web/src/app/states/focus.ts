// STEP 4d: where the focus goes when a banner that holds it goes away (its Dismiss, "Try again", the run ending under
// "Don't reset: wait for it"), so it does not fall to <body>: the editor (editorCommands.focus(), which 4b's editor fills;
// until then its default focuses the `[data-editor]` stand-in), else, when the editor is hidden (a .dta tab, another phone
// view), the top bar's "More actions" button, which every width shows and nothing disables.
import { useLayoutEffect, useRef } from "preact/hooks";
import { editorCommands } from "../editor/commands.ts";

/** Put the focus on the editor, or on the visible "More actions" button when the editor cannot take it. */
export function focusStable(doc: Document = document) {
  editorCommands.focus();
  if (doc.activeElement?.closest("[data-editor]")) return;
  [...doc.querySelectorAll<HTMLElement>('button[aria-label="More actions"]')]
    .find((b) => b.getClientRects().length > 0)
    ?.focus();
}

/** A ref for a banner's root: when the banner unmounts with the focus inside it, the focus goes to focusStable(). Preact
 *  runs the cleanup before it removes the banner's nodes, so the focus is still inside then. */
export function useFocusOnLeave<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    return () => {
      if (el?.contains(el.ownerDocument.activeElement)) focusStable(el.ownerDocument);
    };
  }, []);
  return ref;
}
