// The notes under a run's error, in the page's own words (LogView.tsx shows them).

/** Community commands the engine does not have (F 3.5). */
const COMMUNITY = ["reghdfe", "esttab", "estout", "outreg2", "ivreg2", "xtivreg2", "ftools", "winsor2"];

/** A note to put under a run's error, in the page's words, or null. `rc` and `error` are the
 *  run's. Two cases: `restore` with nothing preserved (r(622)); a community command (r(199)). A temporary name from an
 *  earlier run (r(601) naming the engine's temporary file) has no note: the engine's own line says it
 *  (src/dofile/browser.py TEMPFILE_HINT, "a tempfile lasts one run: save it under a name to use it in a later run"). */
export function noteFor(rc: number, error: string | null): string | null {
  if (!error) return null;
  if (rc === 622 && /nothing to restore/.test(error))
    return "Nothing was preserved. A run restores its data when it ends, so put preserve and restore in the same run.";
  const m = rc === 199 ? /command (\S+) is unrecognized/.exec(error) : null;
  if (m && COMMUNITY.includes(m[1]))
    return `${m[1]} is a community command. OpenDTA, the engine behind dofile, doesn't include it.`;
  return null;
}
