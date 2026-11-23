// The focus registry: components register named targets, callers move the focus to one by name. Plain TypeScript, so the
// Node tests run it; the hook that registers from a component is ui/focus-hooks.ts `useFocusTarget`.
import { type ReadonlySignal, signal } from "@preact/signals-core";

/** Whether a request may take the focus from `at`, the element that has it. */
export type From = (at: Element | null) => boolean;
/** Only a focus left on nothing (rule 1). */
export const fromNothing: From = (at) => !at || at === at.ownerDocument.body;
export const fromAnywhere: From = () => true;

/** Every target, once: a component registers each of these by name (test/focus-targets.test.ts checks that one does). */
export const TARGET_NAMES = ["editor", "open-file-tab", "dta-load", "more-actions"] as const;
export type TargetName = (typeof TARGET_NAMES)[number];

interface Entry {
  name: TargetName;
  key: string | undefined;
  get: () => HTMLElement | null;
  focus: (el: HTMLElement) => void;
}

const entries = new Set<Entry>();

const isShown = (el: HTMLElement | null): el is HTMLElement => !!el?.isConnected && el.getClientRects().length > 0;

/** Entries of one name, several allowed: the first shown one wins. */
const shownEntry = (name: TargetName, key?: string) => {
  for (const entry of entries) {
    if (entry.name !== name || (key !== undefined && entry.key !== key)) continue;
    const el = entry.get();
    if (isShown(el)) return { entry, el };
  }
  return null;
};

/**
 * Make `name` a target until the returned function is called.
 * @param get - the element, or null while there is none; read at each use, so one entry follows a ref that changes
 * @param key - tells entries of one name apart; a request with a key reaches only that entry
 * @param focus - how the element takes the focus, when `el.focus()` is not enough
 */
export function register(
  name: TargetName,
  get: () => HTMLElement | null,
  key?: string,
  focus: (el: HTMLElement) => void = (el) => el.focus(),
): () => void {
  const entry: Entry = { name, key, get, focus };
  entries.add(entry);
  return () => {
    entries.delete(entry);
  };
}

/** The element of the first shown entry of `name`, or null: a target that is gone, empty, out of the page or not shown. */
export function shownElement(name: TargetName, key?: string): HTMLElement | null {
  return shownEntry(name, key)?.el ?? null;
}

/** Focus `name` at once; whether the focus is now on it. Nothing moves for a target that is gone or not shown. */
export function focusNow(name: TargetName, key?: string): boolean {
  const hit = shownEntry(name, key);
  if (!hit) return false;
  hit.entry.focus(hit.el);
  return hit.el.ownerDocument.activeElement === hit.el;
}

interface FocusRequest {
  name: TargetName;
  key: string | undefined;
  from: From;
}

const waiting = signal<FocusRequest | null>(null);
/** The one request that waits for its target's next render: a newer request replaces it, whatever its target. */
export const focusRequest: ReadonlySignal<FocusRequest | null> = waiting;

/** Ask `name` to take the focus from its next render, when `from` allows it (useFocusTarget). */
export function ask(name: TargetName, { key, from }: { key?: string; from: From }) {
  waiting.value = { name, key, from };
}

/** End the waiting request when it is for `name`. */
export function cancel(name: TargetName) {
  if (waiting.peek()?.name === name) waiting.value = null;
}

/** Take the waiting request when it is for `name` (and `key`): it ends, taken or not, and the focus moves only when its
 *  `from` allows it. Whether the focus moved. */
export function takeRequest(name: TargetName, key?: string): boolean {
  const request = waiting.peek();
  if (!request || request.name !== name || (request.key !== undefined && request.key !== key)) return false;
  waiting.value = null;
  const hit = shownEntry(name, request.key);
  if (!hit || !request.from(hit.el.ownerDocument.activeElement)) return false;
  return focusNow(name, request.key);
}
