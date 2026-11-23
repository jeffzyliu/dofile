import type { Banner as BannerRecord } from "../types.ts";

import { dismiss } from "../state/notices.ts";

import { useFocusOnLeave } from "./focus-hooks.ts";
import type { BannerProps } from "./Live";
import { Banner } from "./Live";

/** A registry banner with a Dismiss button after its `actions`. Dismissing it by keyboard hands the focus on rather
 *  than to the page (useFocusOnLeave). */
export function DismissibleBanner({
  banner,
  actions,
  children,
  ...rest
}: Omit<BannerProps, "ref" | "focusable"> & { banner: BannerRecord }) {
  const ref = useFocusOnLeave<HTMLDivElement>();
  return (
    <Banner
      {...rest}
      ref={ref}
      actions={
        <>
          {actions}
          <button type="button" class="btn quiet" onClick={() => dismiss(banner)}>
            Dismiss
          </button>
        </>
      }
    >
      {children}
    </Banner>
  );
}
