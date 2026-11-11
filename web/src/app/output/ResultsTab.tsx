// The Results tab (docs/design/SPEC.md, section 3.9; P/Results, S 18): one table of three fixed columns (name, value,
// action). Sections "e() · regress", "r()" and "Locals and globals" hold groups that fold (Scalars, Macros, Matrices,
// Locals, Globals), each with its count. Values show 8 significant digits and every digit when focused or hovered; Enter
// or Ctrl/Cmd+C on a focused value copies all of them ("Copied"). A matrix row shows its size ("1 x 3") and View, which
// opens the matrix in place as a grid (engine.ts call("matrix"): no command, nothing in the log or the history); Hide
// folds it; copying a matrix copies tab-separated text.
//
// Values are buttons, one in the tab order, ↑ ↓ Home End move; group heads are buttons with aria-expanded. The folds,
// the focused and hovered value and the open matrices are signals of view.ts. An open matrix belongs to the `results` it
// was read for: after another run it is closed, since its values could be another model's.

import { call } from "../engine.ts";
import { macros, results, showToast } from "../state.ts";
import type { Results } from "../types.ts";
import { Icon } from "../ui/Icon";
import { copyText } from "./clip.ts";
import {
  full,
  hasValues,
  matrixTsv,
  type ResultGroup,
  type ResultRow,
  type ResultSection,
  sections,
  shown,
  sizeLabel,
} from "./format.ts";
import { focusVal, folds, hotVal, type OpenMatrix, openMatrices } from "./view.ts";

const EMPTY = "e() and r() appear after an estimation or a command such as ";
const EMPTY_2 = ", with the locals and globals your runs set.";
const MAX_ROWS = 100; // a matrix grid shows this many rows and columns at most; Copy has them all
const MAX_COLS = 30;
const NO_ENGINE = "the engine is not running";

export const EmptyResults = () => (
  <div class="empty">
    <b>No results yet</b>
    {EMPTY}
    <code>summarize</code>
    {EMPTY_2}
  </div>
);

const isOpen = (g: ResultGroup) => folds.value[g.id] ?? g.open;

/** The matrix `name` ("e(b)") as it was read for `rs`, or null: not opened, or opened for earlier results. */
const matrixFor = (name: string, rs: Results | null): OpenMatrix | null => {
  const m = openMatrices.value[name];
  return m && m.for === rs ? m : null;
};

function setMatrix(name: string, m: OpenMatrix | null) {
  const next = { ...openMatrices.value };
  if (m) next[name] = m;
  else delete next[name];
  openMatrices.value = next;
}

/** Read matrix `name` of the current results from the engine. Resolves the entry written (null when the results changed
 *  meanwhile and the answer is not for them). */
async function readMatrix(name: string): Promise<OpenMatrix | null> {
  const rs = results.value;
  if (!rs) return null;
  setMatrix(name, { for: rs, status: "loading" });
  let entry: OpenMatrix;
  try {
    const m = await call("matrix", { name });
    entry = hasValues(m) ? { for: rs, status: "ready", matrix: m } : { for: rs, status: "error", message: m.error };
  } catch {
    entry = { for: rs, status: "error", message: NO_ENGINE };
  }
  if (results.value !== rs) return null; // another run replaced the results: this answer is for the old ones
  setMatrix(name, entry);
  return entry;
}

/** Copy a matrix as tab-separated text, reading it first if it is not open. */
async function copyMatrix(name: string) {
  const open = matrixFor(name, results.value);
  const entry = open?.status === "ready" ? open : await readMatrix(name);
  if (entry?.status === "ready") await copyText(matrixTsv(entry.matrix));
  else showToast("Couldn't read the matrix");
}

function MatrixGrid({ entry, name }: { entry: OpenMatrix; name: string }) {
  if (entry.status === "loading") return <span class="muted">Reading {name}…</span>;
  if (entry.status === "error")
    return (
      <span class="muted">
        Couldn't read {name}: {entry.message}
      </span>
    );
  const { rows, cols, data } = entry.matrix;
  const cut = rows.length > MAX_ROWS || cols.length > MAX_COLS;
  return (
    <>
      <div class="grid-wrap">
        <table class="grid">
          <thead>
            <tr>
              <th class="obs">
                <span class="visually-hidden">Row</span>
              </th>
              {cols.slice(0, MAX_COLS).map((c, j) => (
                <th key={j}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, MAX_ROWS).map((r, i) => (
              <tr key={i}>
                <td class="obs">{r}</td>
                {data[i].slice(0, MAX_COLS).map((v, j) => (
                  <td key={j} title={full(v)}>
                    {shown(v)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cut && (
        <p class="note">
          Showing the first {Math.min(rows.length, MAX_ROWS)} rows and {Math.min(cols.length, MAX_COLS)} columns of{" "}
          {rows.length} x {cols.length}; Copy has them all.
        </p>
      )}
    </>
  );
}

function Row({ row, tabbable }: { row: ResultRow; tabbable: boolean }) {
  const rs = results.value;
  const hot = hotVal.value === row.key;
  const isMatrix = row.matrix !== undefined;
  const open = isMatrix ? matrixFor(row.matrix as string, rs) : null;
  const text = isMatrix ? sizeLabel(String(row.value)) : hot ? full(row.value) : shown(row.value);
  const copy = () => (isMatrix ? copyMatrix(row.matrix as string) : copyText(full(row.value)));
  return (
    <>
      <tr class={`row${hot ? " focusrow" : ""}`}>
        <td>{row.name}</td>
        <td>
          <button
            type="button"
            class="val"
            data-key={row.key}
            tabIndex={tabbable ? 0 : -1}
            aria-label={`${row.name}: ${text}`}
            onFocus={() => {
              focusVal.value = hotVal.value = row.key;
            }}
            onBlur={() => {
              if (hotVal.value === row.key) hotVal.value = null;
            }}
            onPointerEnter={() => {
              hotVal.value = row.key;
            }}
            onPointerLeave={() => {
              if (hotVal.value === row.key && document.activeElement?.getAttribute("data-key") !== row.key)
                hotVal.value = null;
            }}
            onClick={copy}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
                e.preventDefault();
                copy();
              }
            }}
          >
            {text}
          </button>
        </td>
        <td class="act">
          {isMatrix ? (
            <button
              type="button"
              class="link-btn"
              aria-expanded={open !== null}
              aria-label={`${open ? "Hide" : "View"} ${row.matrix}`}
              onClick={() => (open ? setMatrix(row.matrix as string, null) : readMatrix(row.matrix as string))}
            >
              {open ? "Hide" : "View"}
            </button>
          ) : (
            hot && <span class="hint">↵ Copy</span>
          )}
        </td>
      </tr>
      {open && (
        <tr class="mat">
          <td colSpan={3}>
            <MatrixGrid entry={open} name={row.matrix as string} />
          </td>
        </tr>
      )}
    </>
  );
}

function Group({ group, tabKey }: { group: ResultGroup; tabKey: string | undefined }) {
  const open = isOpen(group);
  return (
    <>
      <tr class="grp">
        <td colSpan={3}>
          <button
            type="button"
            class="fold"
            aria-expanded={open}
            onClick={() => {
              folds.value = { ...folds.value, [group.id]: !open };
            }}
          >
            <Icon name={open ? "down" : "right"} />
            {group.title}
            <span class="count">{group.note}</span>
          </button>
        </td>
      </tr>
      {open && group.rows.map((row) => <Row key={row.key} row={row} tabbable={row.key === tabKey} />)}
    </>
  );
}

const Section = ({ section, tabKey }: { section: ResultSection; tabKey: string | undefined }) => (
  <>
    <tr class="sect">
      <td colSpan={3}>
        {section.title}
        {section.changed && <span class="aside">changed by the last run</span>}
      </td>
    </tr>
    {section.groups.map((g) => (
      <Group key={g.id} group={g} tabKey={tabKey} />
    ))}
  </>
);

export function ResultsTab() {
  const list = sections(results.value, macros.value);
  if (!list.length) return <EmptyResults />;
  // the value in the tab order: the one last focused if it is still shown, else the first shown
  const keys = list.flatMap((s) => s.groups.filter(isOpen).flatMap((g) => g.rows.map((r) => r.key)));
  const tabKey = keys.includes(focusVal.value ?? "") ? (focusVal.value ?? undefined) : keys[0];
  const onKeyDown = (e: KeyboardEvent) => {
    const buttons = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>("button.val")];
    const i = buttons.indexOf(e.target as HTMLButtonElement);
    const next = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: buttons.length - 1 }[e.key];
    if (i < 0 || next === undefined) return;
    e.preventDefault();
    buttons[Math.min(Math.max(next, 0), buttons.length - 1)]?.focus();
  };
  return (
    <div class="out-scroll">
      <table class="rs" onKeyDown={onKeyDown}>
        <colgroup>
          <col class="name" />
          <col />
          <col class="act" />
        </colgroup>
        <tbody>
          {list.map((s) => (
            <Section key={s.id} section={s} tabKey={tabKey} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
