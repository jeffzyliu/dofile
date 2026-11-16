// The Results tab (docs/design/SPEC.md, section 3.9): one table of name, value and action columns, in groups that fold.
// Hover and keyboard-focus reveals (every digit, the copy icon) are CSS only (ui.css, "results"). An open matrix and the
// copied check belong to the `results` they were read for: after another run they are gone (the values could be
// another model's).

import { useId } from "preact/hooks";
import { call } from "../engine.ts";
import { macros, results, showToast } from "../state.ts";
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
 *  without opening it. Resolves whether it was copied. */
async function copyMatrix(name: string, done: string): Promise<boolean> {
  const rs = results.value;
  const open = matrixFor(name, rs);
  const entry = open?.status === "ready" ? open : rs ? await fetchMatrix(name, rs) : null;
  if (entry?.status === "ready") return copyText(matrixTsv(entry.matrix), done);
  showToast("Couldn't read the matrix", "error");
  return false;
}

let copiedTimer: ReturnType<typeof setTimeout> | undefined;
/** Copy a row (a matrix as a whole); once copied, its icon is a check for COPIED_MS. */
async function copyRow(row: ResultRow) {
  const copied = { key: row.key, for: results.value, macros: macros.value }; // the run's, before a newer run can land
  const done =
    row.matrix !== undefined ? copyMatrix(row.matrix, copiedNote(row)) : copyText(full(row.value), copiedNote(row));
  if (!(await done)) return;
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
  const valueId = useId();
  const isMatrix = row.matrix !== undefined;
  const open = isMatrix ? matrixFor(row.matrix as string, rs) : null;
  const size = isMatrix ? sizeLabel(String(row.value)) : "";
  const short = isMatrix ? size : shown(row.value);
  const long = isMatrix ? size : full(row.value);
  const toggle = () => {
    if (open) setMatrix(row.matrix as string, null);
    else readMatrix(row.matrix as string);
  };
  const copyKey = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
      e.preventDefault();
      copyRow(row);
    }
  };
  const done =
    copiedRow.value?.key === row.key && copiedRow.value.for === rs && copiedRow.value.macros === macros.value;
  return (
    <>
      {/* a matrix row's click anywhere shows or hides its grid (its caret button is the keyboard's way: Enter and Space
          click here); a scalar or macro row has no click, so its value can be selected */}
      <tr
        class={isMatrix ? "row mx" : "row"}
        onClick={
          isMatrix
            ? (e) => {
                if (!endsSelection(e, e.currentTarget)) toggle();
              }
            : undefined
        }
      >
        <td>
          {isMatrix ? (
            <button
              type="button"
              class="rowfold"
              aria-expanded={open !== null}
              aria-label={`${row.name}, ${size}`}
              onKeyDown={copyKey}
            >
              <Icon name={open ? "down" : "right"} />
              {row.name}
            </button>
          ) : (
            row.name
          )}
        </td>
        <td>
          {isMatrix ? (
            short
          ) : short === long ? (
            <span class="val" id={valueId}>
              {short}
            </span>
          ) : (
            <span class="val">
              <span class="short">{short}</span>
              <span class="full" id={valueId}>
                {long}
              </span>
            </span>
          )}
        </td>
        <td class="act">
          <button
            type="button"
            class={done ? "copy done" : "copy"}
            aria-label={`Copy ${row.name}`}
            aria-describedby={isMatrix ? undefined : valueId}
            title="Copy"
            onKeyDown={isMatrix ? undefined : copyKey}
            onClick={(e) => {
              e.stopPropagation(); // a matrix row's click would toggle
              copyRow(row);
            }}
          >
            <Icon name={done ? "check" : "copy"} />
          </button>
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
