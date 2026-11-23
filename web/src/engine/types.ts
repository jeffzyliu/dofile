// The engine's types, shared by the worker, the transport, the store and the page. Keep them and docs/design/SPEC.md,
// sections 6 and 7, in step.

// ---- what the state machine (machine.ts) and the page share ----

/** How long Break waits before the engine is reset: the one place the 5 s is written. */
export const BREAK_GRACE_MS = 5000;

/** One start-up stage. The snapshot start has no "packages"; ?snapshot=0 has no "unpack". */
export type Stage = "download" | "unpack" | "python" | "files" | "packages" | "engine";
/** Why the engine did not start: worked out from an error's `kind`, `reason` and `name` by whoever raises the event,
 *  never from its text. "updated": the site was updated since the page loaded (offer "Reload the page", keyed on this
 *  reason). */
export type FailReason = "no-wasm" | "download" | "memory" | "updated" | "unknown";
/** What a run sends and how the page names it (SPEC section 4). `lines` are 1-based lines of the active file. */
export interface RunHead {
  kind: "file" | "selection" | "command";
  path?: string;
  lines?: [number, number];
  fresh_locals: boolean;
}
/** What `mount` needs of the build's list for a snapshot start. null: the normal start (?snapshot=0). */
export type Build = { built: number; files: SnapshotFiles };

// ---- the worker protocol (SPEC section 6) ----

// The ops, in three sets. The set decides who can send an op: the transport's types (client.ts) let nothing else
// through.

/** Ops that change the engine. */
export interface LifecycleOps {
  mount: { args: MountArgs; result: void };
  boot: { args: BootArgs; result: About };
  startup: { args: void; result: Startup };
  run: { args: { code: string } & RunOptions; result: RunResult };
  /** The graphics part in the shared buffer landed, failed or is fetched again. The page never sends it without a
   *  buffer. */
  graphics: { args: void; result: void };
}
/** Ops DECLARED to change nothing: not the data, r(), e(), the macros, the matrices, the graphs, the sort order, the
 *  log or /work. Anyone may send one. The declaration is tested (test/engine.test.ts, the fingerprint), not proved. */
export interface ReadOps {
  describe: { args: DescribeArgs; result: DataSummary };
  describe_file: { args: { path: string }; result: DataSummary };
  matrix: { args: { name: string; runId: number }; result: MatrixAnswer };
  macros: { args: void; result: Macros };
  browse: { args: DescribeArgs; result: BrowseRows };
  memory: { args: void; result: Memory };
  files: { args: void; result: FileInfo[] }; // /work as it is: for the tests, not for views
  read: { args: { path: string }; result: Uint8Array };
}
/** The op that brings the page's file changes into /work. It carries nothing: the worker reads the journal (`pending`),
 *  takes the store's version of those paths and clears the journal, in one transaction, then puts that version into
 *  /work. */
export interface JournalOps {
  sync: { args: void; result: void };
}
export type Ops = LifecycleOps & ReadOps & JournalOps;
export type Op = keyof Ops;
/** The read ops the page asks for through the controller's call: not the two views of /work. */
export type ViewOp = Exclude<keyof ReadOps, "files" | "read">;
export type ToWorker = { [K in Op]: { id: number; op: K; args: Ops[K]["args"] } }[Op];
export type FromWorker =
  | { id: number; result: Ops[Op]["result"] }
  | { id: number; error: string; name: string; type?: string }
  | { id: number; log: string } // a chunk of a running run's log
  | { stage: Stage } // a start-up stage began
  // /work could not take the page's version after a run (the store has the run's files): it is out of step with the
  // store. Sent right after that run's answer.
  | { folderError: string }
  // the lazy graphics part. With a shared buffer: "again" (a graph found it failed) or "damaged" (the page refetches
  // it). Without one the worker fetches it and these tell the page how it goes; "damaged" then means the worker dropped
  // its copy
  | { graphics: "again" | "damaged" | "fetching" | "landed" }
  | { graphics: "progress"; received: number }
  | { graphics: "failed"; why: string };

/** Where the worker's copy of the file store failed: "open" (the storage did not open, or could not be read), "copy"
 *  (it was read, but the files could not be written into /work). */
export type StoreCause = "open" | "copy";
/** An error as the worker tells the page: `type` is the Python exception class of a PythonError. An op's error answer
 *  carries it as {id, error: message, name, type?}. */
export type PageError = { message: string; name: string; type?: string };
/** Why the worker has no file store, and what the error was. */
export type StoreError = PageError & { cause: StoreCause };

/** The dofile wheel, or one of the extra wheels: a URL, or its name and bytes. */
export type Wheel = string | { name: string; bytes: Uint8Array };
/** `boot`'s arguments. `interruptBuffer`: an Int32Array on a SharedArrayBuffer (Break), or null. */
export type BootArgs = {
  wheel: Wheel;
  extraWheels?: Wheel[];
  interruptBuffer?: Int32Array | null;
  /** A lazy snapshot's graphics part. `sab`: the buffer the page hands it over in (layout: lazy-part.ts); null: the
   *  worker fetches it itself. */
  graphics?: { file: SnapshotFile; sab: SharedArrayBuffer | null };
};

/** `mount`'s arguments. A snapshot start has `snapshot` (the URL of its folder, ending in "/"), `built` (which names
 *  the Cache, `dofile-snapshot-<built>`) and `files` (its two big files), from the build's list. `?snapshot=0` has
 *  none. */
export type MountArgs = {
  indexURL?: string;
  brotli?: string;
  /** The cap on the WebAssembly heap in MiB (memcap.ts); absent or 0: none. */
  memcap?: number;
} & (
  | { snapshot: string; built: number; files: SnapshotFiles }
  | { snapshot?: undefined; built?: undefined; files?: undefined }
);

export interface About {
  dofile: string;
  engine: "OpenDTA";
  engine_commit: string | null;
  engine_patches: string[];
  stata_version: number;
}

export interface Startup {
  // seconds; the fields depend on mode
  mode: "snapshot" | "normal";
  filesS: number;
  engineS: number;
  fetched?: "download" | "read from cache";
  fetchS?: number;
  unpackS?: number;
  heapS?: number;
  sitePackagesS?: number;
  decoder?: "native" | "wasm" | "none";
  restoreS?: number;
  notCached?: string[]; // snapshot
  runtimeS?: number;
  packagesS?: number; // normal
  storeError?: StoreError; // the worker has no store; /work started empty
}

export interface FileInfo {
  path: string;
  dir: boolean;
  size: number;
  mtime: number;
} // path inside the working folder

export type Value = number | string | null; // null: missing "." (or infinity); ".a" to ".z": extended missing
export interface ResultSet {
  scalars: Record<string, Value>;
  macros: Record<string, string>;
  matrices: Record<string, string>;
} // "3x3"
export interface Results {
  /** The worker's number of the run that made these results (it counts its runs, when each starts); the `matrix` op names it. */
  runId: number;
  e: ResultSet;
  r: ResultSet;
  e_changed: boolean;
  r_changed: boolean;
}

export interface RunOptions {
  fresh_locals?: boolean; // true: clear the top-level locals first. Default false.
  plot_theme?: "light" | "dark"; // the style of the PNGs in `images` only
}

export interface FileChange {
  name: string;
  status: "created" | "modified" | "removed";
  bytes: number;
}

export type ResetKind = "break" | "crash" | "user";
/** What crashed the engine: the worker's error; the browser closed the file store; /work out of step with the store. */
export type CrashCause = "error" | "storage" | "folder";
/** The `kind` of an rc 9998 run result (machine.ts, cutResult): a reset, another tab took the engine ("stopped"), or
 *  the run's op failed in the worker ("run-failed": that worker stays). */
export type CutKind = ResetKind | "stopped" | "run-failed";

export interface RunResult {
  rc: number;
  error: string | null;
  error_command: string | null;
  log: string;
  results: Results | null; // null only in the machine's rc 9998 result
  nobs: number;
  nvars: number;
  new_graphs: number;
  images: string[]; // base64 PNG, the last 5 at most
  timing?: { engine: number; encode: number; parse: number; save: number }; // seconds; absent for rc 9998
  error_line: number | null; // 1-based line of the failed command in the text sent; null inside a
  // nested do-file, or rc 0
  graph_commands: string[]; // the command that drew each entry of `images`, same order
  graph_lines: (number | null)[]; // 1-based line of that command in the text sent; same order
  files?: FileChange[]; // what the after-run difference wrote to the store
  store_error?: string; // the store refused that write
  skipped?: string[]; // a run's files under a folder the page removed or renamed during the run
  kind?: CutKind; // only on the machine's rc 9998 result
}

export interface Variable {
  name: string;
  type: string;
  format: string;
  label: string | null;
  value_label: string | null;
}
export type DataSummary =
  | {
      nobs: number;
      nvars: number;
      matched: number;
      offset: number;
      variables: Variable[];
      more: number;
      filename: string | null;
    }
  | { error: string };
export type Matrix = { rows: string[]; cols: string[]; data: Value[][] } | { error: string }; // names as "eq:name"
/** `changed`: a later run than `runId` has made the results since, so the matrix is not the one the page showed. */
export type MatrixAnswer = Matrix | { changed: true };
export interface Macros {
  locals: Record<string, string>;
  globals: Record<string, string>;
  system_globals: string[];
}
export type BrowseRows =
  | { nobs: number; offset: number; vars: string[]; more: number; rows: string[][] }
  | { error: string };
export interface Memory {
  heap_bytes: number;
  data_bytes: number;
}

export interface DescribeArgs {
  vars?: string;
  offset?: number;
  limit?: number;
}

// ---- client.ts ----

/** An error the transport (client.ts) rejects with. By `kind`:
 *  - "failed": download() or build(): the list or a file did not arrive as the list says (`reason` "download"), or the
 *    build has no snapshot, or the Cache broke (`reason` "unknown"). Also a call cut because its worker's start failed.
 *  - "failed-twice": a call cut because its worker failed twice while starting.
 *  - "updated": the list is of another build than the page (checkBuild); the page must reload.
 *  - "reset": a call cut by a reset; `reset` says which.
 *  - "stopped": a call cut because another tab took the engine.
 *  - "no-engine": query() or run() with no live worker.
 *  - "op": the worker answered the call with an error; `name` is the worker's error name.
 *  download() rejects with an AbortError instead when its signal aborts. */
export interface ClientError extends Error {
  kind: "failed" | "failed-twice" | "updated" | "reset" | "stopped" | "no-engine" | "op";
  reason?: "download" | "unknown"; // "failed", from download() and build() only
  reset?: ResetKind; // "reset"
  type?: string; // "op": the Python exception class, when the worker's error is a PythonError
}

export interface Progress {
  received: number;
  total: number;
}
/** Progress of a lazy snapshot's graphics part, fetched after the start files: bytes as sent (compressed). `state`:
 *  "pending" is not asked for yet; `error` says why it failed. */
export interface GraphicsProgress extends Progress {
  state: "pending" | "fetching" | "landed" | "failed";
  error?: string;
}
/** What download() resolves with. `build`: what `mount` needs of the list download() has just checked (null: the normal
 *  start), so that a start the visitor begins does not fetch the list a second time. */
export type Downloaded = ({ cached: true; received: number; total: number } | { cached: false; why: string }) & {
  build: Build | null;
};

/** The build's list of start files (start-files.json, scripts/start-files.ts): the one statement of the build.
 *  `buildId`: scripts/build-id.ts; the page compares it with its own (checkBuild). */
export interface StartFiles {
  built: number;
  buildId: string;
  size: number;
  compressed: number; // every file's compressed size, the page's own included
  // the compressed size of the files `download()` fetches (`download: true`): the size the visitor is told
  download: number;
  snapshot: SnapshotFiles; // the snapshot's two big files, for `mount`
  // `path` is relative to the list's URL; `size` is on disk, `compressed` as a host sends it; `download`: download()
  // fetches it (the rest came with the page)
  files: { path: string; size: number; compressed: number; download: boolean }[];
}

// ---- the file store (SPEC section 7; store.ts) ----

/** A row of the journal (`pending`): a page change that /work has not taken yet. */
export interface PendingRow {
  op: "write" | "mkdir" | "remove" | "rename";
  path: string;
  to?: string;
}

// ---- the snapshot (snapshot.ts, scripts/make-snapshot.ts) ----

/** One big file of the snapshot: its name, its size decompressed (`raw`) and as stored (`size`, brotli). */
export interface SnapshotFile {
  name: string;
  raw: number;
  size: number;
}
/** The snapshot's two big files: the heap and the site-packages bundle. */
export interface SnapshotFiles {
  snapshot: SnapshotFile;
  bundle: SnapshotFile;
  /** A lazy snapshot only (docs/lazy-matplotlib.md): matplotlib and what only it needs, left out of the heap and the
   *  bundle. Not a start file: the page fetches it after them. snapshot.ts, packGraphics, has its layout. */
  graphics?: SnapshotFile;
}
/** public/snapshot/manifest.json: what the snapshot was built from (scripts/build-id.ts, BuildInputs), its time and its
 *  two big files. The build's record, not deployed: scripts/start-files.ts copies from it into start-files.json.
 *  `extraWheels`: file name -> SHA-256 of web/wheels/*.whl (a manifest without it is stale). */
export interface SnapshotManifest {
  wheel: string;
  wheelHash: string;
  extraWheels: Record<string, string>;
  pyodide: string;
  built: number;
  /** The build's settings (scripts/build-id.ts, SnapshotKnobs): PYTHONOPTIMIZE, Brotli quality, no matplotlib in the heap,
   *  Pyodide's trampoline kept. Optional in the type: a manifest from before they were recorded has none of the last three. */
  optimize: 0 | 2;
  quality?: number;
  noMpl?: boolean;
  trampoline?: boolean;
  files: SnapshotFiles;
}
