// The dialog: a native <dialog> opened modal (the browser makes the rest of the page inert and draws ::backdrop as the
// scrim), centered on a desktop and a bottom sheet under 700 px (app.css). docs/design/SPEC.md, section 3.10.
import type { ComponentChildren } from "preact";
import { useId, useLayoutEffect, useRef } from "preact/hooks";
import { isHeldEnter } from "./keys.ts";
import { useModalTrap } from "./modal-trap.ts";

/** Props of `Dialog`. Mark the safe button `data-autofocus` (Cancel for Delete and Reset); without one, the first
 *  button has the focus. A destructive button is `.btn.stop.live` and never the default. */
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

/** Render it while it should be open: the `dialog` signal decides that (app/dialogs.tsx maps each kind to its view).
 *  Esc calls `onCancel`; without it the dialog is blocking. A dialog unmounted with no answer (another replaced it in
 *  the `dialog` signal) is treated by its owner as Cancel. */
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

  // set before the trap's cleanup closes the dialog: the close event that follows is not an answer
  useLayoutEffect(
    () => () => {
      closing.current = true;
    },
    [],
  );

  useModalTrap(ref, {
    first: (d) =>
      d.querySelector<HTMLElement>("[data-autofocus]") ??
      d.querySelector<HTMLElement>("button:not([disabled]), [href], input"),
  });

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
