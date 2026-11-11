// Menus: one open at a time, drawn by <MenuHost /> (once, in App.tsx) in the top layer (the popover API where the
// browser has it) at the trigger's place. docs/design/SPEC.md, section 3.10:
//  - Items are buttons with role="menuitem"; arrows, Home and End move; Enter or Space picks; Esc closes and gives the
//    focus back to the trigger; Tab closes and moves on from the trigger; a click outside closes. A key hint at the right (`hint`); a destructive item
//    `danger`, with "…" in its label when it asks first.
//  - The trigger has aria-haspopup="menu" and aria-expanded.
// Two ways to open one:
//   <MenuButton label="More actions" class="btn quiet icon" items={[...]}><Icon name="more" /></MenuButton>
//   openMenu({ label: "Actions for clean.do", items, anchor: rowElement })            // Shift+F10, the menu key
//   openMenu({ label: "Actions for clean.do", items, at: { x, y }, restore: rowEl })  // a right click
// A picked item closes the menu (focus back to the trigger) before its onSelect runs, so a dialog it opens returns the
// focus there too. An item with `keepOpen` (the phone's Theme) runs and leaves the menu open, the focus on it.
// `items` may be a function: the open menu calls it at each render, so the signals it reads keep the items current
// (Theme's label after a tap).

import { signal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";

export type MenuItem =
  | "rule"
  | {
      label: ComponentChildren;
      onSelect?: () => void;
      href?: string; // a link instead of an action (opens in this tab)
      hint?: ComponentChildren; // at the right: a key ("F2") or a value (the version)
      danger?: boolean;
      disabled?: boolean;
      keepOpen?: boolean; // picking it leaves the menu open
    };
type Items = MenuItem[] | (() => MenuItem[]);

interface Open {
  label: string;
  items: Items;
  anchor: HTMLElement | null; // the trigger: the menu goes under it, and it gets aria-expanded
  at?: { x: number; y: number }; // or a point (a right click)
  restore: HTMLElement | null; // focus goes back here when the menu closes with Esc
  focus: "first" | "last";
}

export const openMenuState = signal<Open | null>(null);

export function openMenu({
  label,
  items,
  anchor = null,
  at,
  restore,
  focus = "first",
}: {
  label: string;
  items: Items;
  anchor?: HTMLElement | null;
  at?: { x: number; y: number };
  restore?: HTMLElement | null;
  focus?: "first" | "last";
}) {
  openMenuState.value = { label, items, anchor, at, restore: restore ?? anchor, focus };
}

/** Close the open menu; `restoreFocus` gives the focus back to its trigger (Esc, a pick, Tab), not on a click outside. */
export function closeMenu(restoreFocus = true) {
  const m = openMenuState.value;
  if (!m) return;
  openMenuState.value = null;
  if (restoreFocus && m.restore?.isConnected) m.restore.focus();
}

export function MenuButton({
  label,
  items,
  class: cls = "btn quiet icon",
  children,
  title,
}: {
  label: string;
  items: Items;
  class?: string;
  children: ComponentChildren;
  title?: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const open = openMenuState.value?.anchor != null && openMenuState.value.anchor === ref.current;
  const show = (focus: "first" | "last") => openMenu({ label, items, anchor: ref.current, focus });
  return (
    <button
      ref={ref}
      type="button"
      class={cls}
      aria-label={label}
      title={title}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={() => (open ? closeMenu() : show("first"))}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          show(e.key === "ArrowDown" ? "first" : "last");
        }
      }}
    >
      {children}
    </button>
  );
}

const hasPopover = typeof HTMLElement !== "undefined" && "showPopover" in HTMLElement.prototype;

export function MenuHost() {
  const m = openMenuState.value;
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!m || !el) return;
    if (hasPopover && !el.matches(":popover-open")) el.showPopover();
    // place it under the trigger (or at the point), inside the window
    const w = el.offsetWidth,
      h = el.offsetHeight,
      pad = 8;
    const r = m.anchor?.getBoundingClientRect();
    let x = r ? r.left : (m.at?.x ?? 0),
      y = r ? r.bottom + 4 : (m.at?.y ?? 0);
    if (x + w > innerWidth - pad) x = Math.max(pad, (r ? r.right : x) - w);
    if (y + h > innerHeight - pad) y = Math.max(pad, (r ? r.top - 4 : y) - h);
    Object.assign(el.style, { left: `${x}px`, top: `${y}px` });
    const items = [...el.querySelectorAll<HTMLElement>("[role=menuitem]:not([aria-disabled=true])")];
    (m.focus === "last" ? items.at(-1) : items[0])?.focus();

    const outside = (e: PointerEvent) => {
      if (!el.contains(e.target as Node) && !m.anchor?.contains(e.target as Node)) closeMenu(false);
    };
    const away = () => closeMenu(false);
    document.addEventListener("pointerdown", outside, true);
    addEventListener("resize", away);
    addEventListener("blur", away);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      removeEventListener("resize", away);
      removeEventListener("blur", away);
      if (hasPopover && el.matches(":popover-open")) el.hidePopover();
    };
  }, [m]);

  if (!m) return null;
  const onKeyDown = (e: KeyboardEvent) => {
    const items = [...ref.current!.querySelectorAll<HTMLElement>("[role=menuitem]:not([aria-disabled=true])")];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => {
      e.preventDefault();
      items[(n + items.length) % items.length]?.focus();
    };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(items.length - 1);
    else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
    } else if (e.key === "Tab") closeMenu(); // focus back on the trigger first, then the browser's Tab moves on from it
  };
  const pick = (item: Exclude<MenuItem, "rule">, el: HTMLElement) => {
    if (item.disabled) return;
    if (item.keepOpen) {
      el.focus(); // a tap does not focus a button in Safari: keep the focus on the item, as Enter does
      item.onSelect?.();
      return;
    }
    closeMenu();
    item.onSelect?.();
  };
  const items = typeof m.items === "function" ? m.items() : m.items;
  return (
    <div
      ref={ref}
      class="menu floating"
      role="menu"
      aria-label={m.label}
      popover={hasPopover ? "manual" : undefined}
      onKeyDown={onKeyDown}
    >
      {items.map((item, i) =>
        item === "rule" ? (
          <hr key={i} />
        ) : item.href ? (
          <a
            key={i}
            role="menuitem"
            tabIndex={-1}
            href={item.href}
            class={item.danger ? "danger" : undefined}
            onClick={() => closeMenu(false)}
          >
            {item.label}
            {item.hint && <span class="aside">{item.hint}</span>}
          </a>
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            tabIndex={-1}
            class={item.danger ? "danger" : undefined}
            aria-disabled={item.disabled || undefined}
            onClick={(e) => pick(item, e.currentTarget)}
          >
            {item.label}
            {item.hint && <span class="aside">{item.hint}</span>}
          </button>
        ),
      )}
    </div>
  );
}
