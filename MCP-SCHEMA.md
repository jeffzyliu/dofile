# dofile MCP server: schema

For dofile `0.1.0.dev0`. Describes `dofile-mcp` (`src/dofile/mcp_server.py`, `mcp==2.3.0`).
The server advertises each tool's input and output in `tools/list` (`inputSchema`, `outputSchema`), generated
from the type definitions in `mcp_server.py` (`RunResult`, `DataSummary`, ...). This document summarizes them;
the advertised schemas are the reference. `get_file` has no output schema, since it returns content.

## Overview

| | stdio (default) | HTTP (`--http`) |
|---|---|---|
| Sessions | one, for the life of the process | many; `start_session` returns a token |
| `session` argument | not offered (left out of the tools' input schemas) | required on every tool except `start_session` (in the schemas too) |
| Working folder | `--workdir` (default: launch folder) | a new temporary folder per session, deleted when it ends |
| Large data files | read in place from `--read-dir` folders by absolute path | `request_upload`, then `PUT` to the URL |
| Output files (`.dta`, `.xlsx`, ...) | already in the working folder | `request_download`, then `GET` the URL |
| Tools | `run_do`, `describe_data`, `get_file`, `get_matrix`, `upload_file`, `reset` | the same, plus `start_session`, `request_upload` and `request_download` |

**Protocol versions.** The SDK serves protocol 2026-07-28 (sessionless; each request self-contained) and older
revisions (with `initialize` and `Mcp-Session-Id`) on the same `/mcp` endpoint. dofile ignores
`Mcp-Session-Id`: a Stata session is always the explicit `session` token (the state-handle pattern of
SEP-2567).

**Server instructions** (sent to the client at connect) always include the base text and a versions line (dofile,
the OpenDTA commit, the emulated Stata version), then:
- the `--read-dir` folders, if any ("on this machine" for stdio, "on the server's disk" for HTTP);
- for HTTP, how to use `request_upload` for large files and `request_download` for results.

## Tools

Every argument has a description in the input schema. The schemas below are the HTTP ones, where `session` is
required; over stdio `session` is not part of any tool.

### `start_session` (HTTP only)

Starts a Stata session with its own empty working folder.

Input: `{}`

Output:
```json
{"session": "<token>"}
```

The token is a 128-bit random string. A session closes after 15 minutes idle, on `reset`, or when the server
is full (`--max-sessions`, default 8): then the least recently used session that is not running code is
closed. A session in the middle of a call is never closed this way; if every session is running code,
`start_session` fails with a tool error (`all 8 sessions are running code ...`) and closes nothing. After a
session closes, every tool returns the error `unknown or expired session ...`; the client must start a new
session and redo its setup.

### `run_do`

Runs Stata code (one or more lines, like a .do file). Data, macros and results persist between calls in the
same session.

Input:
```json
{
  "type": "object",
  "properties": {
    "code":    {"type": "string"},
    "graphs":  {"type": "boolean", "default": true},
    "timeout": {"anyOf": [{"type": "number", "exclusiveMinimum": 0}, {"type": "null"}], "default": null},
    "session": {"type": "string"}
  },
  "required": ["code", "session"]
}
```

`graphs`: attach the graphs the code draws as images (default `true`; see [Graphs](#graphs)).

`timeout`: seconds before this call is interrupted; at most the server's `--timeout` (default 60), which is
also the default. See [Timeouts and cancelling](#timeouts-and-cancelling).

Each call runs like a do-file: data preserved with `preserve` is restored, and `tempvar`/`tempname`/`tempfile`
objects are dropped, when the call ends, with or without an error. So `preserve` and `restore` go in the same
call. Data, local and global macros, programs and `e()`/`r()` results carry over to the next call.

With `--read-dir`, the `code` description also names the read-only folders and says to use their files by
absolute path, because not every client shows the server instructions to the model.

Output (`RunResult`):

| Field | Type | Meaning |
|---|---|---|
| `rc` | integer | Return code. 0 = success; see [Return codes](#return-codes) |
| `error` | string or null | The error message (the first line of Stata's error output) |
| `error_command` | string or null | The command that failed, as echoed in the log, with `///` continuations joined (`"regress y x"`). For an error inside a loop or block it is that loop's first line (`"forvalues i = 1/2 {"`). `null` on success |
| `log` | string | Output as Stata shows it; each command echoed as `. cmd`. A log under about 12,000 characters is returned whole. A longer one has its biggest blocks of output (a table, a listing: lines between blank lines) cut first, to their first 40 and last 15 lines and then, if that is not enough, to their first 5 and last 3, each with `[... N lines omitted; full log: get_file NAME ...]` between the kept lines, so short results stay: the `display` line under a table, a `test` between two regressions, every iteration's result of a loop. Command echoes are never cut. Only if every block is already short is the middle of the whole log dropped, with `[log truncated; ...]` |
| `log_file` | string | The name of this call's full log, for `get_file` (or to open in an editor: it has real newlines). It is kept in the hidden `.dofile/` folder, so it is not in `files` and does not clutter the working folder; only the newest 50 are kept |
| `log_omitted_lines` | integer, only when `log` was cut | How many lines `log` leaves out. A loop's commands are echoed once, up front, and its output has no per-command markers, so in a loop use `quietly` and `display` the numbers you need, or read `log_file` |
| `results` | object | `{"e": ResultSet, "r": ResultSet, "e_changed": bool, "r_changed": bool}`: `e()` and `r()` as they are after the call, whether it succeeded or failed. `e_changed` and `r_changed` say whether this call changed them: `false` means they are left from an earlier call. `e()` survives `clear` (so `e(N)` can describe a model on data that is gone) and `r()` survives a failed command |
| `files` | array of `{"name", "status", "bytes"}` | Files in the working folder this call created (`status: "created"`) or changed (`"modified"`), with their size. Top level only; the hidden `.dofile/` folder is not listed. Empty when the working folder has more than 5,000 entries |
| `nobs` | integer | Observations in the dataset in memory after the call |
| `nvars` | integer | Variables in the dataset in memory after the call |
| `new_graphs` | integer | How many graphs this call drew (each `scatter`, `histogram`, `twoway`, `graph bar`, ... counts once) |

Both `log` and the saved full log start from the same capture, which is capped per call at its first and last
1,000,000 characters, with `[... N characters of output omitted ...]` between them, so a runaway loop can't fill
memory or disk.

`e` and `r` are each grouped like Stata's `ereturn list` / `return list` (`ResultSet`):

| Group | JSON type | Holds |
|---|---|---|
| `scalars` | object: name → integer, number, `null` or a string matching `^\.[a-z]$` | Numbers such as `N`, `r2`. Whole numbers are integers. Missing `.` (and infinity, which Stata does not have) is `null`; extended missing is the string `".a"` … `".z"` |
| `macros` | object: name → string | Text such as `cmd`, `depvar`, `cmdline` |
| `matrices` | object: name → string `"rows x cols"` | Each matrix's size only, such as `{"b": "1x2", "V": "2x2"}`. Fetch the values with [`get_matrix`](#get_matrix) (`e(V)`, `r(table)`, ...) |

All three groups are always present (possibly `{}`), and every call sends them in full: nothing is left out
because an earlier call already returned it, so a result never depends on what the agent still remembers.
Matrix values are left out because they cost many tokens (`e(V)` grows with the square of the number of
terms) and the log's coefficient table already shows the usual numbers. After an error, `e` and `r` show
what the commands before the failing one left (Stata keeps `e()` when a command fails). After a session reset
(rc 9998) every group is empty.

Which names appear depends on the command. The usual ones (from dofile runs; Stata's are the same names):

| Command | Result | `scalars` | `macros` | `matrices` |
|---|---|---|---|---|
| `regress` | `e()` | `N df_m df_r F r2 r2_a rmse mss rss ll ll_0 rank` | `cmd cmdline depvar vce vcetype title` | `b V` |
| `logit`, `probit` | `e()` | `N df_m chi2 p ll ll_0 r2_p converged ic` | `cmd cmdline depvar vce chi2type` | `b V` (also `gradient ilog`) |
| `ivregress 2sls` | `e()` | `N df_m chi2 r2 r2_a rmse mss rss` | `cmd cmdline depvar instd insts estimator vce` | `b V` |
| `mean` | `e()` | `N df_r` | `cmd cmdline varlist` | `b V` |
| `summarize` | `r()` | `N mean sd Var min max sum sum_w`; with `detail` also `p1`…`p99 skewness kurtosis` | — | — |
| `tabulate` | `r()` | `N r`; two-way also `c` | — | — |
| `correlate` | `r()` | `N rho` | — | `C` |
| `count` | `r()` | `N` | — | — |

After any command that shows a coefficient table (all the estimation commands above, and replaying one),
`r()` also has the matrix `table`, as in Stata: one column per coefficient (the columns of `e(b)`, including
base levels the table hides) and the rows `b se t pvalue ll ul df crit eform` (`z` instead of `t` for
z-statistics). It replaces whatever `r()` held before. Use it, or the coefficient table in the log, for
standard errors, p-values and confidence intervals instead of computing them from `e(V)`. With `or`/`eform`,
the values are exponentiated and `eform` is 1. Base and omitted terms have `b` 0 and the rest missing
(`null`). In `results` it appears as `"r": {"scalars": {}, "macros": {}, "matrices": {"table": "9x2"}}`;
`get_matrix(name="r(table)")` after `regress y x1` returns:
```json
{
  "rows": ["b", "se", "t", "pvalue", "ll", "ul", "df", "crit", "eform"],
  "cols": ["x1", "_cons"],
  "data": [[2.3340184651433287, 0.9678754725351595], [0.07624562357549007, 0.08537199198651615],
           [30.611835220056125, 11.337154610238308], [1.1538335935508048e-145, 4.136372142046254e-28],
           [2.1843983349190386, 0.8003462694211894], [2.4836385953676188, 1.1354046756491296],
           [998, 998], [1.9623438462163343, 1.9623438462163343], [0, 0]]
}
```

Use `ereturn list` / `return list` in `run_do` to see every name for any other command.

<a id="graphs"></a>**Graphs.** In Stata a graph command opens a Graph window; in batch mode nothing is shown
until `graph export`. `run_do` works like a notebook instead: with `graphs` true (the default), the last 5
graphs that the call drew are attached as PNG images (MCP image content, 100 dpi), after the text block that
holds the JSON result. A call that draws no graph attaches nothing; graphs from earlier calls are not sent
again. `new_graphs` says how many were drawn, so an agent knows when some were left out. Pass
`graphs: false` to save context; `graph export` and `get_file` still work for any graph in memory.
The structured result (`structuredContent`) is the same either way.

Example (`use panel, clear` / `regress y x1` / `scatter y x1` / `graph export s.png`), shortened:
```json
{
  "rc": 0,
  "error": null,
  "log": ". use panel, clear\n\n. regress y x1\n\n      Source |       SS ...",
  "results": {
    "e": {
      "scalars": {"N": 1000, "df_r": 998, "r2": 0.4842602362171483},
      "macros": {"cmd": "regress", "depvar": "y", "vce": "ols"},
      "matrices": {"b": "1x2", "V": "2x2"}
    },
    "r": {"scalars": {}, "macros": {}, "matrices": {"table": "9x2"}}
  },
  "files": [{"name": "s.png", "status": "created", "bytes": 41733}]
}
```

A Stata error is a normal result, not a tool error. Run right after the example above (shortened): the failed
command left `e()` and `r()` as they were, so the `regress y x1` results and its `r(table)` are still in
effect, and `results` shows them:
```json
{
  "rc": 111,
  "error": "variable nosuchvar not found",
  "error_command": "regress y nosuchvar",
  "log": ". regress y nosuchvar\nvariable nosuchvar not found\nr(111);\n",
  "results": {
    "e": {"scalars": {"N": 1000, "df_r": 998, "r2": 0.4842602362171483}, "macros": {"cmd": "regress", ...},
          "matrices": {"b": "1x2", "V": "2x2"}},
    "r": {"scalars": {}, "macros": {}, "matrices": {"table": "9x2"}}
  },
  "files": []
}
```

### `describe_data`

Describes the dataset in memory, with each variable's exact name. `run_do("describe")` shows the same in
Stata's layout, but abbreviates long names and cuts long labels; use this tool when you need the names.
`run_do` already returns `nobs` and `nvars` on every call.

Input:
```json
{
  "type": "object",
  "properties": {
    "vars":    {"anyOf": [{"type": "string"}, {"type": "null"}], "default": null},
    "offset":  {"type": "integer", "minimum": 0, "default": 0},
    "limit":   {"type": "integer", "minimum": 1, "maximum": 1000, "default": 200},
    "session": {"type": "string"}
  },
  "required": ["session"]
}
```

- `vars`: only these variables, as a Stata varlist (`inc* age-educ`); all of them when left out. A varlist
  that matches nothing is a tool error with Stata's message.
- `offset` / `limit`: page through the matching variables. Wide datasets need several calls.

Output (`DataSummary`):
```json
{
  "nobs": 1000,
  "nvars": 10,
  "matched": 10,
  "offset": 0,
  "variables": [
    {"name": "id", "type": "int", "format": "%8.0g"},
    {"name": "sex", "type": "byte", "format": "%8.0g", "label": "Sex", "value_label": "sexlbl"}
  ],
  "more": 0,
  "filename": "panel.dta"
}
```

`variables` lists the matching variables from `offset`, at most `limit`. `nvars` counts all variables, `matched` those that match `vars`, and `more` the matching ones after this
page.

`type` is the Stata storage type (`byte`, `int`, `long`, `float`, `double`, `str#`, `strL`). `label` and
`value_label` are left out when a variable has none (common, and they'd repeat on every variable);
`filename` can be null.

### `get_file`

Returns a file from the working folder: images as MCP image content, text files (logs, `.csv`, `.do`,
`.tex`, ...) as text. Use it for exported graphs and full logs from `run_do`'s `log_file` (graphs a call
draws already come back from `run_do` as images).
Text is read as UTF-8, or as Latin-1 when it is not valid UTF-8 (older Stata logs, Windows CSVs).

Binary files (`.dta`, `.xlsx`, `.pdf`, ...) are refused with a tool error. Their bytes are no use in the model's
context; look inside them with `run_do` instead (`use small.dta, clear` / `import excel using small.xlsx` and
then `describe`, `list in 1/10`). Over stdio the user has these files in the working folder already.

Input:
```json
{
  "type": "object",
  "properties": {
    "name":    {"type": "string"},
    "offset":  {"type": "integer", "default": 0},
    "limit":   {"type": "integer", "minimum": 1, "maximum": 200000, "default": 50000},
    "session": {"type": "string"}
  },
  "required": ["name", "session"]
}
```

Output: content, no structured output.
- `.png`, `.jpg`/`.jpeg`, `.gif`, `.webp`: `{"type": "image", "mimeType": "image/png", "data": "<base64>"}`
- text files: `{"type": "text", "text": "..."}`. A file longer than `limit` characters (default 50,000) comes in pages:
  `offset` is the first character (negative counts from the end), and a partial page ends with
  `[characters 0-50000 of 80000; next offset 50000]` (or `; end of file]`)
- binary files: tool error

Full logs named in `run_do`'s `log_file` are found in the hidden `.dofile/` folder.

Limits: `name` must be a plain file name (no folders, no `..`), not `.dofile` or a folder, and not a link to a
file outside the working folder (the server process isn't sandboxed, so it checks this itself). The file can be
5 MB at most (images and text); text comes in pages because its content goes into the model's context.

### `get_matrix`

Returns one matrix with full precision: `e(b)`, `e(V)`, `r(table)`, or a matrix made with `matrix`. `run_do`
lists matrices by size only, so this is how to get their values; your own matrices aren't listed there at all.

Input:
```json
{
  "type": "object",
  "properties": {
    "name":    {"type": "string"},
    "rows":    {"anyOf": [{"type": "array", "items": {"type": "string"}}, {"type": "null"}], "default": null},
    "cols":    {"anyOf": [{"type": "array", "items": {"type": "string"}}, {"type": "null"}], "default": null},
    "session": {"type": "string"}
  },
  "required": ["name", "session"]
}
```

`rows` / `cols`: names exactly as in the matrix (e.g. `["x1", "_cons"]` as in the log's coefficient table,
or `["se"]` for `r(table)`); leave out for all. Example: `{"name": "r(table)", "rows": ["b", "se", "pvalue"], "cols": ["x1"]}`
→ `{"rows": ["b", "se", "pvalue"], "cols": ["x1"], "data": [[2.334], [0.0762], [1.15e-145]]}`.

Errors (tool errors): no such matrix; a row or column name that the matrix does not have; more than 250,000
values (ask for part of it).

### `upload_file`

Writes a small text file that the agent wrote itself (a CSV, a .do file) into the working folder. Not for
data files that already exist: see [Large files](#large-files).

Input:
```json
{
  "type": "object",
  "properties": {
    "name":    {"type": "string"},
    "text":    {"type": "string"},
    "replace": {"type": "boolean", "default": false},
    "session": {"type": "string"}
  },
  "required": ["name", "text", "session"]
}
```

Output:
```json
{"name": "a.csv", "bytes": 6}
```

Limits: `name` must be a plain file name, not `.dofile` (the hidden scratch folder), a folder, or a link to a
file outside the working folder. An existing
file with that name is kept and the call fails, unless `replace` is true, as with Stata's `save, replace`.
Over stdio the working folder is the user's own folder, so this protects their files. The size limit is
`--file-limit`.

### `request_upload` (HTTP only)

Returns a one-time URL to send a file from the client's machine into the session's working folder, without
its content passing through the model.

Input:
```json
{
  "type": "object",
  "properties": {
    "name":    {"type": "string"},
    "session": {"type": "string"},
    "replace": {"type": "boolean", "default": false}
  },
  "required": ["name", "session"]
}
```

An existing file named `name` makes the call fail unless `replace` is true. This is checked when the URL is
issued; a file created after that is replaced by the upload.

Output:
```json
{
  "url": "http://127.0.0.1:8000/upload/<token>",
  "method": "PUT",
  "max_bytes": 1073741824,
  "expires_in_seconds": 600,
  "example": "curl --fail -T survey.dta http://127.0.0.1:8000/upload/<token>"
}
```

See [Upload endpoint](#upload-endpoint).

### `request_download` (HTTP only)

Returns a one-time URL to download a file from the session's working folder (a `.dta` from `save`, an
`.xlsx` from `export excel`, a graph, ...) without its content passing through the conversation. Over stdio
there is no such tool: the files are already in the user's folder. Download results before the session ends;
its folder is deleted with it.

Input: `{"name": string, "session": string}` (both required; `name` is a plain file name).

Output (`DownloadTicket`):
```json
{
  "url": "http://127.0.0.1:8000/download/9f3k...",
  "method": "GET",
  "bytes": 52144,
  "expires_in_seconds": 600,
  "example": "curl --fail -o results.dta http://127.0.0.1:8000/download/9f3k..."
}
```

Errors (tool errors): unknown session; a name that is not a plain file name; no such file.

### `reset`

Discards the session: data, macros and results.
- stdio: the session process stops; the next call starts a fresh one in the same working folder.
- HTTP: the session ends, its working folder is deleted and the token stops working.

Input: `{"session": string}` (HTTP; no input over stdio)

Output: `{"status": "reset"}`

The same loss happens when the server is reconnected or restarted (for example `/mcp` in Claude Code, which a
change to dofile's own code needs, since the server runs the code it started with): data, stored estimates, macros,
scalars, graphs and tempfiles in memory are gone, while files in the working folder stay. Save to a `.dta` first and
re-run the setup afterwards.

## Resource

| URI | MIME type | Content |
|---|---|---|
| `dofile://commands` | `text/plain` | The Stata commands the engine supports, one per line. Commands the sandbox disables are not listed |
| `dofile://about` | `application/json` | `{"dofile": "0.1.0.dev0", "engine": "OpenDTA", "engine_commit": "0c3f3a2…", "engine_patches": ["opendta-patch1-r-table.patch", "…"], "stata_version": 14}` |

## Versions

- The server reports dofile's version as `serverInfo.version` when a client connects, and the server
  instructions name the dofile version, the OpenDTA commit and the emulated Stata version (14, OpenDTA's
  `c(stata_version)`). `dofile://about` has all of it as JSON; `dofile run --json` writes it as `versions`.
- There is no separate schema version. MCP clients get the current input and output schemas from
  `tools/list` on every connection, so the schema describes itself. For code that reads results without
  the schema (scripts using `dofile run --json`, stored outputs), dofile's version is the schema version:
  while it is 0.x, a change that breaks the result format raises the minor version (0.1 → 0.2).

## Upload and download endpoints

Not MCP tools: plain HTTP routes on the same server, used with a URL from `request_upload` or
`request_download`.

```
PUT /upload/{token}
Body: the raw file bytes (Content-Length or chunked)
```

| Status | Body | When |
|---|---|---|
| 200 | `{"name": "survey.dta", "bytes": 52144}` | The file is in the working folder |
| 400 | text | The `Content-Length` header is not a number (the token is not used up) |
| 404 | text | Token unknown, already used, expired, or its session ended |
| 413 | text | The file is larger than `--file-limit` |

- A token works for one request. A 400 or 413 decided from the `Content-Length` header alone leaves the
  token valid; any other failure uses it up, so call `request_upload` again.
- The file is written to a hidden scratch folder and moved into place only when it is complete. A failed or
  interrupted upload leaves no file behind.
- The upload replaces a file with the same name only if `request_upload` was called with `replace: true`
  (or the file appeared after the URL was issued).
- The route has no authentication of its own: the token in the URL is the only check.

```
GET /download/{token}
```

| Status | Body | When |
|---|---|---|
| 200 | the file (`Content-Disposition: attachment; filename="..."`) | Token valid |
| 404 | text | Token unknown, already used, expired, an upload token, or its file or session is gone |

A download token works for one request, like an upload token, and the two kinds are not interchangeable.

## Large files

Data files should not pass through the model's context.
- **stdio:** start the server with `--read-dir /path/to/data`. Code reads files in place by absolute path:
  `use "/path/to/data/survey.dta"`. These folders are read-only to Stata code; output goes to the working
  folder.
- **HTTP:** call `request_upload`, send the file with `curl --fail -T file <url>`, then `use file`.

`use data` with a bare name looks only in the working folder, as in Stata.

## Errors

Two kinds:

1. **Stata errors** are normal `run_do` results with `rc` ≠ 0. The session keeps its data (restored to the
   preserved copy if the call used `preserve`).
2. **Tool errors** have `isError: true` and a text message like `Error executing tool get_file: no file
   'nope.txt' in the working directory`. Causes:
   - a missing or expired `session` token (HTTP);
   - `start_session` when every session is running code (HTTP);
   - a `name` that is not a plain file name, or is `.dofile`, a folder or a link out of the working folder;
   - an upload whose `name` already exists, without `replace`;
   - a file that is missing or too large (images and text: 5 MB), or a `get_file` `limit` above 200,000;
   - `run_do` while the session is running one call and has another waiting;
   - `describe_data` after the session was reset.

### Return codes

| rc | Meaning | What the client should do |
|---|---|---|
| 0 | Success | |
| 1 | `--Break--`: the call was interrupted, because it ran past its timeout or the client cancelled it (the `error` says which) | The session keeps its data, as after Break in Stata: the Break is taken between commands (a loop stops between passes), so the data is as the last complete command left it, never half changed. Make the code faster, or pass a larger `timeout` |
| 1–999 | Stata's own error codes (e.g. 111 variable not found, 198 invalid syntax, 601 file not found) | Fix the code; the session is intact A 601 for a tempfile of an earlier call ends with `(a tempfile lasts one run_do call: save it under a name to use it in a later call)` |
| 199 | A command disabled by the sandbox: `shell`/`!`, `erase`/`rm`, `rmdir`, `mkdir`, `cd`, `copy`, `webuse` | Do it another way |
| 603 | File could not be opened. When the sandbox refused the path the error and the log end with `dofile sandbox: cannot write /path` (or `read`, `list`); without that line the folder doesn't exist or isn't writable | A sandbox refusal: use the working folder or a `--read-dir` folder. Otherwise fix the path |
| 9998 | Session reset: the code did not reach a safe point within 5 s of being interrupted (one long command, such as a big `merge` or `append`, or a long numerical routine), the session process crashed, or it could not start (the `error` gives the reason; the next call tries again) | Data, macros and results are gone; run the setup again |
| 9999 | Internal engine error (a bug in the engine; the log has the Python traceback) | Report it; the session's data is kept |

## Timeouts and cancelling

Each session runs in its own process. A call that runs past its time limit, or that the client cancels
(`notifications/cancelled`), is interrupted the way Stata's Break key stops a command:

1. The server sends the session process an interrupt (SIGINT). The running command stops at the next step,
   the log ends with `--Break--` and `r(1);`, and the call returns rc 1. Data, macros and results stay.
   `e()`/`r()` hold whatever the interrupted command had set so far.
2. If the process has not stopped 5 seconds later (it is inside one long numerical routine that cannot be
   interrupted), it is killed: rc 9998, and the next call starts a fresh session.

A cancelled call returns at once; the session's next call waits until the interrupted code has stopped. A session
runs one call and lets one more wait; a third `run_do` gets a tool error until one of them ends.
A call that was still waiting for the session (behind another call) when it was cancelled does not run.
On Windows a process cannot be interrupted this way, so step 1 is skipped and step 2 always happens.

## Server options

| Flag | Default | Meaning |
|---|---|---|
| `--http` | off | Serve streamable HTTP at `/mcp` instead of stdio |
| `--host` | `127.0.0.1` | HTTP bind address |
| `--port` | `8000` | HTTP port |
| `--public-url` | `http://HOST:PORT` | Base URL in upload links; set it behind a proxy or in a container |
| `--workdir` | `.` | stdio: the session's working folder |
| `--read-dir` | none | Read-only data folder (repeatable) |
| `--timeout` | `60` | Seconds per `run_do` call before it is interrupted (rc 1); also the most a call's own `timeout` can ask for |
| `--max-sessions` | `8` | HTTP: sessions open at the same time |
| `--file-limit` | `1024` | Largest `upload_file` or upload, in MB |
| `--unsafe` | off | Turn off the sandbox (trusted local use only; refused with `--http` on a non-loopback `--host`) |

## Known gaps

- The keys inside `e` and `r` depend on the command, so their schema is an open object.
- No authentication for HTTP; anyone who can reach the port can start sessions. Bind to localhost or put it
  behind an authenticating proxy.
- No per-session memory limit.
