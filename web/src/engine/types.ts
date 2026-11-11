// The engine's types, shared by worker.ts, client.ts, store.ts and snapshot.ts (which the Node tests run as they are:
// Node removes the types) and the page. Source: docs/design/SPEC.md, sections 6 and 7; keep the two in step.

// ---- the worker protocol (SPEC section 6) ----

export type Op = "mount" | "boot" | "startup" | "run" | "describe" | "describe_file" | "matrix" | "macros" | "browse" | "memory"
  | "write" | "mkdir" | "remove" | "rename" | "files" | "read";
export type ToWorker = { id: number; op: Op; args?: object };
export type StatusText = "downloading the engine" | "unpacking the engine" | "loading Python" | "loading your files"
  | "loading packages" | "starting the engine";
export type FromWorker = { id: number; result: unknown } | { id: number; error: string; name?: string } | { status: StatusText }
  | { id: number; log: string };   // a chunk of a running run's log

export interface About { dofile: string; engine: "OpenDTA"; engine_commit: string | null; engine_patches: string[]; stata_version: number }

export interface Startup {                       // seconds; the fields depend on mode
  mode: "snapshot" | "normal"; filesS: number; engineS: number;
  fetched?: "download" | "read from cache"; fetchS?: number; unpackS?: number; heapS?: number; sitePackagesS?: number;
  decoder?: "native" | "wasm" | "none"; restoreS?: number; notCached?: string[];   // snapshot
  runtimeS?: number; packagesS?: number;                                            // normal
  storeError?: string;                           // the worker could not open the store; /work started empty
}

export interface FileInfo { path: string; dir: boolean; size: number; mtime: number }   // path inside the working folder

export type Value = number | string | null;      // null: missing "." (or infinity); ".a" to ".z": extended missing
export interface ResultSet { scalars: Record<string, Value>; macros: Record<string, string>; matrices: Record<string, string> }   // "3x3"
export interface Results { e: ResultSet; r: ResultSet; e_changed: boolean; r_changed: boolean }

export interface RunOptions {
  fresh_locals?: boolean;                        // true: clear the top-level locals first. Default false.
  plot_theme?: "light" | "dark";                 // the style of the PNGs in `images` only
}

export interface FileChange { name: string; status: "created" | "modified" | "removed"; bytes: number }

export type ResetKind = "break" | "crash" | "user";
/** Why the client made an rc 9998 result itself. */
export type CutKind = ResetKind | "stopped" | "failed" | "failed-twice" | "no-engine" | "run-failed";

export interface RunResult {
  rc: number; error: string | null; error_command: string | null; log: string;
  results: Results | null;                       // null only in the client's rc 9998 result
  nobs: number; nvars: number; new_graphs: number;
  images: string[];                              // base64 PNG, the last 5 at most
  timing?: { engine: number; encode: number; parse: number; save: number };   // seconds; absent for rc 9998
  error_line: number | null;                     // 1-based line of the failed command in the text sent; null inside a
                                                 // nested do-file, or rc 0
  graph_commands: string[];                      // the command that drew each entry of `images`, same order
  graph_lines: (number | null)[];                // 1-based line of that command in the text sent; same order
  files?: FileChange[];                          // what the after-run difference wrote to the store
  store_error?: string;                          // the store refused that write
  skipped?: string[];                            // a run's files under a folder the page removed or renamed during the run
  kind?: CutKind;                                // only on the client's rc 9998 result
}

export interface Variable { name: string; type: string; format: string; label: string | null; value_label: string | null }
export type DataSummary = { nobs: number; nvars: number; matched: number; offset: number; variables: Variable[]; more: number;
  filename: string | null } | { error: string };
export type Matrix = { rows: string[]; cols: string[]; data: Value[][] } | { error: string };   // names as "eq:name"
export interface Macros { locals: Record<string, string>; globals: Record<string, string>; system_globals: string[] }
export type BrowseRows = { nobs: number; offset: number; vars: string[]; more: number; rows: string[][] } | { error: string };
export interface Memory { heap_bytes: number; data_bytes: number }

/** What each op answers (client.call). */
export interface OpResults {
  mount: void; boot: About; startup: Startup; run: RunResult;
  describe: DataSummary; describe_file: DataSummary; matrix: Matrix; macros: Macros; browse: BrowseRows; memory: Memory;
  write: void; mkdir: void; remove: void; rename: void; files: FileInfo[]; read: Uint8Array;
}
export interface DescribeArgs { vars?: string; offset?: number; limit?: number }

// ---- client.js ----

/** client.js's errors: an Error with a `kind` (the header of client.js lists them). */
export interface ClientError extends Error {
  kind: "failed" | "failed-twice" | "updated" | "reset" | "stopped" | "no-engine" | "busy" | "op";
  reason?: "no-wasm" | "download" | "memory" | "unknown";   // "failed", "failed-twice"
  reset?: ResetKind;                                          // "reset"
}

export interface Progress { received: number; total: number }
export type Downloaded = { cached: true; received: number; total: number } | { cached: false; why: string };

/** The build's list of start files (start-files.json, scripts/start-files.mjs). */
export interface StartFiles {
  built: number; wheelHash: string; size: number; compressed: number;
  files: { path: string; size: number; compressed: number; download: boolean }[];
}

// ---- the file store (SPEC section 7; store.js) ----

export interface PendingRow { op: "write" | "mkdir" | "remove" | "rename"; path: string; to?: string }

// ---- the snapshot (snapshot.js, scripts/make-snapshot.mjs) ----

/** One big file of the snapshot: its name, its size decompressed (`raw`) and as stored (`size`, brotli). */
export interface SnapshotFile { name: string; raw: number; size: number }
/** public/snapshot/manifest.json: which build the snapshot belongs to. */
export interface SnapshotManifest {
  wheel: string; wheelHash: string; pyodide: string; built: number; optimize: 0 | 2;
  files: { snapshot: SnapshotFile; bundle: SnapshotFile };
}
