// The hidden live region, the toast, and the banner (docs/design/SPEC.md, sections 1 and 3.10).
//  - say(text) (state.ts): the one role="status" region says each change once ("Run started", "Engine ready"). The
//    status bar is not a live region.
//  - showToast(text, kind?) (state.ts): a confirmation (check mark), or with kind "error" an error that needs no action
//    from the visitor (a copy the browser refused, a load that failed with its rc; warning icon); no buttons, inverted
//    colors, bottom center, 4 to 10 s by its length and 6 s at least for an error (state.ts toastMs; kept while the
//    pointer is on it), never focused; the live region says the same words. Anything the visitor must act on, or choose between, is
//    a banner or a dialog.
//  - <Banner kind>: a pane's notice above its content, until its cause goes or it is dismissed. Warning and error carry
//    the warning icon (meaning is never color alone).
import type { ComponentChildren, Ref } from "preact";
import { announce, holdToast, toast, toastError } from "../state.ts";
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
