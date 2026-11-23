// The element a hook acts on: drawn by the consumer with the ref a hook returns, or any other element the consumer's `get`
// names. STYLE.md, "UI helpers".
import { useCallback, useRef } from "preact/hooks";

/** The element a hook acts on, from the hook's own element (null before it is mounted); null for none. */
export type Get<T extends HTMLElement = HTMLElement> = (own: T | null) => HTMLElement | null;

/** The ref to attach, and `el`, which reads the element to act on: `get(own)`, or the ref's element when there is no
 *  `get`. Read it where the element is used (a layout effect, an event), never while rendering: the ref is filled in
 *  the commit, before the layout effects run. `el` is stable and reads the `get` of the latest render. */
export function useElement<T extends HTMLElement>(get?: Get<T>) {
  const ref = useRef<T>(null);
  const latest = useRef(get);
  latest.current = get;
  const el = useCallback(() => (latest.current ? latest.current(ref.current) : ref.current), []);
  return { ref, el };
}
