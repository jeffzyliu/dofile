# dofile MCP server: schema

Draft, 2026-11-04. Describes `dofile-mcp` as of this commit (`src/dofile/mcp_server.py`, `mcp==2.3.0`).
The server advertises each tool's input and output in `tools/list` (`inputSchema`, `outputSchema`), generated
from the type definitions in `mcp_server.py` (`RunResult`, `DataSummary`, ...). This document summarizes them;
the advertised schemas are the reference. `get_file` has no output schema, since it returns content.

## Overview

| | stdio (default) | HTTP (`--http`) |
|---|---|---|
| Sessions | one, for the life of the process | many; `start_session` returns a token |
| `session` argument | ignored | required on every tool except `start_session` |
| Working folder | `--workdir` (default: launch folder) | a new temporary folder per session, deleted when it ends |
| Large data files | read in place from `--read-dir` folders by absolute path | `request_upload`, then `PUT` to the URL |
| Tools | `run_do`, `describe_data`, `get_file`, `upload_file`, `reset` | the same, plus `start_session` and `request_upload` |

**Protocol versions.** The SDK serves protocol 2026-07-28 (sessionless; each request self-contained) and older
revisions (with `initialize` and `Mcp-Session-Id`) on the same `/mcp` endpoint. dofile ignores
`Mcp-Session-Id`: a Stata session is always the explicit `session` token (the state-handle pattern of
SEP-2567).

**Server instructions** (sent to the client at connect) always include the base text, then:
- the `--read-dir` folders, if any ("on this machine" for stdio, "on the server's disk" for HTTP);
- for HTTP, how to use `request_upload` for large files.

## Tools

### `start_session` (HTTP only)

Starts a Stata session with its own empty working folder.

Input: `{}`

Output:
```json
{"session": "<token>"}
```

The token is a 128-bit random string. A session closes after 15 minutes idle, on `reset`, or when the server
is full (`--max-sessions`, default 8; the least recently used one is closed). After that, every tool returns
the error `unknown or expired session ...`; the client must start a new session and redo its setup.

### `run_do`

Runs Stata code (one or more lines, like a .do file). Data, macros and results persist between calls in the
same session.

Input:
```json
{
  "type": "object",
  "properties": {
    "code":    {"type": "string"},
    "session": {"anyOf": [{"type": "string"}, {"type": "null"}], "default": null}
  },
  "required": ["code"]
}
```

Output (`RunResult`):

| Field | Type | Meaning |
|---|---|---|
| `rc` | integer | Return code. 0 = success; see [Return codes](#return-codes) |
| `error` | string or null | The error message, without the hint lines that follow it in the log |
| `log` | string | Output as Stata shows it; each command echoed as `. cmd`. Longer than 20,000 characters: the first and last 10,000 are kept and the full log is saved to a file (listed in `files`) |
| `results` | object | `{"e": {...}, "r": {...}}`: the current `e()` and `r()` results |
| `files` | array of string | Files in the working folder created or changed by this call (top level only) |

Values in `results`:
- numbers: whole numbers as integers, others as floats;
- strings as strings;
- matrices as `{"rows": [...], "cols": [...], "data": [[...], ...]}`;
- missing values: `.` as `null`, extended missing values as strings (`".a"` ... `".z"`).

`e` and `r` are always present; after a session reset (rc 9998) both are `{}`.

Example (`use panel, clear` / `regress y x1` / `scatter y x1` / `graph export s.png`), shortened:
```json
{
  "rc": 0,
  "error": null,
  "log": ". use panel, clear\n\n. regress y x1\n\n      Source |       SS ...",
  "results": {
    "e": {
      "cmd": "regress", "depvar": "y", "vce": "ols", "N": 1000, "df_r": 998, "r2": 0.4842602362171483,
      "b": {"rows": ["y1"], "cols": ["x1", "_cons"], "data": [[2.3340184651433287, 0.9678754725351595]]},
      "V": {"rows": ["x1", "_cons"], "cols": ["x1", "_cons"],
            "data": [[0.005813395114415328, 0.00035598492099942717],
                     [0.00035598492099942717, 0.0072883770157457775]]}
    },
    "r": {}
  },
  "files": ["s.png"]
}
```

A Stata error is a normal result, not a tool error:
```json
{"rc": 111, "error": "variable nosuchvar not found", "log": ". regress nosuchvar\nvariable nosuchvar not found\n  → No variable is named ...\nr(111);\n", "results": {...}, "files": []}
```

### `describe_data`

Describes the dataset in memory.

Input: `{"session": string | null}`

Output:
```json
{
  "nobs": 1000,
  "nvars": 10,
  "variables": [
    {"name": "id", "type": "int", "format": "%8.0g", "label": null, "value_label": null}
  ],
  "filename": "panel.dta"
}
```

`type` is the Stata storage type (`byte`, `int`, `long`, `float`, `double`, `str#`, `strL`). `label`,
`value_label` and `filename` can be null.

### `get_file`

Returns a file from the working folder: images as MCP image content, anything else as text (UTF-8;
invalid bytes are replaced). Use it to look at graphs from `graph export`.

Input:
```json
{
  "type": "object",
  "properties": {
    "name":    {"type": "string"},
    "session": {"anyOf": [{"type": "string"}, {"type": "null"}], "default": null}
  },
  "required": ["name"]
}
```

Output: content, no structured output.
- `.png`, `.jpg`/`.jpeg`, `.gif`, `.webp`: `{"type": "image", "mimeType": "image/png", "data": "<base64>"}`
- anything else: `{"type": "text", "text": "..."}`

Limits: `name` must be a plain file name (no folders, no `..`). The file can be 5 MB at most, because its
content goes into the model's context.

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
    "session": {"anyOf": [{"type": "string"}, {"type": "null"}], "default": null}
  },
  "required": ["name", "text"]
}
```

Output:
```json
{"name": "a.csv", "bytes": 6}
```

Limits: `name` must be a plain file name; an existing file with that name is replaced. The size limit is
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
    "session": {"type": "string"}
  },
  "required": ["name", "session"]
}
```

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

### `reset`

Discards the session: data, macros and results.
- stdio: the session process stops; the next call starts a fresh one in the same working folder.
- HTTP: the session ends, its working folder is deleted and the token stops working.

Input: `{"session": string | null}`

Output: `{"status": "reset"}`

## Resource

| URI | MIME type | Content |
|---|---|---|
| `dofile://commands` | `text/plain` | The Stata commands the engine supports, one per line. Commands the sandbox disables are not listed |

## Upload endpoint

Not an MCP tool: a plain HTTP route on the same server, used with a URL from `request_upload`.

```
PUT /upload/{token}
Body: the raw file bytes (Content-Length or chunked)
```

| Status | Body | When |
|---|---|---|
| 200 | `{"name": "survey.dta", "bytes": 52144}` | The file is in the working folder |
| 404 | text | Token unknown, already used, expired, or its session ended |
| 413 | text | The file is larger than `--file-limit` |

- A token works for one request. It is used up even if that request fails, so call `request_upload` again.
- The file is written to a hidden scratch folder and moved into place only when it is complete. A failed or
  interrupted upload leaves no file behind.
- An existing file with the same name is replaced.
- The route has no authentication of its own: the token in the URL is the only check.

## Large files

Data files should not pass through the model's context.
- **stdio:** start the server with `--read-dir /path/to/data`. Code reads files in place by absolute path:
  `use "/path/to/data/survey.dta"`. These folders are read-only to Stata code; output goes to the working
  folder.
- **HTTP:** call `request_upload`, send the file with `curl --fail -T file <url>`, then `use file`.

`use data` with a bare name looks only in the working folder, as in Stata.

## Errors

Two kinds:

1. **Stata errors** are normal `run_do` results with `rc` ≠ 0. The session keeps its data.
2. **Tool errors** have `isError: true` and a text message like `Error executing tool get_file: no file
   'nope.txt' in the working directory`. Causes:
   - a missing or expired `session` token (HTTP);
   - a `name` that is not a plain file name;
   - a file that is missing or too large;
   - `describe_data` after the session was reset.

### Return codes

| rc | Meaning | What the client should do |
|---|---|---|
| 0 | Success | |
| 1–999 | Stata's own error codes (e.g. 111 variable not found, 198 invalid syntax, 601 file not found) | Fix the code; the session is intact |
| 199 | A command disabled by the sandbox: `shell`/`!`, `erase`/`rm`, `rmdir`, `mkdir`, `cd`, `copy`, `webuse` | Do it another way |
| 603 | File could not be opened: a path outside the allowed folders, or writing to a read-only folder | Use the working folder or a `--read-dir` folder |
| 9998 | Session reset: timeout (`--timeout`, default 60 s per call) or crash | Data, macros and results are gone; run the setup again |
| 9999 | Internal engine error (a bug in the engine; the log has the Python traceback) | Report it; the session's data is kept |

## Server options

| Flag | Default | Meaning |
|---|---|---|
| `--http` | off | Serve streamable HTTP at `/mcp` instead of stdio |
| `--host` | `127.0.0.1` | HTTP bind address |
| `--port` | `8000` | HTTP port |
| `--public-url` | `http://HOST:PORT` | Base URL in upload links; set it behind a proxy or in a container |
| `--workdir` | `.` | stdio: the session's working folder |
| `--read-dir` | none | Read-only data folder (repeatable) |
| `--timeout` | `60` | Seconds per `run_do` call before the session resets |
| `--max-sessions` | `8` | HTTP: sessions open at the same time |
| `--file-limit` | `1024` | Largest `upload_file` or upload, in MB |
| `--unsafe` | off | Turn off the sandbox (trusted local use only) |

## Known gaps

- The keys inside `e` and `r` depend on the command, so their schema is an open object.
- No authentication for HTTP; anyone who can reach the port can start sessions. Bind to localhost or put it
  behind an authenticating proxy.
- No per-session memory limit.
