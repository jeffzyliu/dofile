// Small shared pieces: the SVG icons of ui.css (.ico), the key chips, and the step placeholders.
import type { ComponentChildren } from "preact";

export type IconName = "play" | "stop" | "down" | "right" | "more" | "theme" | "graph" | "file" | "check" | "warn";

/** One of ui.css's icons (a mask in the text color). Decorative: the control around it has the words or an aria-label. */
export const Icon = ({ name }: { name: IconName }) => <span class={`ico i-${name}`} aria-hidden="true" />;

/** True on a Mac (and iPhone, iPad): key chips say ⌘ there, Ctrl elsewhere. */
export const isMac =
  /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? "") ||
  /Mac OS X/.test(globalThis.navigator?.userAgent ?? "");

/** A key chip on a button: `<Key mod k="↩" />` is "⌘ ↩" on a Mac, "Ctrl ↩" elsewhere. A disabled button shows none
 *  (SPEC 1, Glyphs): leave it out there. Hidden from screen readers; the button's aria-keyshortcuts says the key. */
export const Key = ({ k, mod = false }: { k: string; mod?: boolean }) => (
  <span class="key" aria-hidden="true">
    {mod ? `${isMac ? "⌘" : "Ctrl"} ${k}` : k}
  </span>
);

/** aria-keyshortcuts for Ctrl/Cmd + key: "Meta+Enter" on a Mac, "Control+Enter" elsewhere. */
export const modShortcut = (key: string) => `${isMac ? "Meta" : "Control"}+${key}`;

/** A control's labels laid in one grid cell (ui.css .labels), so the control is as wide and as tall as its widest label in
 *  every state and a change of label moves nothing around it. `labels[at]` is shown; the others are visibility: hidden
 *  and aria-hidden, so the accessible name is the shown label alone. Pass every label the control can have, icons and
 *  key chips included; for one that varies (line numbers, a time) add the widest it can be as a sizer ("Run
 *  8888–8888"; digits are tabular there). Each label is centered. Keep the labels short: the widest sets the size.
 *    <button class="btn stop"><Labels at={i} labels={["Break", "Reset", "Stopping…", "Reset now"]} /></button> */
export const Labels = ({ labels, at }: { labels: ComponentChildren[]; at: number }) => (
  <span class="labels">
    {labels.map((l, i) => (
      <span key={i} class="label" aria-hidden={i === at ? undefined : "true"}>
        {l}
      </span>
    ))}
  </span>
);

/** A marked place in the layout that a step 4 part fills. It shows what goes there, so the shell can be seen and tested
 *  before the part is built. Remove it with the part's first commit. */
export const Placeholder = ({ step, children }: { step: string; children: ComponentChildren }) => (
  <div class="placeholder" data-placeholder={step}>
    <b>Step {step}</b>
    {children}
  </div>
);
