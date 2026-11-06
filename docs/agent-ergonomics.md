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
| ERG-5 | rc 603 meant both "folder missing" and "the sandbox refused", and the sandbox's reason was hidden (also inside `capture`) | sandbox, `engine.py` | fixed: `tests/test_sandbox.py` |
| ERG-6 | smaller limits found by the audit: `get_file` returned up to 5 MB of text into the model's context; waiting calls on a busy session could use up the server's threads; every `run_do` listed the whole working folder twice | `mcp_server.py`, `worker.py` | fixed: `test_get_file_pages_text_and_a_busy_session_answers_at_once` |
| ERG-7 | in a long log the cut keeps a regression table's header and `_cons` and drops the coefficient rows, so the estimate an agent ran the call for (`D`, the treatment effect) is not in the log | `mcp_server._cut_log` | mitigated: `LOG_LIMIT` 12,000 and tables cut last (`tests/test_log_cut.py::test_coefficient_tables_are_cut_last`) |
| ERG-8 | an unavailable community command gives only `command rdrobust is unrecognized` (rc 199); `ssc install rdrobust` says `command ssc is unrecognized`, so an agent can't tell "not installed" from "never available" | `engine.py` / vendored error text | open |
| ERG-9 | rc 111 `pop ambiguous abbreviation` doesn't name the variables it could mean (`pop` could be `population` or `popwt`), so an agent can't fix it in one step | vendored error text | open |

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
- Fix: a log that fits `LOG_LIMIT` (12,000 characters; 8,000 until 2026-11-05) is kept whole. Otherwise the biggest blocks of output (runs of
  lines between blank lines: a table, a listing) are cut first, to their first 40 and last 15 lines and then, if still
  too long, to their first 5 and last 3. A `display` line under a table is the last line of its block, so it stays.
  Command echoes are never cut. Only if every block is already short is the middle of the log dropped. The result has
  `log_omitted_lines` when anything was cut, and the instructions say to use `quietly` in loops and `display` what is
  needed.
- Result on the loop above: 7,002 characters, all five `RESULT` lines and `LAST LINE` present, 56 lines omitted.
- Behavior change: a log under the limit is no longer cut per command; a 100-row `list` stays whole.

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
  before the call; a matrix counts as unchanged only if untouched; NaN equals NaN). A command that re-posts identical values, such as
  `summarize` run twice, reads as unchanged. `clear` gives `false, false`; `summarize` after
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
- Fix: `SandboxError` records its message in `sandbox.refusals` (the last 50). `Engine.run` then adds the refusal that
  names the failing file in two places:
  - **In the log**, under each `file X could not be opened` line (`_annotate_refusals`), so the reason shows even when
    `capture noisily` swallows the error and the call ends rc 0: `file ../escaped.png could not be opened`, then
    `dofile sandbox: cannot write /path/escaped.png`. A missing folder gets no such line. `_rc` stays 603 for both;
    only the log text tells them apart. (The first version added the reason only when the call ended in rc 603, so
    inside `capture` the two were indistinguishable again.)
  - **In `error`**, when the call does end in rc 603: `... (dofile sandbox: cannot write /path/escaped.png)`.
- Only a refusal that names the failing file is used: matplotlib scans font folders at the first plot, the sandbox
  refuses some of them (`cannot list /opt/local/share/fonts`) and the library swallows it, and an earlier version
  of this fix blamed that on an unrelated missing folder. The match is by file name (the last path component of
  the refusal appears in the line), so a very short name could match by chance.
- A refusal raised by a command other than `graph export` (for example `type`) used to end the whole call even inside
  `capture`; that is ODT-23 in `opendta-issues.md`, patched in the engine.
- Tests: `tests/test_sandbox.py` (the uncaught case, and `test_a_refusal_is_told_apart_from_a_missing_folder_inside_capture`).

### ERG-6: limits
- `get_file` returned up to 5 MB of text (~1.2M tokens). It now returns pages of text: `offset` (negative counts from
  the end) and `limit` (default 50,000 characters, at most 200,000), with a footer
  `[characters 0-50000 of 80000; next offset 50000]` on a partial page. Images keep the 5 MB limit. (A first version
  refused text over 200,000 bytes; that would have made a large `log_file`, up to 2 MB, unreadable.)
- A session runs one call; one more may wait (a client cancel returns at once while the code stops a moment later).
  A third call is refused ("still running a call and has another waiting"). The call is counted in the event loop
  before its thread starts, so a burst can't all pass the check, and a cancel finds it. So a retrying client can't use up the
  server's ~40 worker threads and stall every session.
- `files` (created/changed files) comes from two scans of the working folder per call. Over stdio that is the launch
  folder, possibly a home folder, so a folder with more than 5,000 entries gives an empty `files`.
- Not changed: over HTTP anyone can call `start_session`, and a full pool evicts the least recently used idle
  session. There is no login (see `MCP-SCHEMA.md`), so that is the same trust limit; `--unsafe` with `--http` on a
  non-loopback address is now refused.

### ERG-7: coefficient rows lost in a cut table
Found 2026-11-05 replicating Lee (2008). One call ran `summarize, detail` on five variables, then two
`regress ..., vce(cluster id2)` with nine regressors. The log was over the then 8,000-character limit, so `_cut_log` cut the biggest
blocks. Each coefficient table kept its first lines (the cluster note, the rules and the header) and `_cons`, with
`[... 17 lines omitted ...]` where the rows, including the `D` coefficient, were. The agent had to `display _b[D]`
or call `get_matrix("r(table)")` to see the estimate.
- Measured on the four long paper logs saved in `.dofile/` (all over 8,000 characters): 20 coefficient tables, rows
  lost in 14, the first row lost in 7. At a 12,000 limit only LaLonde's 17,372-character log is cut (rows lost in 5
  tables, the first row in 2); at 20,000 none is cut. Small sample, and the calls were multi-model.
- Fix 1: coefficient tables (a block with `Std. Err.` and `Interval]` in a line) are cut last, after every other
  block. This only helps when another block is big enough to cut: in the Lee call everything but the two 25-line
  tables was 7 to 11 lines, and a block of 9 lines or fewer can't be cut at all.
- Fix 2: `LOG_LIMIT` 8,000 to 12,000 (about 3,500 tokens against 2,400, and only on calls that exceed 8,000). The Lee
  log (8,883 characters) now comes back whole. The Claude Code hook (`plugins/dofile-log`) keeps its own 9,000-byte
  cap (Claude Code saves a hook message over about 10,000 characters to a file), so for a 9,000 to 12,000 character
  log the model sees it whole and the hook view trims the middle.
- Still open: a log over 12,000 characters, and a table that is the only big block, are cut as before.
- Workaround, already in the instructions: `quietly regress ...` and `display` the numbers needed.

### ERG-8: no pointer when a community command is missing
`rdrobust`, `esttab` and `binscatter` each give `command X is unrecognized` (rc 199). The server's instructions say
community commands are not available, but the error doesn't, and an agent's next step is `ssc install X`, which
fails the same way. A hint on rc 199 for a known community name (`rdrobust`, `esttab`, `outreg2`, `reghdfe`,
`binscatter`, `ssc`) would say it is not available and name a built-in or a manual route (a local-linear
`regress` with `[pweight=]` for `rdrobust`).

### ERG-9: ambiguous abbreviation without the candidates
`summarize ... pop` on `castle.dta` (variables `population`, `popwt`, `l_pop`) stops with `pop ambiguous abbreviation`
(rc 111), as Stata does. Stata's message has no list either, but an agent can't see the names, so it spent a call
on `describe_data` to find them. Idea: on rc 111, append the variables that start with the abbreviation.
