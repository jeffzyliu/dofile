// The hidden live region, the toast, and the banner (docs/design/SPEC.md, sections 1 and 3.10). The live region says
// each toast's words too. A toast is a confirmation, or an error that needs no action (a copy the browser refused, a
// load that failed); anything the visitor must act on, or choose between, is a banner or a dialog.
import type { ComponentChildren, Ref } from "preact";

import { announce, holdToast, toast, toastError } from "../state/notices.ts";

import { Icon } from "./Icon";

export const LiveRegion = () => (
  <div class="visually-hidden" role="status" aria-live="polite">
    {announce.value}
  </div>
);

export function ToastHost() {
  const text = toast.value;
  if (text === null) return null;
  return (
    <div class="toasts" aria-hidden="true">
      <div class="toast" onPointerEnter={() => holdToast(true)} onPointerLeave={() => holdToast(false)}>
        <Icon name={toastError.value ? "warn" : "check"} />
        {text}
      </div>
    </div>
  );
}

export interface BannerProps {
  kind?: "info" | "warn" | "error";
  children: ComponentChildren; // the sentence; its first words in <b> as drawn
  actions?: ComponentChildren; // buttons under it
  focusable?: boolean; // tabindex=-1, for a banner that takes the focus (S 9b)
  bannerRef?: Ref<HTMLDivElement>;
}

export const Banner = ({ kind = "info", children, actions, focusable, bannerRef }: BannerProps) => (
  <div ref={bannerRef} class={`banner${kind === "info" ? "" : ` ${kind}`}`} tabIndex={focusable ? -1 : undefined}>
    {kind !== "info" && <Icon name="warn" />}
    <div>
      {children}
      {actions && <div class="actions">{actions}</div>}
    </div>
  </div>
);
