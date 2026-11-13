// Focus moved by the component that draws the target, from its own render: docs/web-page-flows.md, section 1.
import { useLayoutEffect } from "preact/hooks";

type Target = { current: HTMLElement | null };

/** Whether a request may take the focus from `at`, the element that has it. */
export type From = (at: Element | null) => boolean;
/** Only a focus left on nothing (rule 1). */
export const fromNothing: From = (at) => !at || at === at.ownerDocument.body;
export const fromAnywhere: From = () => true;

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

/** `ref` takes the focus when the component mounts, in a layout effect, so a hand-off that waits a microtask
 *  (states/focus.ts useFocusOnLeave) finds it taken (rule 5). */
export function useFocusOnMount(ref: Target) {
  useLayoutEffect(() => ref.current?.focus(), []);
}
