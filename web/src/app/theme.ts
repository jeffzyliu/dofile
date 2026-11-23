// The theme button: System, Light, Dark in turn. System sets nothing; the others set data-theme on <html>. index.html
// sets it from localStorage before the first paint, so a dark page does not flash light.
import { effect } from "@preact/signals-core";
import { saved } from "./state/saved.ts";
import { theme } from "./state.ts";
import type { Theme } from "./types.ts";

/** The order of the presses. */
export const THEME_NEXT: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
/** The button's word. */
export const THEME_LABEL: Record<Theme, string> = { system: "System", light: "Light", dark: "Dark" };
/** The button's aria-label. */
export const THEME_ARIA: Record<Theme, string> = {
  system: "Theme: follows the system. Press for light, then dark.",
  light: "Theme: light. Press for dark, then to follow the system.",
  dark: "Theme: dark. Press to follow the system, then light.",
};

export function cycleTheme() {
  theme.value = THEME_NEXT[theme.value];
}

/** Keep <html data-theme> and localStorage in step with the signal. */
export function applyTheme(root = globalThis.document?.documentElement) {
  return effect(() => {
    const t = theme.value;
    if (root) {
      if (t === "system") delete root.dataset.theme;
      else root.dataset.theme = t;
    }
    saved.set("dofile.theme", t === "system" ? null : t);
  });
}
