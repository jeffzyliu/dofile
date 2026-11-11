// The engine's types, shared by worker.ts, client.ts, store.ts and snapshot.ts (which the Node tests run as they are:
// Node removes the types) and the page. Source: docs/design/SPEC.md, sections 6 and 7; keep the two in step.

// ---- what the state machine (machine.ts) and the page share ----

/** One start-up stage. The snapshot start has no "packages"; ?snapshot=0 has no "unpack" (OQ-11). */
export type Stage = "download" | "unpack" | "python" | "files" | "packages" | "engine";
/** Why the engine did not start: worked out from an error's `kind`, `reason` and `name` by whoever raises the event, never
 *  from its text. "updated": the site was updated since the page loaded (offer "Reload the page", keyed on this reason). */
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

// The ops, in three sets. Each op belongs to one, here and in the worker (worker.ts has one handler object per set), and
// the set decides who can send it: the transport's types (client.ts) let nothing else through.

/** Ops that change the engine. Sent only by the transport's start() and run(), which only the effect performer calls. */
export interface LifecycleOps {
  mount: { args: MountArgs; result: void };
  boot: { args: BootArgs; result: About };
  startup: { args: void; result: Startup };
  run: { args: { code: string } & RunOptions; result: RunResult };
}
/** Ops DECLARED to change nothing: not the data, r(), e(), the macros, the matrices, the graphs, the sort order, the log
 *  or /work. Anyone may send one. The declaration is tested (test/engine.test.ts, the fingerprint), not proved. */
export interface ReadOps {
  describe: { args: DescribeArgs; result: DataSummary };
  describe_file: { args: { path: string }; result: DataSummary };
  matrix: { args: { name: string }; result: Matrix };
  macros: { args: void; result: Macros };
  browse: { args: DescribeArgs; result: BrowseRows };
  memory: { args: void; result: Memory };
  files: { args: void; result: FileInfo[] }; // /work as it is: for the tests, not for views
  read: { args: { path: string }; result: Uint8Array };
}
/** The op that brings the page's file changes into /work. Sent only by the function the transport gives to store.attach,
 *  which the store calls after each change it has journalled. It carries nothing: the worker reads the journal (`pending`),
 *  takes the store's version of those paths and clears the journal, in one transaction, then puts that version into /work. */
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
  | { id: number; error: string; name: string }
  | { id: number; log: string } // a chunk of a running run's log
  | { stage: Stage }; // a start-up stage began

/** The dofile wheel, or one of the extra wheels: a URL, or its name and bytes. */
export type Wheel = string | { name: string; bytes: Uint8Array };
/** `boot`'s arguments. `interruptBuffer`: an Int32Array on a SharedArrayBuffer (Break), or null. */
export type BootArgs = { wheel: Wheel; extraWheels?: Wheel[]; interruptBuffer?: Int32Array | null };

/** `mount`'s arguments. A snapshot start has `snapshot` (the URL of its folder, ending in "/"), `built` (which names the
 *  Cache, `dofile-snapshot-<built>`) and `files` (its two big files): all three from the build's list, start-files.json,
 *  which the page has checked is of its own build. The worker fetches no manifest. `?snapshot=0` has none of the three. */
export type MountArgs = { indexURL?: string; brotli?: string } & (
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
  storeError?: string; // the worker could not open the store; /work started empty
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
/** The `kind` of an rc 9998 run result, which the state machine makes (machine.ts, cutResult): a reset, another tab took
 *  the engine ("stopped"), or the run's op failed in the worker ("run-failed": that worker stays). */
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
  graph_themes: ("light" | "dark")[]; // how each image was drawn (its background): light when its command names a color; a kept scheme as drawn
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

/** client.ts's errors: an Error with a `kind` (the header of client.ts lists them). */
export interface ClientError extends Error {
  kind: "failed" | "failed-twice" | "updated" | "reset" | "stopped" | "no-engine" | "op";
  reason?: "no-wasm" | "download" | "memory" | "unknown"; // "failed", from download() and build()
  reset?: ResetKind; // "reset"
}

export interface Progress {
  received: number;
  total: number;
}
/** What download() resolves with. `build`: what `mount` needs of the list download() has just checked (null: the normal
 *  start), so that a start the visitor begins does not fetch the list a second time. */
export type Downloaded = ({ cached: true; received: number; total: number } | { cached: false; why: string }) & {
  build: Build | null;
};

/** The build's list of start files (start-files.json, scripts/start-files.ts): the one statement of the build.
 *  `buildId`: scripts/build-id.ts, from the build's stamp and the snapshot's record; the page compares it with its own (checkBuild). */
export interface StartFiles {
  built: number;
  buildId: string;
  size: number;
  compressed: number;
  snapshot: SnapshotFiles; // the snapshot's two big files, for `mount`
  files: { path: string; size: number; compressed: number; download: boolean }[];
}

// ---- the file store (SPEC section 7; store.ts) ----

/** A row of the journal (`pending`): a page change that /work has not taken yet. */
export interface PendingRow {
  op: "write" | "mkdir" | "remove" | "rename";
  path: string;
  to?: string;
}

// ---- the snapshot (snapshot.ts, scripts/make-snapshot.mjs) ----

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
}
/** public/snapshot/manifest.json: what the snapshot was built from (scripts/build-id.ts, BuildInputs), its time and its two big
 *  files. The build's record, not deployed: scripts/start-files.ts refuses a build whose inputs differ from it, and copies
 *  `built`, `files` and the build id made from it into start-files.json; the page and the worker never fetch it.
 *  `extraWheels`: file name -> SHA-256 of web/wheels/*.whl (a manifest without it is stale). */
export interface SnapshotManifest {
  wheel: string;
  wheelHash: string;
  extraWheels: Record<string, string>;
  pyodide: string;
  built: number;
  optimize: 0 | 2;
  files: SnapshotFiles;
}
