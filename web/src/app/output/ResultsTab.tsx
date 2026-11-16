// The Results tab (docs/design/SPEC.md, section 3.9; P/Results, S 18): one table of three fixed columns (name, value,
// action). Sections "e() · regress", "r()" and "Locals and globals" hold groups that fold (Scalars, Macros, Matrices,
// Locals, Globals), each with its count. Values show 8 significant digits, and every digit on a hovered row or a value
// with keyboard focus (CSS only: ui.css, "results"). A click or tap anywhere on a scalar or macro row, or Enter or
// Ctrl/Cmd+C on its value, copies every digit: the toast names the row ("Copied e(r2)") and the row's action cell says
// "✓ Copied" for COPIED_MS. A click that ends a text selection in the row (a drag, a double-click) selects, and does not
// act. Every row shows the pointer.
// A matrix row shows its size ("1 x 3"), View and Copy. View opens the matrix in place as a grid (engine.ts
// call("matrix"): no command, nothing in the log or the history); Hide folds it. A click anywhere on the row (Enter or
// Space on its value) does the same as View or Hide and copies nothing. Copy, or Ctrl/Cmd+C on the value, copies the
// whole matrix as tab-separated text (the toast only); a copy that had to read the matrix leaves it closed. A click on a
// grid cell copies that cell's every digit ("Copied e(b)[y1, age]"); a click that ends a text selection in the grid does
// not. Cells are for the mouse and touch; the keyboard has Copy.
//
// Values are buttons, each a Tab stop; group heads are buttons with aria-expanded. The folds, the row just copied and the
// open matrices are signals of view.ts. An open matrix and "✓ Copied" belong to the `results` they were read for: after
// another run they are gone, since the values could be another model's.

import { call } from "../engine.ts";
import { isPhone, macros, results, showToast } from "../state.ts";
import type { Results } from "../types.ts";
import { Icon } from "../ui/Icon";
import { copyText } from "./clip.ts";
import {
  copiedNote,
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
import { copiedRow, folds, type OpenMatrix, openMatrices } from "./view.ts";

const EMPTY = "e() and r() appear after an estimation or a command such as ";
const EMPTY_2 = ", with the locals and globals your runs set.";
const MAX_ROWS = 100; // a matrix grid shows this many rows and columns at most; Copy has them all
const MAX_COLS = 30;
const NO_ENGINE = "the engine isn't running";
const COPIED_MS = 2000; // as the landing page's Copy (src/site/site.ts)

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

/** Ask the engine for matrix `name` as it stands for `rs`. */
async function fetchMatrix(name: string, rs: Results): Promise<OpenMatrix> {
  try {
    const m = await call("matrix", { name });
    return hasValues(m) ? { for: rs, status: "ready", matrix: m } : { for: rs, status: "error", message: m.error };
  } catch {
    return { for: rs, status: "error", message: NO_ENGINE };
  }
}

/** Read matrix `name` of the current results from the engine and open it. Resolves the entry written (null when the
 *  results changed meanwhile and the answer is not for them). */
async function readMatrix(name: string): Promise<OpenMatrix | null> {
  const rs = results.value;
  if (!rs) return null;
  const loading: OpenMatrix = { for: rs, status: "loading" };
  setMatrix(name, loading);
  const entry = await fetchMatrix(name, rs);
  if (results.value !== rs) return null; // another run replaced the results: this answer is for the old ones
  if (openMatrices.value[name] !== loading) return null; // hidden (or read again) while it was loading: leave it so
  setMatrix(name, entry);
  return entry;
}

/** Copy a matrix as tab-separated text; `done` is the toast. An open matrix is copied as it is; a closed one is read
 *  without opening it. */
async function copyMatrix(name: string, done: string) {
  const rs = results.value;
  const open = matrixFor(name, rs);
  const entry = open?.status === "ready" ? open : rs ? await fetchMatrix(name, rs) : null;
  if (entry?.status === "ready") await copyText(matrixTsv(entry.matrix), done);
  else showToast("Couldn't read the matrix", "error");
}

let copiedTimer: ReturnType<typeof setTimeout> | undefined;
/** Copy a scalar or macro row's every digit; once copied, its action cell says "✓ Copied" for COPIED_MS. */
async function copyValue(row: ResultRow) {
  const copied = { key: row.key, for: results.value, macros: macros.value }; // the run's, before a newer run can land
  if (!(await copyText(full(row.value), copiedNote(row)))) return;
  copiedRow.value = copied;
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => {
    copiedRow.value = null;
  }, COPIED_MS);
}

/** A click that ends a text selection inside `box` selects; Enter and Space have detail 0. */
const endsSelection = (e: MouseEvent, box: Element) => {
  const s = getSelection();
  return e.detail > 0 && s !== null && !s.isCollapsed && box.contains(s.anchorNode);
};

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
                  // biome-ignore lint/a11y/useKeyWithClickEvents: cells are for the mouse; the keyboard has the row's Copy
                  <td
                    key={j}
                    class="cell"
                    title={full(v)}
                    onClick={(e) => {
                      if (endsSelection(e, e.currentTarget.closest("table") as Element)) return;
                      copyText(full(v), `Copied ${name}[${r}, ${cols[j]}]`);
                    }}
                  >
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

function Row({ row }: { row: ResultRow }) {
  const rs = results.value;
  const isMatrix = row.matrix !== undefined;
  const open = isMatrix ? matrixFor(row.matrix as string, rs) : null;
  const short = isMatrix ? sizeLabel(String(row.value)) : shown(row.value);
  const long = isMatrix ? short : full(row.value);
  const toggle = () => {
    if (open) setMatrix(row.matrix as string, null);
    else readMatrix(row.matrix as string);
  };
  const copy = () => (isMatrix ? copyMatrix(row.matrix as string, copiedNote(row)) : copyValue(row));
  return (
    <>
      {/* a click anywhere on the row copies it (a matrix row shows or hides its grid); the value button is the keyboard's
          target, its Enter and Space click here */}
      <tr
        class="row"
        onClick={(e) => {
          if (endsSelection(e, e.currentTarget)) return;
          if (isMatrix) toggle();
          else copy();
        }}
      >
        <td>{row.name}</td>
        <td>
          <button
            type="button"
            class="val"
            aria-label={`${row.name}: ${long}`}
            aria-expanded={isMatrix ? open !== null : undefined}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
                e.preventDefault();
                copy();
              }
            }}
          >
            {short === long ? (
              short
            ) : (
              <>
                <span class="short">{short}</span>
                <span class="full">{long}</span>
              </>
            )}
          </button>
        </td>
        <td class="act">
          {isMatrix ? (
            <>
              <button
                type="button"
                class="link-btn"
                aria-expanded={open !== null}
                aria-label={`${open ? "Hide" : "View"} ${row.matrix}`}
                onClick={(e) => {
                  e.stopPropagation(); // the row's click would toggle a second time
                  toggle();
                }}
              >
                {open ? "Hide" : "View"}
              </button>{" "}
              <button
                type="button"
                class="link-btn"
                aria-label={`Copy ${row.matrix}`}
                onClick={(e) => {
                  e.stopPropagation(); // Copy does not toggle
                  copy();
                }}
              >
                Copy
              </button>
            </>
          ) : copiedRow.value?.key === row.key &&
            copiedRow.value.for === rs &&
            copiedRow.value.macros === macros.value ? (
            <span class="copied">
              <Icon name="check" />
              Copied
            </span>
          ) : (
            !isPhone.value && <span class="hint">↵ Copy</span>
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

function Group({ group }: { group: ResultGroup }) {
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
      {open && group.rows.map((row) => <Row key={row.key} row={row} />)}
    </>
  );
}

const Section = ({ section }: { section: ResultSection }) => (
  <>
    <tr class="sect">
      <td colSpan={3}>
        {section.title}
        {section.changed && <span class="aside">changed by the last run</span>}
      </td>
    </tr>
    {section.groups.map((g) => (
      <Group key={g.id} group={g} />
    ))}
  </>
);

export function ResultsTab() {
  const list = sections(results.value, macros.value);
  if (!list.length) return <EmptyResults />;
  return (
    <div class="out-scroll">
      <table class="rs">
        <colgroup>
          <col class="name" />
          <col />
          <col class="act" />
        </colgroup>
        <tbody>
          {list.map((s) => (
            <Section key={s.id} section={s} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
