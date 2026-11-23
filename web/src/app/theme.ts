// The theme button: System, Light, Dark in turn. System sets nothing; the others set data-theme on <html>. index.html
// sets it from localStorage before the first paint, so a dark page does not flash light.
import { computed, effect, signal } from "@preact/signals-core";
import { saved } from "./state/saved.ts";
import type { Theme } from "./types.ts";

const asTheme = (v: string | null): Theme => (v === "light" || v === "dark" ? v : "system");
export const theme = signal<Theme>(asTheme(saved.get("dofile.theme"))); // kept in localStorage
const darkQuery = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
const systemDark = signal(Boolean(darkQuery?.matches));
darkQuery?.addEventListener?.("change", (e) => {
  systemDark.value = e.matches;
});
/** The theme in effect, "light" or "dark": what a run sends as plot_theme. */
export const resolvedTheme = computed(() =>
  theme.value === "system" ? (systemDark.value ? "dark" : "light") : theme.value,
);

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
