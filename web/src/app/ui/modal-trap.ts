// The modal trap: what a dialog and the full-size graph view each do when they open, while open and when they close.
// docs/design/focus-targets.md, section 5; the rules it keeps are docs/web-page-flows.md, section 1.
import { useLayoutEffect, useRef } from "preact/hooks";

import { focusStable } from "../states/focus.ts";

/** What the caller decides; the rest is the trap's. */
export interface ModalTrap {
  /** The element that takes the focus on open: the root itself, or one inside it. */
  first: (root: HTMLElement) => HTMLElement | null;
  /** Esc, for a root that is not a native <dialog> (a native one gets the browser's cancel event). */
  onEscape?: () => void;
  /** Any other key, for a root that is not a native <dialog>, while no dialog is open over it. */
  onKey?: (e: KeyboardEvent) => void;
}

// the opener of a modal that has closed and not yet given the focus back (its microtask below), for a modal opened
// meanwhile (the next clash, other-tab over a dialog) to take as its own; <body> is never an opener (a modal opened
// with the focus on nothing gives it to focusStable)
let leaving: HTMLElement | null = null;

const shown = (el: HTMLElement) => el.getClientRects().length > 0; // Previous and Next are hidden on a desktop

/** Keep Tab and Shift+Tab inside `root`, on its shown, enabled buttons. */
function wrapTab(e: KeyboardEvent, root: HTMLElement) {
  const stops = [...root.querySelectorAll<HTMLElement>("button:not([disabled])")].filter(shown);
  if (!stops.length) return;
  const first = stops[0];
  const last = stops[stops.length - 1];
  const now = document.activeElement;
  if (!root.contains(now) || (e.shiftKey && (now === first || now === root))) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  } else if (!e.shiftKey && now === last) {
    e.preventDefault();
    first.focus();
  }
}

/** `root` is a modal while the component is mounted: the focus goes in on open (a layout effect, so the keys work from
 *  the first frame it is seen in) and, on close, back to what had it: the opener if it is still in the page, else
 *  focusStable(), and only for a focus left on nothing (a dialog, banner or answer that placed the focus from its render
 *  keeps it, so it moves once).
 *  - The opener is the focused element, else the opener of a modal that is still handing the focus back, never <body>.
 *    It lets go of the focus before a native <dialog> opens, so the browser keeps no element to give it back to on
 *    close() (WebKit does, before an answer can place it).
 *  - A root that is a native <dialog> is opened with showModal(), and the browser keeps Tab inside. Any other root keeps
 *    Tab inside itself, takes Esc and the caller's keys, and leaves every key to a native dialog open over it. */
export function useModalTrap(root: { current: HTMLElement | null }, options: ModalTrap) {
  const latest = useRef(options);
  latest.current = options;
  useLayoutEffect(() => {
    const el = root.current!;
    const native = el instanceof HTMLDialogElement;
    const active = document.activeElement;
    const opener = active instanceof HTMLElement && active !== document.body ? active : leaving;
    if (native) {
      opener?.blur();
      if (!el.open) el.showModal();
    }
    latest.current.first(el)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector("dialog[open]")) return;
      if (e.key === "Escape") {
        if (!latest.current.onEscape) return;
        e.preventDefault();
        latest.current.onEscape();
      } else if (e.key === "Tab") {
        wrapTab(e, el);
      } else {
        latest.current.onKey?.(e);
      }
    };
    if (!native) document.addEventListener("keydown", onKey);
    return () => {
      if (!native) document.removeEventListener("keydown", onKey);
      if (el.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
      if (native && el.open) el.close();
      leaving = opener;
      queueMicrotask(() => {
        if (leaving === opener) leaving = null;
        if (document.activeElement && document.activeElement !== document.body) return;
        if (opener?.isConnected) opener.focus();
        // an opener that cannot take it (the head's "Clear…", disabled by the answer) leaves the focus on nothing
        if (!document.activeElement || document.activeElement === document.body) focusStable();
      });
    };
  }, []);
}
