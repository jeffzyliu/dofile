// The page's layout and the visitor's Split and Wrap choices (kept in localStorage). No DOM, so a Node test runs them.

import type { ReadonlySignal } from "@preact/signals-core";
import { computed, signal } from "@preact/signals-core";
import type { Layout, OutputTab, PhoneTab } from "../types.ts";
import { saved } from "./saved.ts";

export const split = signal(saved.get("dofile.split") !== "0"); // kept in localStorage
export const outputTab = signal<OutputTab>(split.value ? "graph" : "log"); // "log" only unsplit
const shownPhoneTab = signal<PhoneTab>("editor");
export const phoneTab: ReadonlySignal<PhoneTab> = shownPhoneTab; // through showPhone()
/** Show the phone's `tab` view. */
export function showPhone(tab: PhoneTab) {
  shownPhoneTab.value = tab;
}
const shownLayout = signal<Layout>("desktop");
export const layout: ReadonlySignal<Layout> = shownLayout; // from the width: phone under 700 px (SPEC section 2), through setLayout()
/** Set the layout the width asks for. */
export function setLayout(l: Layout) {
  shownLayout.value = l;
}
/** The phone layout: read this rather than passing a `phone` prop down. */
export const isPhone = computed(() => layout.value === "phone");
export const wrap = signal(saved.get("dofile.wrap") === "1"); // "Wrap lines"; kept in localStorage

/** "Wrap lines": the log's long lines wrap; kept across visits. */
export function toggleWrap() {
  wrap.value = !wrap.value;
  saved.set("dofile.wrap", wrap.value ? "1" : null);
}

/** Split puts the Output pane beside the Log, unsplit makes the Log its first tab; the choice is kept across visits. */
export function setSplit(on: boolean) {
  split.value = on;
  saved.set("dofile.split", on ? null : "0");
  if (on && outputTab.value === "log") outputTab.value = "graph";
  if (!on) outputTab.value = "log"; // unsplit: the Log is what the visitor sees first
}
