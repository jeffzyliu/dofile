// The page's state model: docs/design/SPEC.md, section 8, as built in step 3. The signals that hold these are in state.ts.

import type { Equal, Expect, QueuedRun, State, Ticket } from "../engine/machine.ts";
import type {
  About,
  BrowseRows,
  DataSummary,
  FailReason,
  FileInfo,
  Macros,
  Memory,
  ResetKind,
  Results,
  RunHead,
  Stage,
} from "../engine/types.ts";

// Stage, RunHead and FailReason are defined in engine/types.ts (the state machine uses them, and engine/ never imports app/).
export type {
  About,
  BrowseRows,
  DataSummary,
  FailReason,
  FileInfo,
  Macros,
  Memory,
  ResetKind,
  Results,
  RunHead,
  Stage,
};

/** The engine's state as views see it: the sixteen tags of the state machine's State (engine/machine.ts), without the
 *  tickets and without the queued run. Written out by hand, one line per state, so that it can be read; the three checks
 *  below keep it in step with State. A field added to State is not seen by views until it is added here too.
 *  `failed` and `failed-twice`: `message` is for the visitor, plain words, one per reason (engine.ts FAILED; FAILED_TWICE
 *  for `failed-twice`), with no command, file name, byte count or build term; `detail` is the cause, for a developer:
 *  logged to the console, not shown by default. */
export type EngineState =
  | { s: "checking-lock" } // the page load: waiting for the tab lock
  | { s: "checking-cache" } // then for the cache check
  | { s: "none" } // only with ?test=manual
  | { s: "asking"; forRun: boolean } // forRun: a run is queued
  | { s: "declined" }
  | { s: "downloading"; received: number; total: number; t0: number }
  | { s: "starting-list"; stage: Stage; t0: number; done: Partial<Record<Stage, number>> } // a restart fetches the build's list; no worker yet
  | { s: "starting-worker"; stage: Stage; t0: number; done: Partial<Record<Stage, number>> } // done: seconds per finished stage
  | { s: "ready" }
  | { s: "running"; run: RunHead; t0: number }
  | { s: "breaking"; run: RunHead; t0: number; resetAt: number }
  | { s: "waiting"; run: RunHead; t0: number }
  | { s: "failed"; reason: FailReason; detail: string; message: string } // message: the visitor's words
  | { s: "failed-twice"; reason: FailReason; detail: string; message: string }
  | { s: "other-tab-idle" }
  | { s: "other-tab-taking" }; // a take-over is in progress
export type EngineStateName = EngineState["s"];

/** true when V has the tags of the machine's State. */
export type SameTags<V extends { s: string }> = Equal<V["s"], State["s"]>;
/** The type of every field, over every member. `keyof` of a union lists only the keys all members share, so each member is
 *  taken on its own: FieldOf<{ s: "a"; x: 1 } | { s: "b"; y: "t" }> is "a" | 1 | "b" | "t". */
type FieldOf<T> = T extends unknown ? T[keyof T] : never;
/** true when no field of any member of V is a ticket or a queued run. */
export type NothingHidden<V> = Equal<Extract<FieldOf<V>, Ticket | QueuedRun>, never>;
// Check 1: the same tags as the machine's State. A state added to one and not the other does not compile.
// Check 2: no field of any member is a ticket or a queued run.
// Check 3 is view() in engine.ts: its return type is EngineState, so each case must build exactly that member's fields.
export type EngineStateChecked = [Expect<SameTags<EngineState>>, Expect<NothingHidden<EngineState>>];

/** How a run ended. `line`: the error line in the file (a selection's first line minus one added), null with none; with
 *  rc 1 (Break) it is the line of the command that did not start ("stopped before line N", no error mark). `skipped`,
 *  `store_error`: RunResult's (the files a run wrote that were not kept, and why the store refused them). */
export interface LastRun extends RunHead {
  rc: number;
  line: number | null;
  seconds: number;
  skipped?: string[];
  store_error?: string;
}

export interface OpenTab {
  path: string;
  kind: "text" | "dta";
  dirty: boolean;
} // the text lives in CodeMirror

/** The log, as items. A run adds a run-head (none for one command), then one text item that the streamed chunks grow and
 *  the run's complete log replaces, then one graph item per image it drew. `run` on a text item is the run's number (a
 *  graph's `run` is the same), so the view can put each graph's link after the echo of line `Graph.line`.
 *  On the text item, for the log view (4b): `unsaved`, the open files with unsaved edits when the run started (S 15's
 *  note under a nested `do` of one of them); `end`, set when the run ends: the same object as `lastRun` for that run, so
 *  an older run keeps its own rc, line ("Go to line"), skipped and store_error. A run the machine cut (rc 9998) keeps what
 *  streamed in, and its reason follows as a note. */
export type LogItem =
  | { t: "head" }
  | { t: "runhead"; run: RunHead; first: boolean }
  | { t: "text"; text: string; run?: number; streaming?: boolean; unsaved?: string[]; end?: LastRun }
  | { t: "note"; text: string }
  | { t: "graph"; n: number };

/** A graph: from a run (`command` and `line` from RunResult.graph_commands and graph_lines; `line` in the text sent,
 *  so for a selection add its first line minus one) or a .png opened from the files (`path`; run.ts addFileGraph). `n`
 *  counts from 1 until "Clear log"; look a graph up by `n`, not by its index (graphs keeps the last 20). */
export interface Graph {
  n: number;
  png: string;
  theme: "light" | "dark";
  from: "run" | "file";
  path?: string;
  command?: string;
  line?: number | null;
  run?: number;
}

/** The open dialog. Who opens each: download, other-tab: engine.ts (effects of the state machine); reset: 4d's askReset(); clash, delete, delete-all,
 *  close-tab: 4a. delete-all: the head menu's "Delete all files…"; `count` is the files in `files` that are not folders.
 *  A new value with another payload (clash 1, then clash 2) draws a new dialog (dialogs.tsx keys on the whole value). */
export type Dialog =
  | null
  | { d: "download"; forRun: boolean }
  | { d: "clash"; path: string; index: number; total: number }
  | { d: "delete"; paths: string[] }
  | { d: "delete-all"; count: number }
  | { d: "reset" }
  | { d: "close-tab"; path: string }
  | { d: "restore-sample"; paths: string[] }
  | { d: "other-tab" };
export type DialogName = NonNullable<Dialog>["d"];

/** The banners in `banners`. Who adds each: reset: engine.ts on a reset of an engine that had been ready (`kind`: Break
 *  ran out of time or the page cannot ask a run to stop, the worker crashed, or Reset / "Reset now"); storage: files.ts,
 *  once per visit, when persisted() is false and the files change; download-failed: files.ts, when downloadAll() could
 *  not make the zip (removed when a later one works); not-text: 4a; save-failed: 4b; run-changed:
 *  files.ts afterRun, when a run rewrote an open file that has unsaved edits (a save or a reload of that file removes it). */
export type Banner =
  | { b: "reset"; reason: string; kind: ResetKind }
  | { b: "storage" }
  | { b: "download-failed" }
  | { b: "not-text"; path: string }
  | { b: "save-failed"; path: string; message: string }
  | { b: "run-changed"; path: string };
export type BannerName = Banner["b"];

export type Theme = "system" | "light" | "dark";
export type OutputTab = "log" | "graph" | "data" | "results"; // "help" is P2
export type PhoneTab = "files" | "editor" | "log" | "data" | "results";
export type Layout = "phone" | "desktop";
