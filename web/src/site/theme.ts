// The theme button's words and order on the landing and commands pages: the same as the editor's (src/app/theme.ts), which
// these pages may not import (test/imports.test.ts); test/site.test.ts checks that the two agree.
export type Theme = "system" | "light" | "dark";
export const NEXT: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
export const WORD: Record<Theme, string> = { system: "System", light: "Light", dark: "Dark" };
export const ARIA: Record<Theme, string> = {
  system: "Theme: follows the system. Press for light, then dark.",
  light: "Theme: light. Press for dark, then to follow the system.",
  dark: "Theme: dark. Press to follow the system, then light.",
};
/** The localStorage key: the editor's, so one choice holds on the whole site. */
export const KEY = "dofile.theme";
