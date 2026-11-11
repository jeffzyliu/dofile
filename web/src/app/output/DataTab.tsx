// The Data tab (docs/design/SPEC.md, section 3.8; P/Data, S 17): the facts of the data in memory, the "Filter variables"
// field, the variables table, and Browse, the first rows read only. It reads `data`, `rows` and `memory`, which run.ts
// fills after each run. It never calls `browse`: "Show 50 more" is run.ts moreRows(), which appends to `rows`.
//
// A click on a name picks it (`pickedVar`): Browse scrolls to its column and marks it, and nothing else happens: no
// command, nothing in the log, the editor or the command line. Names are buttons, one in the tab order; ↑ ↓ Home End
// move the focus, Enter or Space picks; the picked one has aria-current. The filter text, the focused name and the cells
// shown whole are signals of view.ts, so the tab comes back as it was after a layout change.

import { useEffect, useRef } from "preact/hooks";
import { moreRows } from "../run.ts";
import { banners, data, memory, pickedVar, rows, say } from "../state.ts";
import type { BrowseRows, DataSummary } from "../types.ts";
import { bytes, count, cutCell } from "./format.ts";
import { filterText, focusVar, loadingRows, openCells } from "./view.ts";

const EMPTY = "Load a .dta from the file list, or run ";
const EMPTY_2 = " or ";
const EMPTY_3 = ", or a do-file that builds the data.";
const EMPTY_RESET = "The engine was reset, so no data is in memory";

type Summary = Exclude<DataSummary, { error: string }>;
type Rows = Exclude<BrowseRows, { error: string }>;

export const EmptyData = () => {
  const reset = banners.value.some((b) => b.b === "reset");
  return (
    <div class="empty">
      <b>No data in memory</b>
      {reset ? (
        EMPTY_RESET
      ) : (
        <>
          {EMPTY}
          <code>use</code>
          {EMPTY_2}
          <code>import delimited</code>
          {EMPTY_3}
        </>
      )}
    </div>
  );
};

/** Variable names, labels, types and formats, filtered by the field. */
function Variables({ d }: { d: Summary }) {
  const picked = pickedVar.value;
  const text = filterText.value.trim().toLowerCase();
  const shown = text
    ? d.variables.filter((v) => v.name.toLowerCase().includes(text) || (v.label ?? "").toLowerCase().includes(text))
    : d.variables;
  const stop = shown.find((v) => v.name === focusVar.value)?.name ?? shown.find((v) => v.name === picked)?.name;
  const tabbable = stop ?? shown[0]?.name;
  const onKeyDown = (e: KeyboardEvent) => {
    const buttons = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>("button.var")];
    const i = buttons.indexOf(e.target as HTMLButtonElement);
    const next = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: buttons.length - 1 }[e.key];
    if (i < 0 || next === undefined) return;
    e.preventDefault();
    buttons[Math.min(Math.max(next, 0), buttons.length - 1)]?.focus();
  };
  return (
    <>
      <input
        class="filter"
        type="search"
        aria-label="Filter variables"
        placeholder="Filter variables"
        autocomplete="off"
        value={filterText.value}
        onInput={(e) => {
          filterText.value = (e.target as HTMLInputElement).value;
        }}
      />
      <div class="scroll-x">
        <table class="t" onKeyDown={onKeyDown}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Label</th>
              <th>Type</th>
              <th>Format</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((v) => (
              <tr key={v.name} class={v.name === picked ? "picked" : undefined}>
                <td class="mono">
                  <button
                    type="button"
                    class="var"
                    aria-current={v.name === picked ? "true" : undefined}
                    tabIndex={v.name === tabbable ? 0 : -1}
                    onFocus={() => {
                      focusVar.value = v.name;
                    }}
                    onClick={() => {
                      pickedVar.value = v.name === picked ? null : v.name;
                    }}
                  >
                    {v.name}
                  </button>
                </td>
                <td class={v.label ? undefined : "muted"}>{v.label || "no label"}</td>
                <td class="mono">{v.type}</td>
                <td class="mono">{v.format}</td>
              </tr>
            ))}
            {!shown.length && (
              <tr>
                <td class="muted" colSpan={4}>
                  No variable matches the filter
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** One Browse cell. A long value (a strL can be thousands of characters with line breaks) is cut to a line; pressing
 *  the cut cell shows the whole value, pressing it again cuts it; its title holds the value too. */
function Cell({ id, value, str, picked }: { id: string; value: string; str: boolean; picked: boolean }) {
  const c = cutCell(value);
  const open = c.cut && openCells.value.has(id);
  const cls = [str || c.cut ? "str" : "", picked ? "picked" : "", open ? "open" : ""].filter(Boolean).join(" ");
  if (!c.cut) return <td class={cls || undefined}>{value}</td>;
  return (
    <td class={cls}>
      <button
        type="button"
        class={`cell-cut${open ? " open" : ""}`}
        title={c.title}
        aria-expanded={open}
        onClick={() => {
          const next = new Set(openCells.value);
          if (!next.delete(id)) next.add(id);
          openCells.value = next;
        }}
      >
        {open ? value : c.text}
      </button>
    </td>
  );
}

/** Browse: the rows as a grid under a head that says how many there are. The picked variable's column is marked and
 *  scrolled into view (sideways only: the pane does not jump). */
function Browse({ d, r }: { d: Summary; r: Rows }) {
  const wrap = useRef<HTMLDivElement>(null);
  const picked = pickedVar.value;
  const shape = r.vars.join(" ");
  useEffect(() => {
    const box = wrap.current;
    const th = box && [...box.querySelectorAll<HTMLElement>("th[data-var]")].find((t) => t.dataset.var === picked);
    if (!box || !th) return;
    box.scrollLeft +=
      th.getBoundingClientRect().left - box.getBoundingClientRect().left - (box.clientWidth - th.offsetWidth) / 2;
  }, [picked, shape]);
  const strings = new Set(d.variables.filter((v) => v.type.startsWith("str")).map((v) => v.name));
  const label =
    r.more > 0
      ? `first ${count(r.rows.length)} of ${count(r.nobs)} rows`
      : `${count(r.nobs)} ${r.nobs === 1 ? "row" : "rows"}`;
  return (
    <>
      <div class="subhead">
        <h3>Browse</h3>
        <span class="aside">
          {label} · read only
          {r.more > 0 && (
            <>
              {" · "}
              <button
                type="button"
                class="link-btn"
                disabled={loadingRows.value}
                onClick={async () => {
                  loadingRows.value = true;
                  try {
                    if (await moreRows()) say("More rows shown");
                  } finally {
                    loadingRows.value = false;
                  }
                }}
              >
                Show {Math.min(50, r.more)} more
              </button>
            </>
          )}
        </span>
      </div>
      <div class="grid-wrap" ref={wrap}>
        <table class="grid">
          <thead>
            <tr>
              <th class="obs">
                <span class="visually-hidden">Obs</span>
              </th>
              {r.vars.map((n) => (
                <th key={n} data-var={n} class={n === picked ? "picked" : undefined}>
                  {n}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {r.rows.map((row, i) => (
              <tr key={r.offset + i}>
                <td class="obs">{r.offset + 1 + i}</td>
                {row.map((value, j) => (
                  <Cell
                    key={r.vars[j]}
                    id={`${r.offset + 1 + i}:${r.vars[j]}`}
                    value={value}
                    str={strings.has(r.vars[j])}
                    picked={r.vars[j] === picked}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function DataTab() {
  const d = data.value;
  if (!d || "error" in d || (d.nobs === 0 && d.nvars === 0)) return <EmptyData />;
  const r = rows.value;
  const mem = memory.value;
  return (
    <div class="out-scroll">
      <div class="facts">
        <span>
          <b>{count(d.nobs)}</b> obs
        </span>
        <span>
          <b>{count(d.nvars)}</b> vars
        </span>
        {d.filename && (
          <span>
            from <b>{d.filename}</b>
          </span>
        )}
        {mem && <span>{bytes(mem.data_bytes)} in memory</span>}
      </div>
      <Variables d={d} />
      {r && "error" in r && <p class="note">{r.error}</p>}
      {r && !("error" in r) && <Browse d={d} r={r} />}
    </div>
  );
}
