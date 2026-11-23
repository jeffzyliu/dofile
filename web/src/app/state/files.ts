// The file list the page shows. The writer is app/files.ts, through `filesWriter`; everything else reads.

import type { ReadonlySignal } from "@preact/signals-core";
import { computed, signal } from "@preact/signals-core";

import type { FileInfo } from "../types.ts";

export const filesWriter = {
  files: signal<FileInfo[]>([]),
  fresh: signal<Set<string>>(new Set()), // paths the last run created or changed (the "new" badge)
  persisted: signal<boolean | null>(null), // null: unknown
};
export const files: ReadonlySignal<FileInfo[]> = filesWriter.files;
/** Whether the store has a file (folders do not count): "Download all (.zip)" is disabled without one. */
export const hasFiles = computed(() => files.value.some((f) => !f.dir));
export const fresh: ReadonlySignal<Set<string>> = filesWriter.fresh;
export const persisted: ReadonlySignal<boolean | null> = filesWriter.persisted;
