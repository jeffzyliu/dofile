// Menus: one open at a time, drawn by <MenuHost /> (once, in App.tsx) in the top layer (the popover API where the
// browser has it) at the trigger's place. docs/design/SPEC.md, section 3.10:
//  - Items are buttons with role="menuitem"; arrows, Home and End move; Enter or Space picks; Esc closes and gives the
//    focus back to the trigger; Tab closes and moves on from the trigger; a click outside closes. A key hint at the right (`hint`); a destructive item
//    `danger`, with "…" in its label when it asks first.
//  - The trigger has aria-haspopup="menu" and aria-expanded.
// Two ways to open one:
// A `{ scroll: [...] }` entry holds items in a scrolling box (`.menu-scroll`, at most 60% of the window's height and always room left for the items around it): the phone's
// open files. The arrow keys and Home/End still walk every item, the scrolled ones too.
// The menu owns which item is the active one (`nav`, an index among the items that are not disabled, in the order they are
// drawn, scroll groups included): the arrow keys and Home/End change it, and the active item takes the focus from its own
// render (MenuEntry), once the menu is shown and in its place. The focus on an item (a click, a tap) makes it the active one.
//   <MenuButton label="More actions" class="btn quiet icon" items={[...]}><Icon name="more" /></MenuButton>
//   openMenu({ label: "Actions for clean.do", items, anchor: rowElement })            // Shift+F10, the menu key
//   openMenu({ label: "Actions for clean.do", items, at: { x, y }, restore: rowEl })  // a right click
// A picked item closes the menu (focus back to the trigger) before its onSelect runs, so a dialog it opens returns the
// focus there too. An item with `keepOpen` (the phone's Theme) runs and leaves the menu open, the focus on it.
// `items` may be a function: the open menu calls it at each render, so the signals it reads keep the items current
// (Theme's label after a tap).

import { signal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";

export type MenuItem =
  | "rule"
  | { scroll: MenuItem[] } // a run of items that scrolls when the menu is taller than the window; the ones around it stay in reach
  | {
      label: ComponentChildren;
      onSelect?: () => void;
      href?: string; // a link instead of an action (opens in a new tab: leaving the editor would end the engine)
      hint?: ComponentChildren; // at the right: a key ("F2") or a value (the version)
      hintIsKey?: boolean; // the hint names a key: hidden from sight on a phone (class key-hint), kept in the item's name
      danger?: boolean;
      disabled?: boolean;
      keepOpen?: boolean; // picking it leaves the menu open
      checked?: boolean; // a switch: role="menuitemcheckbox", aria-checked, a track and knob at the right
      current?: boolean; // the open file in a list of files: the menu scrolls it into view when it opens
    };
type Items = MenuItem[] | (() => MenuItem[]);
type Leaf = Exclude<MenuItem, "rule" | { scroll: MenuItem[] }>;

/** An item's hint; one that names a key (`hintIsKey`: "F2") has the class key-hint, which a phone hides from sight as it
 *  hides the key chips (app.css); it stays in the item's accessible name. */
const Hint = ({ item }: { item: { hint?: ComponentChildren; hintIsKey?: boolean } }) => (
  <span class={item.hintIsKey ? "aside key-hint" : "aside"}>{item.hint}</span>
);

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
        if (e.altKey || e.ctrlKey || e.metaKey) return;
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
  const [placed, setPlaced] = useState<Open | null>(null); // the menu that is shown and in its place: its items may take the focus
  const [nav, setNav] = useState<{ of: Open; at: number } | null>(null); // the active item of a menu; none yet: its `focus`

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
    setPlaced(m); // the active item takes the focus (and a current one is scrolled into view) when it is drawn again

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
  const items = typeof m.items === "function" ? m.items() : m.items;
  const order = new Map<Leaf, number>(); // every item, the disabled ones too, in the order they are drawn
  const number = (list: MenuItem[]) => {
    for (const item of list)
      if (typeof item === "object" && "scroll" in item) number(item.scroll);
      else if (item !== "rule") order.set(item, order.size);
  };
  number(items);
  const on = [...order].flatMap(([item, n]) => (item.disabled ? [] : [n])); // the ones the arrow keys stop at
  // The active item is a position among all the items: another item turning enabled or disabled leaves it where it is
  const at = nav?.of === m ? nav.at : ((m.focus === "last" ? on.at(-1) : on[0]) ?? -1);
  const onKeyDown = (e: KeyboardEvent) => {
    const go = (n: number | undefined) => {
      e.preventDefault();
      if (n !== undefined) setNav({ of: m, at: n });
    };
    const plain = !(e.altKey || e.ctrlKey || e.metaKey); // Alt+Left is the browser's Back; Esc and Tab are as they were
    if (plain && e.key === "ArrowDown") go(on.find((n) => n > at) ?? on[0]);
    else if (plain && e.key === "ArrowUp") go(on.findLast((n) => n < at) ?? on.at(-1));
    else if (plain && e.key === "Home") go(on[0]);
    else if (plain && e.key === "End") go(on.at(-1));
    else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
    } else if (e.key === "Tab") closeMenu(); // focus back on the trigger first, then the browser's Tab moves on from it
  };
  const pick = (item: Leaf, el: HTMLElement) => {
    if (item.disabled) return;
    if (item.keepOpen) {
      el.focus(); // a tap does not focus a button in Safari (docs/web-page-flows.md, section 1): keep it on the item
      item.onSelect?.();
      return;
    }
    closeMenu();
    item.onSelect?.();
  };
  const renderItem = (item: MenuItem, i: number): ComponentChildren =>
    typeof item === "object" && "scroll" in item ? (
      <div key={i} class="menu-scroll">
        {item.scroll.map(renderItem)}
      </div>
    ) : item === "rule" ? (
      <hr key={i} />
    ) : (
      <MenuEntry
        key={i}
        item={item}
        active={order.get(item) === at}
        placed={placed === m}
        onFocus={() => {
          const n = order.get(item);
          if (n !== undefined && n !== at) setNav({ of: m, at: n }); // any item, a disabled one a click focused too
        }}
        onPick={pick}
      />
    );
  return (
    <div
      ref={ref}
      class="menu floating"
      role="menu"
      aria-label={m.label}
      popover={hasPopover ? "manual" : undefined}
      onKeyDown={onKeyDown}
    >
      {items.map(renderItem)}
    </div>
  );
}

/** One item. The active one takes the focus when the menu is in place (and each time it becomes the active one); the
 *  current one (`current`) is scrolled into view then, in the scroll box that holds it. */
function MenuEntry({
  item,
  active,
  placed,
  onFocus,
  onPick,
}: {
  item: Leaf;
  active: boolean;
  placed: boolean;
  onFocus: () => void;
  onPick: (item: Leaf, el: HTMLElement) => void;
}) {
  const el = useRef<HTMLElement | null>(null);
  const grab = (node: HTMLElement | null) => {
    el.current = node;
  };
  useLayoutEffect(() => {
    if (placed && item.current) el.current?.scrollIntoView({ block: "nearest" });
  }, [placed]);
  useLayoutEffect(() => {
    if (placed && active) el.current?.focus();
  }, [placed, active]);
  return item.href ? (
    <a
      ref={grab}
      role="menuitem"
      tabIndex={-1}
      href={item.href}
      target="_blank"
      rel="noopener"
      class={item.danger ? "danger" : undefined}
      onFocus={onFocus}
      onClick={() => closeMenu(false)}
    >
      {item.label}
      {item.hint && <Hint item={item} />}
    </a>
  ) : (
    <button
      ref={grab}
      type="button"
      {...(item.checked === undefined
        ? { role: "menuitem" }
        : { role: "menuitemcheckbox", "aria-checked": item.checked })}
      tabIndex={-1}
      class={item.danger ? "danger" : undefined}
      aria-disabled={item.disabled || undefined}
      aria-current={item.current || undefined}
      onFocus={onFocus}
      onClick={(e) => onPick(item, e.currentTarget)}
    >
      {item.label}
      {item.hint && <Hint item={item} />}
      {item.checked !== undefined && <span class="switch" aria-hidden="true" />}
    </button>
  );
}
