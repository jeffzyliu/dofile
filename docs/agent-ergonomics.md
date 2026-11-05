# Agent ergonomics (dofile's own issues)

Things that make dofile hard for an agent to use through the MCP server, found by running real replications as a
student would ([replication-tests.md](replication-tests.md)). These are in dofile's adapter, sandbox and MCP layer
(`src/dofile/`), so they are fixed here, with no patch and no upstream report. Problems in the vendored engine are
in [opendta-issues.md](opendta-issues.md) (ODT-*, GAP-*).

Status values: `open`, `fixed` (with the test or commit), `docs only` (the behavior stays, the docs need a line).
The numbers were measured on 2026-11-05 with the code at the time.

| ID | Symptom | Where | Status |
|---|---|---|---|
| ERG-1 | `run_do`'s log cut loses a loop's results and short results between long outputs; the agent can't tell what is gone | `mcp_server._cut_log` | open |
| ERG-2 | a tempfile's local name outlives the file: next call fails with rc 601 and an internal path | `engine.py` (per-call scope) | open |
| ERG-3 | `results` shows `e()`/`r()` from data or a command no longer current, unlabeled | `engine.results()` | open |
| ERG-4 | reconnecting the MCP server (or restarting it after a code change) wipes the session | `mcp_server.py` | docs only |
| ERG-5 | rc 603 means both "folder missing" and "the sandbox refused" | sandbox, `engine.py` | open |

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
- Behavior: the full log is 11,214 characters, 171 lines; `_cut_log` returns 4,139. The `RESULT` lines of iterations
  2, 3 and 4, printed by the code's own `display`, are gone; iteration 1, 5 and `LAST LINE` survive.
- The same regressions written flat (no loop, 5 `regress` and 5 `display` lines) come to 11,461 characters; the
  8,000-character cap cuts the middle and the `RESULT` lines of iterations 2 and 3 are lost.
- Cause: `_cut_log` starts a block only at a line beginning `. ` (a command echo), and keeps each block's first
  `CMD_HEAD` = 40 and last `CMD_TAIL` = 15 lines. A `foreach` body is printed as `  2.     regress ...` echo
  lines, so a whole loop is one block, and only its first 40 and last 15 lines survive. Then `LOG_LIMIT` = 8,000
  characters cuts the middle of the whole log. The TODO in the code (cut the longest outputs first) is also noted
  in `replication-tests.md` and `phase1-plan.md`, without this case.
- Sketch of a fix:
  - start a new block at a loop-body echo line (`^\s*\d+\.\s`) too, so the cut applies per command;
  - budget by total size: keep short outputs whole, trim the longest first (the existing TODO);
  - add the number of omitted lines and characters to the result (`log_omitted`), so the agent knows what is
    missing and doesn't treat a short log as complete;
  - tell agents in the `run_do` description to use `quietly` for loop bodies and `display` for the numbers they need.
- Workaround today: `get_file` on `log_file`, or `quietly` plus explicit `display`.

### ERG-2: tempfile name outlives the file
```stata
* call 1
tempfile t
save `t'
* call 2
use `t', clear
```
- Behavior: call 2 gives rc 601 `file /var/folders/.../opendta-88416/S__000000.dta not found`. The name in `` `t' ``
  is still there, the file is not.
- Cause: `Engine.run` wraps each call in its own do-file scope (`Scope("do", "run")`), and closing it deletes the
  call's tempfiles, as in Stata. But macros are deliberately kept across calls (the MCP docs say locals, data and
  estimates carry over), so the name survives. In Stata a do-file's locals die with it, so this combination
  doesn't exist there. The message text and the internal path are OpenDTA's `use`.
- Sketch of a fix: either drop macros that name a deleted tempfile at the end of the call, or make `use`/`merge`
  etc. say "tempfiles last one run_do call; save it under a name". The docs already say tempfiles belong to one call.

### ERG-3: `results` can describe things that are gone
```stata
clear
set obs 400
gen x = rnormal()
gen y = x + rnormal()
regress y x
clear
```
- Behavior: the result after `clear` has `nobs` 0 and `e(N)` 400, `e(cmd)` `regress`. After a failed command, `r()` is
  the previous command's (a failed `graph export` came back with the earlier `summarize`'s `r()`).
- Cause: Stata keeps `e()` after `clear` (only `clear all` or `discard` drop it) and keeps `r()` after a failed
  command, so the engine is faithful. `replication-tests.md` says `e()`/`r()` are "always the current state".
- The risk is an agent reading `e(N) = 400` as the data in memory. Sketch: put `e(cmdline)` first, or add which
  command produced `r()`, or a `stale` flag when `nobs` differs from `e(N)`.

### ERG-4: reconnecting the server wipes the session
- Behavior: `/mcp` reconnect or a restart (needed to load changed dofile code, since the server runs the code it
  started with) starts a new process: data, stored estimates, macros, scalars, graphs and tempfiles are gone. Files
  saved in the working folder stay. After rc 9998 ("session reset") the same applies.
- Needed: one sentence in `MCP-SCHEMA.md` and in the server instructions that reloading loses the session, so
  agents save to `.dta` before a reload and re-run setup after it. No code change.

### ERG-5: rc 603 for two different causes
```stata
clear
set obs 20
gen x = _n
gen y = x^2
twoway line y x
graph export nofolder/x.png, replace    // rc 603: file nofolder/x.png could not be opened
graph export ../escaped.png, replace    // sandbox refusal, also rc 603 (OpenDTA's generic OS text)
```
- Behavior: a folder that doesn't exist and a sandbox refusal both give rc 603. The first is Stata's own behavior
  and the engine is right. The second is dofile's choice (CLAUDE.md: "603 (sandbox refused a file)"), and the text
  the agent sees is OpenDTA's generic one ("The operating system did not allow the file to be written..."), not
  the sandbox's reason; other file commands do show the reason (`tests/test_sandbox.py` notes the `graph export` case).
- Cost: an agent that sees 603 can't tell "fix the path" from "this path is outside the allowed folders", and
  keeps retrying the same write.
- Sketch of a fix: make the sandbox's refusal say so in the message (`dofile sandbox: write outside the working
  folder`) wherever it is raised, `graph export` included, and keep rc 603. The engine can't do this: it can't
  tell a sandbox PermissionError from an OS one, and its generic text is right for the OS case, so the adapter
  (`engine.py`) has to attach the sandbox's reason to the result.
- This was ODT-7 in `opendta-issues.md` ("`graph export` refused by the sandbox prints a generic OS message"), moved
  here because nothing is wrong on the engine side.
