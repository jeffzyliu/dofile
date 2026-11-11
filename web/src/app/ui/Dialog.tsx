// The dialog: a native <dialog> opened modal (the browser makes the rest of the page inert and draws ::backdrop as the
// scrim), centered on a desktop and a bottom sheet under 700 px (app.css). docs/design/SPEC.md, section 3.10:
//  - Focus starts on the safe choice: mark that button `data-autofocus` (Cancel for Delete and Reset; the default
//    otherwise; "Download" for the prompt, UX-037). Without one, the first button.
//  - Esc cancels: it calls `onCancel`. Without `onCancel` the dialog is blocking: Esc does nothing (the download prompt
//    and "dofile is open in another tab").
//  - When it closes (the component unmounts), focus returns to what had it when the dialog opened.
//  - Unmounted with no answer (another dialog replaced it in the `dialog` signal): its owner treats that as Cancel.
//  - A destructive button is `.btn.stop.live` and never the default.
// Render it while it should be open; the `dialog` signal decides that (app/dialogs.tsx maps each kind to its view):
//   <Dialog title="Reset the engine?" role="alertdialog" onCancel={close}
//     actions={<><button class="btn" data-autofocus onClick={close}>Cancel</button>
//               <button class="btn stop live" onClick={doReset}>Reset</button></>}>
//     <p>The data in memory…</p>
//   </Dialog>
import type { ComponentChildren } from "preact";
import { useId, useLayoutEffect, useRef } from "preact/hooks";

export interface DialogProps {
  title: ComponentChildren;
  children?: ComponentChildren;
  actions?: ComponentChildren; // the buttons, in the drawn order: the primary one last (right; first on a phone)
  role?: "dialog" | "alertdialog"; // alertdialog: a question about something destructive, or an alert
  onCancel?: () => void; // Esc; leave out for a blocking dialog
  class?: string;
  describedBy?: string; // id of the sentence that says what the dialog is about (default: none)
}

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
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!d.open) d.showModal();
    (
      d.querySelector<HTMLElement>("[data-autofocus]") ??
      d.querySelector<HTMLElement>("button:not([disabled]), [href], input")
    )?.focus();
    return () => {
      closing.current = true;
      if (d.open) d.close();
      if (opener?.isConnected) opener.focus();
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
    >
      <h2 id={titleId}>{title}</h2>
      {children}
      {actions && <div class="actions">{actions}</div>}
    </dialog>
  );
}
