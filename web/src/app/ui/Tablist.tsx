// A tablist with roving focus: one tab in the tab order (the selected one); Left/Right (Up/Down too) move and select,
// Home and End go to the ends. Used by the Output tabs, the unsplit Log pane and the phone's Views bar. Each tab is
// `${idPrefix}-tab-${id}`; the selected one controls `${idPrefix}-panel-${id}` (only the selected panel need exist): give
// the panel that id, role="tabpanel" and aria-labelledby the tab (tabpanelProps does it).
import { type Signal, useSignal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { useRef } from "preact/hooks";
import { useFocusRequest } from "./focus-hooks.ts";

export interface TabSpec<T extends string> {
  id: T;
  label: string;
  marker?: ComponentChildren;
}

export function Tablist<T extends string>({
  label,
  tabs,
  value,
  onChange,
  idPrefix,
  class: cls = "tabstrip",
  tabClass = "tab",
}: {
  label: string;
  tabs: TabSpec<T>[];
  value: T;
  onChange: (id: T) => void;
  idPrefix: string;
  class?: string;
  tabClass?: string;
}) {
  const list = useRef<HTMLDivElement>(null);
  const asked = useSignal<T | null>(null); // the tab a key moved to: it takes the focus when it is drawn
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return; // Alt+Left is the browser's Back
    const i = tabs.findIndex((t) => t.id === value);
    const next = {
      ArrowRight: i + 1,
      ArrowDown: i + 1,
      ArrowLeft: i - 1,
      ArrowUp: i - 1,
      Home: 0,
      End: tabs.length - 1,
    }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const t = tabs[(next + tabs.length) % tabs.length];
    asked.value = t.id;
    onChange(t.id);
  };
  return (
    <div ref={list} role="tablist" aria-label={label} class={cls} onKeyDown={onKeyDown}>
      {tabs.map((t) => (
        <Tab
          key={t.id}
          t={t}
          on={t.id === value}
          idPrefix={idPrefix}
          tabClass={tabClass}
          asked={asked}
          list={list}
          onSelect={() => onChange(t.id)}
        />
      ))}
    </div>
  );
}

/** One tab; it takes the focus when a key of its tablist asked for it (docs/web-page-flows.md, section 1). */
function Tab<T extends string>({
  t,
  on,
  idPrefix,
  tabClass,
  asked,
  list,
  onSelect,
}: {
  t: TabSpec<T>;
  on: boolean;
  idPrefix: string;
  tabClass: string;
  asked: Signal<T | null>;
  list: { current: HTMLElement | null };
  onSelect: () => void;
}) {
  const el = useRef<HTMLButtonElement>(null);
  useFocusRequest(
    asked.value === t.id,
    el,
    () => {
      asked.value = null;
    },
    (at) => !!at && !!list.current?.contains(at),
  );
  return (
    <button
      ref={el}
      type="button"
      role="tab"
      id={`${idPrefix}-tab-${t.id}`}
      aria-controls={on ? `${idPrefix}-panel-${t.id}` : undefined}
      aria-selected={on}
      tabIndex={on ? 0 : -1}
      class={`${tabClass}${on ? " on" : ""}`}
      onClick={onSelect}
    >
      {t.marker}
      <span class="tl" data-label={t.label}>
        {t.label}
      </span>
    </button>
  );
}

/** The props of the panel that tab `id` of the tablist `idPrefix` controls. */
export const tabpanelProps = (idPrefix: string, id: string) =>
  ({ role: "tabpanel", id: `${idPrefix}-panel-${id}`, "aria-labelledby": `${idPrefix}-tab-${id}` }) as const;
