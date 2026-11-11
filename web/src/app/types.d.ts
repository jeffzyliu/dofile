// The page's state model: docs/design/SPEC.md, section 8, as built in step 3. The signals that hold these are in state.js.

import type { About, BrowseRows, DataSummary, FileInfo, Macros, Memory, ResetKind, Results } from "../engine/types";
export type { About, BrowseRows, DataSummary, FileInfo, Macros, Memory, ResetKind, Results };

/** One start-up stage. The snapshot start has no "packages"; ?snapshot=0 has no "unpack" (OQ-11). */
export type Stage = "download" | "unpack" | "python" | "files" | "packages" | "engine";

/** What a run sends and how the page names it (section 4). `lines` are 1-based lines of the active file. */
export interface RunHead { kind: "file" | "selection" | "command"; path?: string; lines?: [number, number]; fresh_locals: boolean }

export type EngineState =
  | { s: "none" } | { s: "asking"; forRun: boolean } | { s: "declined" } | { s: "ready" } | { s: "other-tab" }
  | { s: "downloading"; received: number; total: number; t0: number }
  | { s: "starting"; stage: Stage; t0: number; done: Partial<Record<Stage, number>> }   // seconds per finished stage
  | { s: "running" | "waiting"; run: RunHead; t0: number }
  | { s: "breaking"; run: RunHead; t0: number; resetAt: number }
  | { s: "failed"; reason: FailReason; message: string; detail: string }
  | { s: "failed-twice"; reason: FailReason; message: string; detail: string };
export type EngineStateName = EngineState["s"];
/** Why the engine did not start: from the client's `kind`, `reason` and `name`, never its text. "updated": the site was
 *  updated since the page loaded (offer "Reload the page", keyed on this reason). `message` is for the visitor: plain
 *  words, one per reason (engine.js FAILED; FAILED_TWICE for `failed-twice`), with no command, file name, byte count or
 *  build term. `detail` is the client's cause, for a developer: logged to the console, not shown by default. */
export type FailReason = "no-wasm" | "download" | "memory" | "updated" | "unknown";

/** How a run ended. `line`: the error line in the file (a selection's first line minus one added), null with none; with
 *  rc 1 (Break) it is the line of the command that did not start ("stopped before line N", no error mark). `skipped`,
 *  `store_error`: RunResult's (the files a run wrote that were not kept, and why the store refused them). */
export interface LastRun extends RunHead { rc: number; line: number | null; seconds: number; skipped?: string[]; store_error?: string }

export interface OpenTab { path: string; kind: "text" | "dta"; dirty: boolean }   // the text lives in CodeMirror

/** The log, as items. A run adds a run-head (none for one command), then one text item that the streamed chunks grow and
 *  the run's complete log replaces, then one graph item per image it drew. `run` on a text item is the run's number (a
 *  graph's `run` is the same), so the view can put each graph's link after the echo of line `Graph.line`.
 *  On the text item, for the log view (4b): `unsaved`, the open files with unsaved edits when the run started (S 15's
 *  note under a nested `do` of one of them); `end`, set when the run ends: the same object as `lastRun` for that run, so
 *  an older run keeps its own rc, line ("Go to line"), skipped and store_error. A run the client cut (rc 9998) keeps what
 *  streamed in, and its reason follows as a note. */
export type LogItem = { t: "head" } | { t: "runhead"; run: RunHead; first: boolean }
  | { t: "text"; text: string; run?: number; streaming?: boolean; unsaved?: string[]; end?: LastRun }
  | { t: "note"; text: string } | { t: "graph"; n: number };

/** A graph: from a run (`command` and `line` from RunResult.graph_commands and graph_lines; `line` in the text sent,
 *  so for a selection add its first line minus one) or a .png opened from the files (`path`; run.js addFileGraph). `n`
 *  counts from 1 until "Clear log"; look a graph up by `n`, not by its index (graphs keeps the last 20). */
export interface Graph { n: number; png: string; theme: "light" | "dark"; from: "run" | "file"; path?: string;
  command?: string; line?: number | null; run?: number }

/** The open dialog. Who opens each: download, other-tab: engine.js; reset: 4d's askReset(); clash, delete, delete-all,
 *  close-tab: 4a. delete-all: the head menu's "Delete all files…"; `count` is the files in `files` that are not folders.
 *  A new value with another payload (clash 1, then clash 2) draws a new dialog (dialogs.tsx keys on the whole value). */
export type Dialog = null | { d: "download"; forRun: boolean } | { d: "clash"; path: string; index: number; total: number }
  | { d: "delete"; paths: string[] } | { d: "delete-all"; count: number } | { d: "reset" } | { d: "close-tab"; path: string }
  | { d: "other-tab" };
export type DialogName = NonNullable<Dialog>["d"];

/** The banners in `banners`. Who adds each: reset: engine.js on a reset of an engine that had been ready (`kind`: Break
 *  ran out of time or the page cannot ask a run to stop, the worker crashed, or Reset / "Reset now"); storage: files.js,
 *  once per visit, when persisted() is false and the files change; download-failed: files.js, when downloadAll() could
 *  not make the zip (removed when a later one works); not-text: 4a; save-failed: 4b; memory: not in P1. */
export type Banner = { b: "reset"; reason: string; kind: ResetKind } | { b: "memory" } | { b: "storage" } | { b: "download-failed" }
  | { b: "not-text"; path: string } | { b: "save-failed"; path: string; message: string };
export type BannerName = Banner["b"];

export type Theme = "system" | "light" | "dark";
export type OutputTab = "log" | "graph" | "data" | "results";   // "help" is P2
export type PhoneTab = "files" | "editor" | "log" | "data" | "results";
export type Layout = "phone" | "desktop";
