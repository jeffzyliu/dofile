// The error mark of a file (the red bar and tint on a line): the rule, in one place (the join of step 4, on the coordinator's
// word; the maintainer may change it here). The mark belongs to the file's last run:
//  - set when a run of that file (whole or a selection) ends with an error on a line (any rc but 0 and Break's 1);
//  - cleared when a new run of that same file starts, when the engine is reset or restarted (run.ts clears `lastRun`:
//    the effect engine-gone), and when the marked line is deleted;
//  - it moves with edits (editor/cm.ts maps it through the changes);
//  - a command-line command and a run of another file leave it alone.
// Plain TypeScript with no DOM (only @codemirror/state's types), tested in Node (test/editor.test.ts). Editor.tsx applies
// what these answer.
import { type ChangeSet, MapMode, type Text } from "@codemirror/state";
import type { LastRun, RunHead } from "../types.ts";

/** What to do to the marks: clear none, one file's or all, then set one (the file's path and the run's line). */
export interface MarkChange {
  clear: null | "all" | string;
  set: null | { path: string; line: number };
}

const NOTHING: MarkChange = { clear: null, set: null };

/** A run starts: the file it runs loses its mark. A command touches no file's mark. */
export function onRunStart(run: RunHead): MarkChange {
  return run.kind !== "command" && run.path ? { clear: run.path, set: null } : NOTHING;
}

/** `lastRun` changed: null (the engine is gone: a reset or a restart) clears every mark; a command changes none; a run of
 *  a file clears that file's mark and sets it again on its error line. */
export function onLastRun(r: LastRun | null): MarkChange {
  if (!r) return { clear: "all", set: null };
  if (r.kind === "command" || !r.path) return NOTHING;
  const error = r.rc !== 0 && r.rc !== 1 && r.line !== null;
  return { clear: r.path, set: error ? { path: r.path, line: r.line! } : null };
}

/** Whether `changes` delete the line that starts at `from` in `doc` (the document before them): every character of
 *  it, or, for an empty line, its line break. */
export function lineDeleted(changes: ChangeSet, doc: Text, from: number): boolean {
  const line = doc.lineAt(from);
  if (line.length === 0) {
    const at = line.to < doc.length ? line.to : line.from - 1; // its own break, or the one before the last line
    return at >= 0 && changes.mapPos(at, 1, MapMode.TrackAfter) === null;
  }
  return (
    changes.mapPos(line.from, 1, MapMode.TrackAfter) === null &&
    changes.mapPos(line.to, -1, MapMode.TrackBefore) === null
  );
}
