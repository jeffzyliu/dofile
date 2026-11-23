// Where the focus goes when what held it leaves the page (a banner, a dialog's opener): never <body>. The rules and who
// uses this: docs/web-page-flows.md, section 1.
import { useLayoutEffect, useRef } from "preact/hooks";

import { focusNow } from "../ui/focus-targets.ts";

/** Put the focus on the editor, or on the visible "More actions" button when the editor cannot take it (the Editor pane
 *  hidden, a phone on another view). It focuses at once, and with a .dta tab active the editor's target is that tab's own
 *  (editor/Editor.tsx), so the focus moves once. */
export function focusStable() {
  if (!focusNow("editor")) focusNow("more-actions");
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
        if (!doc.activeElement || doc.activeElement === doc.body) focusStable();
      });
    };
  }, []);
  return ref;
}
