// The Results tab's matrices (ResultsTab.tsx draws them): the read protocol (a request, its answer, the answer that is
// stale, the error) and the copy check's timer. An open matrix and the copied check belong to the `results` they were
// read for (view.ts, openMatrices and copiedRow): after another run they are gone.

import type { Results } from "../types.ts";

import { showToast } from "../state/notices.ts";
import { macros, results } from "../state/run.ts";

import { call } from "../engine.ts";

import { copyText } from "./clip.ts";
import type { ResultRow } from "./format.ts";
import { copiedNote, full, hasValues, matrixTsv } from "./format.ts";
import type { OpenMatrix } from "./view.ts";
import { copiedRow, openMatrices } from "./view.ts";

export const NO_ENGINE = "the engine isn't running";
export const COPIED_MS = 2000; // as the landing page's Copy (src/site/site.ts)

/** The matrix `name` ("e(b)") as it was read for `rs`, or null: not opened, or opened for earlier results. */
export const matrixFor = (name: string, rs: Results | null): OpenMatrix | null => {
  const m = openMatrices.value[name];
  return m && m.for === rs ? m : null;
};

function setMatrix(name: string, m: OpenMatrix | null) {
  const next = { ...openMatrices.value };
  if (m) next[name] = m;
  else delete next[name];
  openMatrices.value = next;
}

/** Hide matrix `name`. A read still on its way leaves it hidden. */
export const closeMatrix = (name: string) => setMatrix(name, null);

const CHANGED = "changed"; // fetchMatrix's answer when the engine's results are no longer `rs`

/** Ask the engine for matrix `name` as it stands for `rs`. */
async function fetchMatrix(name: string, rs: Results): Promise<OpenMatrix | typeof CHANGED> {
  try {
    const m = await call("matrix", { name, runId: rs.runId });
    if ("changed" in m) return CHANGED;
    return hasValues(m) ? { for: rs, status: "ready", matrix: m } : { for: rs, status: "error", message: m.error };
  } catch {
    return { for: rs, status: "error", message: NO_ENGINE };
  }
}

/** Read matrix `name` of the current results from the engine and open it. Resolves the entry written (null when the
 *  results changed meanwhile and the answer is not for them: a toast says so). */
export async function readMatrix(name: string): Promise<OpenMatrix | null> {
  const rs = results.value;
  if (!rs) return null;
  const loading: OpenMatrix = { for: rs, status: "loading" };
  setMatrix(name, loading);
  const entry = await fetchMatrix(name, rs);
  if (openMatrices.value[name] !== loading) return null; // hidden (or read again) while it was loading: leave it so
  if (entry === CHANGED) {
    setMatrix(name, null);
    showToast("The results changed: open it again", "error");
    return null;
  }
  if (results.value !== rs) return null; // another run replaced the results: this answer is for the old ones
  setMatrix(name, entry);
  return entry;
}

/** Copy a matrix as tab-separated text; `done` is the toast. An open matrix is copied as it is; a closed one is read
 *  without opening it. Resolves whether it was copied. */
async function copyMatrix(name: string, done: string): Promise<boolean> {
  const rs = results.value;
  const open = matrixFor(name, rs);
  if (open?.status === "ready") return copyText(matrixTsv(open.matrix), done);

  const entry = rs ? await fetchMatrix(name, rs) : null;
  if (entry === CHANGED || (entry?.status === "ready" && results.value !== rs)) {
    showToast("The results changed: copy again", "error");
    return false;
  }
  if (entry?.status === "ready") return copyText(matrixTsv(entry.matrix), done);
  showToast("Couldn't read the matrix", "error");
  return false;
}

let copiedTimer: ReturnType<typeof setTimeout> | undefined;
/** Copy a row (a matrix as a whole); once copied, its icon is a check for COPIED_MS. */
export async function copyRow(row: ResultRow) {
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
