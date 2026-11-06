# Agent ergonomics (dofile's own issues)

Things that made dofile hard for an agent to use through the MCP server, found by running real replications as a
student would ([replication-tests.md](replication-tests.md)). These are in dofile's adapter, sandbox and MCP layer
(`src/dofile/`), so they are fixed here, with no patch and no upstream report. Problems in the vendored engine are
in [opendta-issues.md](opendta-issues.md) (ODT-*, GAP-*).

Status values: `open`, `fixed` (with the test that covers it). The numbers were measured on 2026-11-05.

| ID | Symptom | Where | Status |
|---|---|---|---|
| ERG-1 | `run_do`'s log cut lost a loop's results and short results between long outputs, without saying how much | `mcp_server._cut_log` | fixed: `tests/test_log_cut.py` |
| ERG-2 | a tempfile's local name outlives the file: the next call failed with rc 601 and an internal path, no explanation | `engine.py` (per-call scope) | fixed: `test_tempfile_name_outliving_its_file_gets_a_hint` |
| ERG-3 | `results` showed `e()`/`r()` from data or a command no longer current, unlabeled | `engine.results()` | fixed: `test_results_say_whether_the_call_changed_e_and_r` |
| ERG-4 | reconnecting or restarting the MCP server wipes the session, and nothing said so | `mcp_server.py` instructions, `MCP-SCHEMA.md` | fixed (docs) |
| ERG-5 | rc 603 meant both "folder missing" and "the sandbox refused", and the sandbox's reason was hidden | sandbox, `engine.py` | fixed: `tests/test_sandbox.py` |

## Details

### ERG-1: log truncation
```stata
clear
set obs 500
set seed 1
foreach v in a b c d e f g h i j k l m n o p {
    gen `v' = rnormal()
}
gen y = a + b + rnormal()
foreach c in 1 2 3 4 5 {
    regress y a b c d e f g h i j k l m n o p if mod(_n,5)==`c'-1
    display "RESULT iteration `c': b1=" %6.3f _b[a]
}
display "LAST LINE"
```
- Problem: the full log is 11,214 characters, 171 lines; the old `_cut_log` returned 4,139, and the `RESULT` lines of
  iterations 2, 3 and 4, printed by the code's own `display`, were gone. The same regressions written flat came to
  11,461 characters; the 8,000-character cap cut the middle and lost iterations 2 and 3.
- Cause: the old code started a block only at a `. ` command echo and kept each block's first 40 and last 15 lines.
  A `foreach` body is echoed once, up front (`  2.     regress ...`), and all of its output follows with no
  per-command markers, so a whole loop was one block. (An early sketch of this entry proposed splitting blocks at
  those echo lines; that can't work, because the output doesn't come after each echo.)
- Fix: a log that fits `LOG_LIMIT` (8,000 characters) is kept whole. Otherwise the biggest blocks of output (runs of
  lines between blank lines: a table, a listing) are cut first, to their first 40 and last 15 lines and then, if still
  too long, to their first 5 and last 3. A `display` line under a table is the last line of its block, so it stays.
  Command echoes are never cut. Only if every block is already short is the middle of the log dropped. The result has
  `log_omitted_lines` when anything was cut, and the instructions say to use `quietly` in loops and `display` what is
  needed.
- Result on the loop above: 7,002 characters, all five `RESULT` lines and `LAST LINE` present, 56 lines omitted.
- Behavior change: a log under 8,000 characters is no longer cut per command; a 100-row `list` stays whole.

### ERG-2: tempfile name outlives the file
```stata
* call 1
tempfile t
save `t'
* call 2
use `t', clear
```
- Problem: call 2 gave rc 601 `file /var/folders/.../opendta-88416/S__000000.dta not found`, naming an internal path
  and not saying why.
- Cause: `Engine.run` wraps each call in its own do-file scope (`Scope("do", "run")`), and closing it deletes the
  call's tempfiles, as in Stata. Macros are deliberately kept across calls (locals carry over), so the name survives.
- Fix: a 601 whose path is an OpenDTA tempfile gets `(a tempfile lasts one run_do call: save it under a name to use
  it in a later call)` added to the error and the log. The server instructions say the same.

### ERG-3: `results` can describe things that are gone
```stata
clear
set obs 400
gen x = rnormal()
gen y = x + rnormal()
regress y x
clear
```
- Problem: after `clear` the result has `nobs` 0 and `e(N)` 400. After a failed command, `r()` is the previous
  command's (a failed `graph export` came back with an earlier `summarize`'s `r()`). Stata does the same (`e()`
  survives `clear`, `r()` survives an error), so the engine is faithful; an agent could still read `e(N) = 400` as
  the data in memory.
- Fix: `results` has `e_changed` and `r_changed`, true when the call changed that group (its values differ from
  before the call; a matrix counts as unchanged only if untouched). `clear` gives `false, false`; `summarize` after
  it gives `false, true`; a failed command `false, false`.

### ERG-4: reconnecting the server wipes the session
- Problem: `/mcp` reconnect or a restart (needed to load changed dofile code, since the server runs the code it
  started with) starts a new process: data, stored estimates, macros, scalars, graphs and tempfiles are gone. Files
  saved in the working folder stay. Nothing in the docs said so.
- Fix: a paragraph under `reset` in `MCP-SCHEMA.md` and a sentence in the server instructions: save to a `.dta`
  before a reload and re-run the setup after it.

### ERG-5: rc 603 for two different causes
```stata
clear
set obs 20
gen x = _n
gen y = x^2
twoway line y x
graph export nofolder/x.png, replace    // rc 603: file nofolder/x.png could not be opened
graph export ../escaped.png, replace    // sandbox refusal, also rc 603
```
- Problem: a folder that doesn't exist and a sandbox refusal both give rc 603. The first is Stata's own behavior and
  the engine is right. The second is dofile's choice (CLAUDE.md: "603 (sandbox refused a file)"), and OpenDTA's
  `graph export` printed its generic text ("The operating system did not allow the file to be written...") without
  the sandbox's reason, where `save`, `export delimited` and `log using` showed it. An agent kept retrying the same
  write. (This was ODT-7 in `opendta-issues.md`, moved here because nothing is wrong on the engine side.)
- Fix: `SandboxError` records its message in `sandbox.refusals` (the last 50). When a call ends with rc 603 and the
  text doesn't already show a sandbox reason, `Engine.run` adds the refusal that names the failing file, to the
  error and to the log: `... (dofile sandbox: cannot write /path/escaped.png)`.
- Only a refusal that names the failing file is used: matplotlib scans font folders at the first plot, the sandbox
  refuses some of them (`cannot list /opt/local/share/fonts`) and the library swallows it, and an earlier version
  of this fix blamed that on an unrelated missing folder. The match is by file name (the last path component of
  the refusal appears in the error), so a very short name could match by chance.
