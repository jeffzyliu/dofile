// A tablist with roving focus: one tab in the tab order (the selected one); Left/Right (Up/Down too) move and select,
// Home and End go to the ends. Used by the Output tabs, the unsplit Log pane and the phone's Views bar. Each tab is
// `${idPrefix}-tab-${id}`; the selected one controls `${idPrefix}-panel-${id}` (only the selected panel need exist): give
// the panel that id, role="tabpanel" and aria-labelledby the tab (tabpanelProps does it).
import type { ComponentChildren } from "preact";

export interface TabSpec<T extends string> { id: T; label: ComponentChildren; marker?: ComponentChildren }

export function Tablist<T extends string>({ label, tabs, value, onChange, idPrefix, class: cls = "tabstrip", tabClass = "tab" }:
  { label: string; tabs: TabSpec<T>[]; value: T; onChange: (id: T) => void; idPrefix: string; class?: string; tabClass?: string }) {
  const onKeyDown = (e: KeyboardEvent) => {
    const i = tabs.findIndex(t => t.id === value);
    const next = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const t = tabs[(next + tabs.length) % tabs.length];
    onChange(t.id);
    document.getElementById(`${idPrefix}-tab-${t.id}`)?.focus();
  };
  return (
    <div role="tablist" aria-label={label} class={cls} onKeyDown={onKeyDown}>
      {tabs.map(t => (
        <button type="button" role="tab" id={`${idPrefix}-tab-${t.id}`}
          aria-controls={t.id === value ? `${idPrefix}-panel-${t.id}` : undefined}
          aria-selected={t.id === value} tabIndex={t.id === value ? 0 : -1} class={`${tabClass}${t.id === value ? " on" : ""}`}
          onClick={() => onChange(t.id)}>
          {t.marker}{t.label}
        </button>
      ))}
    </div>
  );
}

/** The props of the panel that tab `id` of the tablist `idPrefix` controls. */
export const tabpanelProps = (idPrefix: string, id: string) =>
  ({ role: "tabpanel", id: `${idPrefix}-panel-${id}`, "aria-labelledby": `${idPrefix}-tab-${id}` }) as const;
