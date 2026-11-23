// The page's state: one module of signals (docs/design/SPEC.md, section 8; web/CLAUDE.md, "State"). On
// @preact/signals-core, so the Node tests import this file as it is; components read the same signals through
// @preact/signals.

import type { ReadonlySignal } from "@preact/signals-core";
import { computed, signal } from "@preact/signals-core";
import { saved } from "./state/saved.ts";
import type { Banner, Dialog, DialogName, Layout, OutputTab, PhoneTab, Theme } from "./types.ts";

// ---- layout ----
export const split = signal(saved.get("dofile.split") !== "0"); // kept in localStorage
export const outputTab = signal<OutputTab>(split.value ? "graph" : "log"); // "log" only unsplit
const shownPhoneTab = signal<PhoneTab>("editor");
export const phoneTab: ReadonlySignal<PhoneTab> = shownPhoneTab; // through showPhone()
/** Show the phone's `tab` view. */
export function showPhone(tab: PhoneTab) {
  shownPhoneTab.value = tab;
}
export const layout = signal<Layout>("desktop"); // from the width: phone under 700 px (SPEC section 2)
/** The phone layout: read this rather than passing a `phone` prop down. */
export const isPhone = computed(() => layout.value === "phone");

// ---- theme ----
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

// ---- the Data tab ----
export const pickedVar = signal<string | null>(null); // the Data tab

// ---- wrap lines ----
export const wrap = signal(saved.get("dofile.wrap") === "1"); // kept in localStorage

// ---- dialogs, banners, toast, the live region ----
const toastText = signal<string | null>(null);
const bannerList = signal<Banner[]>([]);
const toastIsError = signal(false);
const announced = signal("");
export const toast: ReadonlySignal<string | null> = toastText; // set through showToast(); it clears itself (toastMs)
// the toast reports an error (the warning icon), not a confirmation
export const toastError: ReadonlySignal<boolean> = toastIsError;
const openedDialog = signal<Dialog>(null);
export const dialog: ReadonlySignal<Dialog> = openedDialog; // the one open dialog, through openDialog() and closeDialog()
/** Open `d`, in the place of any dialog open. */
export function openDialog(d: NonNullable<Dialog>) {
  openedDialog.value = d;
}
/** Close the open dialog. With `own`, a kind or the object openDialog was given, only that dialog: one that another
 *  replaced meanwhile stays open. Returns whether a dialog closed. */
export function closeDialog(own?: DialogName | NonNullable<Dialog>): boolean {
  const open = openedDialog.peek();
  if (open === null) return false;
  if (own !== undefined && (typeof own === "string" ? open.d !== own : open !== own)) return false;
  openedDialog.value = null;
  return true;
}
export const banners: ReadonlySignal<Banner[]> = bannerList; // through addBanner() and dismiss()
export const announce: ReadonlySignal<string> = announced; // the hidden live region, through say()

let saying: string[] = []; // what say() was given in this 50 ms window
/** Say `text` once in the hidden live region (role=status, polite). What is said in one 50 ms window is said as one
 *  text, joined by ". ": a new text in the region cuts a polite one short, so "Engine reset" then "Run ended: …" in the
 *  same tick would lose the first. Only a repeat straight after the same words in the window is dropped (A, B, A says
 *  all three); across windows the same words are said again. */
export function say(text: string) {
  if (saying.at(-1) === text) return;
  saying.push(text);
  if (saying.length > 1) return;
  announced.value = "";
  // a screen reader hears a change of the region's text; the empty step makes a repeat a change
  setTimeout(() => {
    announced.value = saying.join(". ");
    saying = [];
  }, 50);
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
/** How long a toast stays: 60 ms a character (a reading time), at least 4 s (an error 6 s), at most 10 s. */
export const TOAST_MIN_MS = 4000,
  TOAST_ERROR_MIN_MS = 6000,
  TOAST_MAX_MS = 10_000,
  TOAST_MS_PER_CHAR = 60;
export const toastMs = (text: string, error = false) =>
  Math.min(TOAST_MAX_MS, Math.max(error ? TOAST_ERROR_MIN_MS : TOAST_MIN_MS, text.length * TOAST_MS_PER_CHAR));
/** A toast, with no buttons: a short confirmation, or, with `"error"`, an error that needs no action from the visitor;
 *  what the visitor must act on is a banner or a dialog (SPEC 3.10). One at a time, for toastMs(text, error); the live
 *  region says it too. `holdToast(true)` while the pointer is on it keeps it; `holdToast(false)` restarts its time. */
export function showToast(text: string, kind?: "error") {
  toastText.value = text;
  toastIsError.value = kind === "error";
  say(text);
  holdToast(false);
}
export function holdToast(hold: boolean) {
  clearTimeout(toastTimer);
  if (!hold && toastText.value !== null)
    toastTimer = setTimeout(
      () => {
        toastText.value = null;
      },
      toastMs(toastText.value ?? "", toastIsError.value),
    );
}

/** Add a banner (one of each kind and path: a second replaces the first). */
export function addBanner(b: Banner) {
  bannerList.value = [...bannerList.value.filter((x) => !sameBanner(x, b)), b];
}
/** Remove a banner: its Dismiss, or its cause went away. */
export function dismiss(b: Banner) {
  bannerList.value = bannerList.value.filter((x) => !sameBanner(x, b));
}
const sameBanner = (a: Banner, b: Banner) =>
  a.b === b.b && ("path" in a ? a.path : null) === ("path" in b ? b.path : null);
