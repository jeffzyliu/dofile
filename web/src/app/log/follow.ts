import type { RefObject } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { findOpen } from "./find.ts";

/** Keep the end of the log in view unless the visitor has scrolled up. The scroll box is `pre`'s parent, which App
 *  renders; Find scrolls to its match itself, so the hook stands off while Find is open. */
export function useFollowEnd(pre: RefObject<HTMLElement | null>) {
  const stick = useRef(true); // following the end

  useLayoutEffect(() => {
    const box = pre.current?.parentElement;
    if (!box) return;

    // The visitor leaves the end only by an upward scroll that follows their own input (wheel, touch, a press on the
    // scrollbar, a key; Find's jump to a match counts too). The browser scrolls the box itself as well: it clamps
    // scrollTop when the box grows (the running banner above it goes) and the box shrinks again before the scroll event
    // is delivered, so such an event can read "up, and not at the end" with no visitor in it (a paste runs lines in
    // turn: a banner goes and comes back for each). Such a scroll leaves the flag as it is; the next render puts the
    // end in view.
    let last = box.scrollTop;
    let input = -1e9;
    let held = false; // a pointer is down on the box (dragging the scrollbar can last longer than any window)
    const touched = () => {
      input = performance.now();
    };
    const press = () => {
      held = true;
    };
    const release = () => {
      held = false;
    };
    const onScroll = () => {
      const top = box.scrollTop;
      if (top + box.clientHeight >= box.scrollHeight - 8) {
        stick.current = true;
      } else if ((held || performance.now() - input < 500 || findOpen.value) && top < last - 0.5) {
        stick.current = false;
      }
      last = box.scrollTop;
    };

    box.addEventListener("scroll", onScroll, { passive: true });
    for (const t of ["wheel", "touchmove", "keydown"]) box.addEventListener(t, touched, { passive: true });
    box.addEventListener("pointerdown", press, { passive: true });
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);

    // the box changed size with no new text (the banner, the pane, a scrollbar): the end stays in view while following
    const resized = new ResizeObserver(() => {
      if (stick.current && !findOpen.value) box.scrollTop = box.scrollHeight;
    });
    resized.observe(box);

    return () => {
      box.removeEventListener("scroll", onScroll);
      for (const t of ["wheel", "touchmove", "keydown"]) box.removeEventListener(t, touched);
      box.removeEventListener("pointerdown", press);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      resized.disconnect();
    };
  }, []);

  useLayoutEffect(() => {
    const box = pre.current?.parentElement;
    if (box && stick.current && !findOpen.value) box.scrollTop = box.scrollHeight;
  });
}
