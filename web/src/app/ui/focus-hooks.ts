// Focus moved by the component that draws the target, from its own render: docs/web-page-flows.md, section 1.
import { useLayoutEffect, useRef } from "preact/hooks";
import { type From, focusRequest, fromNothing, register, type TargetName, takeRequest } from "./focus-targets.ts";

type Target = { current: HTMLElement | null };

/** `ref` takes the focus when `asked` turns true, in a layout effect of this component's render; `end()` ends the
 *  request there, taken or not, and the focus moves only when `from(activeElement)` allows it. */
export function useFocusRequest(asked: boolean, ref: Target, end: () => void, from: From = fromNothing) {
  useLayoutEffect(() => {
    if (!asked) return;
    end();
    const el = ref.current;
    if (el && from(el.ownerDocument.activeElement)) el.focus();
  }, [asked]);
}

/** The component that draws a target registers it from mount to unmount (a layout effect, so before any request is taken),
 *  and takes the waiting request for it in a layout effect of the render that follows `ask` (ui/focus-targets.ts).
 *  `get` is read at each use, so it may follow state that changes without a render. */
export function useFocusTarget(
  name: TargetName,
  get: () => HTMLElement | null,
  { key, focus }: { key?: string; focus?: (el: HTMLElement) => void } = {},
) {
  const latest = useRef(get);
  latest.current = get;
  useLayoutEffect(() => register(name, () => latest.current(), key, focus), [name, key]);
  const asked = focusRequest.value;
  useLayoutEffect(() => {
    takeRequest(name, key);
  }, [asked]);
}

/** `ref` takes the focus when the component mounts, in a layout effect, so a hand-off that waits a microtask
 *  (states/focus.ts useFocusOnLeave) finds it taken (rule 5). */
export function useFocusOnMount(ref: Target) {
  useLayoutEffect(() => ref.current?.focus(), []);
}
