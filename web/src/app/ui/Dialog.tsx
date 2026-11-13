// The dialog: a native <dialog> opened modal (the browser makes the rest of the page inert and draws ::backdrop as the
// scrim), centered on a desktop and a bottom sheet under 700 px (app.css). docs/design/SPEC.md, section 3.10:
//  - Focus starts on the safe choice: mark that button `data-autofocus` (Cancel for Delete and Reset; the default
//    otherwise; "Download" for the prompt, UX-037). Without one, the first button.
//  - Esc cancels: it calls `onCancel`. Without `onCancel` the dialog is blocking: Esc does nothing (the download prompt
//    and "dofile is open in another tab").
//  - When it closes (the component unmounts), focus returns to what had it when the dialog opened; if that has left the
//    page, to the editor or More actions (states/focus.ts focusStable). Both after the timers its answer set, and only
//    for a focus left on nothing, so a focus an answer places itself (the close-tab dialog's) moves once. The same when
//    the opener cannot take the focus (the answer disabled it: the Log head's "Clear…" after Clear log). A dialog that
//    opens while the one before it is handing the focus back (the next clash, other-tab over a dialog) takes that one's
//    opener as its own; <body> is never an opener (a dialog opened with the focus on nothing gives it to focusStable).
//  - Unmounted with no answer (another dialog replaced it in the `dialog` signal): its owner treats that as Cancel.
//  - A destructive button is `.btn.stop.live` and never the default.
//  - A held Enter (its repeats) presses no button: the key that opened a dialog does not also answer it.
// Render it while it should be open; the `dialog` signal decides that (app/dialogs.tsx maps each kind to its view):
//   <Dialog title="Reset the engine?" role="alertdialog" onCancel={close}
//     actions={<><button class="btn" data-autofocus onClick={close}>Cancel</button>
//               <button class="btn stop live" onClick={doReset}>Reset</button></>}>
//     <p>The data in memory…</p>
//   </Dialog>
import type { ComponentChildren } from "preact";
import { useId, useLayoutEffect, useRef } from "preact/hooks";
import { focusStable } from "../states/focus.ts";
import { isHeldEnter } from "./keys.ts";

export interface DialogProps {
  title: ComponentChildren;
  children?: ComponentChildren;
  actions?: ComponentChildren; // the buttons, in the drawn order: the primary one last (right; first on a phone)
  role?: "dialog" | "alertdialog"; // alertdialog: a question about something destructive, or an alert
  onCancel?: () => void; // Esc; leave out for a blocking dialog
  class?: string;
  describedBy?: string; // id of the sentence that says what the dialog is about (default: none)
}

/** A held Enter presses no button of a dialog: the key that opened it (Ctrl/Cmd+Enter with no engine opens the download
 *  prompt, whose "Download" has the focus) would answer it with its repeats. */
const heldEnter = (e: KeyboardEvent) => {
  if (isHeldEnter(e)) e.preventDefault();
};

// the opener of a dialog that has closed and not yet given the focus back (its timer below), for a dialog opened
// meanwhile
let leaving: HTMLElement | null = null;

export function Dialog({
  title,
  children,
  actions,
  role = "dialog",
  onCancel,
  class: cls = "",
  describedBy,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const closing = useRef(false);
  const cancel = useRef(onCancel);
  cancel.current = onCancel;

  useLayoutEffect(() => {
    const d = ref.current!;
    const active = document.activeElement;
    const opener = active instanceof HTMLElement && active !== document.body ? active : leaving;
    // the opener lets go of the focus first, so the browser keeps no element to give it back to on close() (WebKit
    // does, before an answer can place it): the cleanup below gives it back, once. docs/web-page-flows.md, section 1
    opener?.blur();
    if (!d.open) d.showModal();
    (
      d.querySelector<HTMLElement>("[data-autofocus]") ??
      d.querySelector<HTMLElement>("button:not([disabled]), [href], input")
    )?.focus();
    return () => {
      closing.current = true;
      if (d.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
      if (d.open) d.close();
      leaving = opener;
      // after the renders this close is part of (a microtask: states/focus.ts useFocusOnLeave), and only for a focus left
      // on nothing: a dialog, banner or answer that placed the focus from its render keeps it, so it moves once. Then the
      // opener, or when it has left the page, the editor or More actions, not <body>. docs/web-page-flows.md, section 1
      queueMicrotask(() => {
        if (leaving === opener) leaving = null;
        if (document.activeElement && document.activeElement !== document.body) return;
        if (opener?.isConnected) opener.focus();
        // an opener that cannot take it (the head's "Clear…", disabled by the answer) leaves the focus on nothing
        if (!document.activeElement || document.activeElement === document.body) focusStable();
      });
    };
  }, []);

  // Esc: a cancel event. A browser may close the dialog anyway (Chrome lets a second Esc through), so a blocking dialog
  // that closed by itself is opened again.
  const onCancelEvent = (e: Event) => {
    e.preventDefault();
    cancel.current?.();
  };
  const onClose = () => {
    if (closing.current) return;
    const d = ref.current;
    if (cancel.current) cancel.current();
    else if (d?.isConnected && !d.open) d.showModal();
  };

  return (
    <dialog
      ref={ref}
      class={`dialog ${cls}`}
      role={role === "alertdialog" ? "alertdialog" : undefined}
      aria-labelledby={titleId}
      aria-describedby={describedBy}
      onCancel={onCancelEvent}
      onClose={onClose}
      onKeyDown={heldEnter}
    >
      <h2 id={titleId}>{title}</h2>
      {children}
      {actions && <div class="actions">{actions}</div>}
    </dialog>
  );
}
