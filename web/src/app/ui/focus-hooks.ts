// Focus moved by the component that draws the target, from its own render: docs/web-page-flows.md, section 1.
import { useLayoutEffect } from "preact/hooks";

import type { Get } from "./element.ts";
import { useElement } from "./element.ts";
import type { From, TargetName } from "./focus-targets.ts";
import { focusRequest, focusStable, fromNothing, register, takeRequest } from "./focus-targets.ts";

/** The element takes the focus when `asked` turns true, in a layout effect of this component's render; `end()` ends the
 *  request there, taken or not, and the focus moves only when `from(activeElement)` allows it.
 *  @returns the ref to attach to the element */
export function useFocusRequest<T extends HTMLElement = HTMLElement>({
  asked,
  end,
  from = fromNothing,
  get,
}: {
  asked: boolean;
  end: () => void;
  from?: From;
  get?: Get<T>;
}) {
  const { ref, el } = useElement(get);
  useLayoutEffect(() => {
    if (!asked) return;
    end();
    const target = el();
    if (target && from(target.ownerDocument.activeElement)) target.focus();
  }, [asked]);
  return ref;
}

/** The component that draws a target registers it from mount to unmount (a layout effect, so before any request is taken),
 *  and takes the waiting request for it in a layout effect of the render that follows `ask` (ui/focus-targets.ts).
 *  The element is read at each use, so it may follow state that changes without a render.
 *  @returns the ref to attach to the element */
export function useFocusTarget<T extends HTMLElement = HTMLElement>(
  name: TargetName,
  { get, key, focus }: { get?: Get<T>; key?: string; focus?: (el: HTMLElement) => void } = {},
) {
  const { ref, el } = useElement(get);
  useLayoutEffect(() => register(name, { get: el, key, focus }), [name, key]);
  const asked = focusRequest.value;
  useLayoutEffect(() => {
    takeRequest(name, key);
  }, [asked]);
  return ref;
}

/** The element takes the focus when the component mounts, in a layout effect, so a hand-off that waits a microtask
 *  (useFocusOnLeave) finds it taken (rule 5).
 *  @returns the ref to attach to the element */
export function useFocusOnMount<T extends HTMLElement = HTMLElement>({ get }: { get?: Get<T> } = {}) {
  const { ref, el } = useElement(get);
  useLayoutEffect(() => el()?.focus(), []);
  return ref;
}

/** When the element (a banner's root) unmounts with the focus inside it, the focus goes to focusStable(), unless
 *  something else has taken it by then.
 *  - The cleanup must be a useLayoutEffect's, not a useEffect's: Preact (11) runs a layout cleanup while the banner's nodes
 *    are still in the page, so the focus is still inside; it runs a useEffect cleanup after paint, once they are removed
 *    and the focus is on <body>, so the check below would never pass.
 *  - The hand-off waits for a microtask: Preact renders the queued components in one microtask, each with its layout
 *    effects, so by then a banner or dialog that replaced this one has taken the focus (the waiting banner after the
 *    stopping one, the other-tab dialog), and nothing is done. Only a focus left on nothing is moved. */
export function useFocusOnLeave<T extends HTMLElement = HTMLElement>({ get }: { get?: Get<T> } = {}) {
  const { ref, el: read } = useElement(get);
  useLayoutEffect(() => {
    const el = read();
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
