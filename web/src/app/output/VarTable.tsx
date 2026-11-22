// The variables table of the Data tab and of a .dta's tab; the name buttons, the marked row and the arrow keys only when
// `pick` is given.
import type { DataSummary } from "../types.ts";

type Variable = Pick<
  Exclude<DataSummary, { error: string }>["variables"][number],
  "name" | "label" | "type" | "format"
>;

export type Picking = {
  picked: string | null;
  /** The one name button in the tab order. */
  tabbable: string | undefined;
  onFocus: (name: string) => void;
  onPick: (name: string) => void;
};

export function VarTable({ variables, pick }: { variables: Variable[]; pick?: Picking }) {
  const onKeyDown = (e: KeyboardEvent) => {
    const buttons = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>("button.var")];
    const i = buttons.indexOf(e.target as HTMLButtonElement);
    const next = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: buttons.length - 1 }[e.key];
    if (i < 0 || next === undefined) return;
    e.preventDefault();
    buttons[Math.min(Math.max(next, 0), buttons.length - 1)]?.focus();
  };
  return (
    <div class="scroll-x">
      <table class="t" onKeyDown={pick ? onKeyDown : undefined}>
        <thead>
          <tr>
            <th>Name</th>
            <th>Label</th>
            <th>Type</th>
            <th>Format</th>
          </tr>
        </thead>
        <tbody>
          {variables.map((v) => (
            <tr key={v.name} class={pick && v.name === pick.picked ? "picked" : undefined}>
              <td class="mono">
                {pick ? (
                  <button
                    type="button"
                    class="var"
                    aria-current={v.name === pick.picked ? "true" : undefined}
                    tabIndex={v.name === pick.tabbable ? 0 : -1}
                    onFocus={() => pick.onFocus(v.name)}
                    onClick={() => pick.onPick(v.name)}
                  >
                    {v.name}
                  </button>
                ) : (
                  v.name
                )}
              </td>
              <td class={v.label ? undefined : "muted"}>{v.label || "no label"}</td>
              <td class="mono">{v.type}</td>
              <td class="mono">{v.format}</td>
            </tr>
          ))}
          {pick && !variables.length && (
            <tr>
              <td class="muted" colSpan={4}>
                No variable matches the filter
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
