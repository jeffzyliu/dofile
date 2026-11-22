// The worker's copy of the files in /work, an in-memory folder: filled from the store at mount, given the page's changes
// through the journal (`sync`), and a run's changes written back to the store. Contract: SPEC section 7.

import type { AppliedRun, FileStore, RunChange, StoreCopy } from "./store.ts";
import type { FileChange, FileInfo, StoreCause } from "./types.ts";

export const ROOT = "/work";
const HIDDEN = ".dofile";

/** What the mirror uses of Emscripten's file system (Pyodide's `py.FS`). */
export interface MirrorFS {
  readdir(path: string): string[];
  stat(path: string): { mode: number; size: number; mtime: Date };
  isDir(mode: number): boolean;
  analyzePath(path: string): { exists: boolean };
  unlink(path: string): void;
  rmdir(path: string): void;
  mkdirTree(path: string): void;
  writeFile(path: string, data: Uint8Array, opts?: { canOwn?: boolean }): void;
  readFile(path: string): Uint8Array;
  utime(path: string, atime: number, mtime: number): void;
}
/** What the mirror uses of Pyodide's `py.PATH`. */
export interface MirrorPath {
  normalize(path: string): string;
  dirname(path: string): string;
}
/** What the worker uses of the file store: the page's FileStore, or in the Node tests a stand-in. */
export type MirrorStore = Pick<FileStore, "takeAll" | "applyRun">;
export type PageError = { message: string; name: string; type?: string };
export type StoreError = PageError & { cause: StoreCause };
export type SavedRun = { files: FileChange[]; skipped: string[]; store_error?: string };

const within = (path: string, top: string) => path === top || path.startsWith(`${top}/`);

export class WorkMirror {
  readonly #fs: MirrorFS;
  readonly #path: MirrorPath;
  readonly #errorOf: (e: unknown) => PageError;
  #store: MirrorStore | null = null;
  #storeError: StoreError | null = null;
  #outOfStep: string | null = null;
  // path -> { status, dir }: what a run did to /work that the store refused to take. The next run tries it again.
  #unsaved = new Map<string, { status: FileChange["status"]; dir: boolean }>();

  /** @param errorOf - turns a thrown value into the error the page is told (the worker's errorForPage). */
  constructor(fs: MirrorFS, path: MirrorPath, errorOf: (e: unknown) => PageError) {
    this.#fs = fs;
    this.#path = path;
    this.#errorOf = errorOf;
  }

  /** Why there is no store (it could not be opened, or its copy failed), or null. */
  get storeError(): StoreError | null {
    return this.#storeError;
  }

  /** Why /work could not take the page's version after a run, once: the worker says it after the run's answer. */
  takeOutOfStep(): string | null {
    const why = this.#outOfStep;
    this.#outOfStep = null;
    return why;
  }

  /**
   * Makes /work and copies the store into it. With no store (the browser refused, or there is no IndexedDB) /work
   * starts empty; storeError says why, and so does the store_error of every run that writes a file.
   * @param storeOf - opens the store; what it throws is the cause "open".
   */
  async copyStore(storeOf: () => MirrorStore): Promise<void> {
    this.#fs.mkdirTree(ROOT);
    let cause: StoreCause = "open";
    try {
      this.#store = storeOf();
      const copy = await this.#store.takeAll();
      cause = "copy";
      this.#putRecords(copy);
    } catch (e) {
      this.#store = null;
      this.#storeError = { ...this.#errorOf(e), cause };
      console.warn(`[dofile] the files are not saved: ${this.#storeError.message}`);
    }
  }

  /** The path in /work of `path`; throws for one outside it. */
  inRoot(path: string): string {
    const full = this.#path.normalize(`${ROOT}/${path}`);
    if (full !== ROOT && !full.startsWith(`${ROOT}/`)) throw new Error(`not in the working folder: ${path}`);
    return full;
  }

  /** Every file and folder in /work, by path inside it, without the hidden folder. */
  walk(dir = ROOT, out: FileInfo[] = []): FileInfo[] {
    for (const name of this.#fs.readdir(dir)) {
      if (name === "." || name === ".." || (dir === ROOT && name === HIDDEN)) continue;
      const full = `${dir}/${name}`,
        st = this.#fs.stat(full),
        isDir = this.#fs.isDir(st.mode);
      out.push({ path: full.slice(ROOT.length + 1), dir: isDir, size: isDir ? 0 : st.size, mtime: st.mtime.getTime() });
      if (isDir) this.walk(full, out);
    }
    return out;
  }

  // With no store (mount could not open it) there is no journal to read, and the transport attaches no `sync`: one that
  // arrives before it knows that does nothing.
  async sync(): Promise<void> {
    if (this.#store) this.#takePageVersion(await this.#store.applyRun([]));
  }

  /**
   * Lists /work before a run (saveRun's `before`). A file's time has 1 ms steps: it waits until the clock is past the
   * newest file, so that anything the run writes gets a later time than any file had before (saveRun tells a same-size
   * rewrite by it). A time after now (a clock that was ahead) is left out: any rewrite changes it anyway.
   */
  beforeRun(): FileInfo[] {
    const before = this.walk();
    const now = Date.now(),
      newest = before.reduce((m, f) => (f.mtime <= now ? Math.max(m, f.mtime) : m), 0);
    while (Date.now() <= newest) {
      /* one clock step (up to 100 ms with a clamped clock) */
    }
    return before;
  }

  /**
   * After a run: writes what it did to /work to the store, and /work then takes the page's version of what the page
   * changed meanwhile. Files the run created or changed are written, files that were there before and are gone are
   * deleted, the rest is not read at all.
   * Why modification time and size: the wait in `beforeRun` makes the time enough for any write of one byte or more. A
   * truncation is not stamped by MEMFS (its setattr takes no time with a size, and a write of 0 bytes sets none), so a
   * run that empties a file changes only its size.
   * @param before - beforeRun()'s list.
   * @returns RunResult's `files` and `skipped`, and `store_error` if the store refused (the next run then tries again).
   * If /work then cannot take the page's version, takeOutOfStep() says why.
   */
  async saveRun(before: FileInfo[]): Promise<SavedRun> {
    const was = new Map(before.map((f) => [f.path, f])),
      now = new Set<string>(),
      changes: RunChange[] = [];
    for (const f of this.walk()) {
      now.add(f.path);
      const old = was.get(f.path),
        failed = this.#unsaved.get(f.path);
      const what = failed
        ? failed.status === "created"
          ? "created"
          : "modified"
        : !old
          ? "created"
          : old.dir !== f.dir || (!f.dir && (old.size !== f.size || old.mtime !== f.mtime))
            ? "modified"
            : null;
      if (what) changes.push({ ...f, status: what, data: f.dir ? undefined : this.#fs.readFile(`${ROOT}/${f.path}`) });
    }
    for (const f of before)
      if (!now.has(f.path) && !this.#unsaved.has(f.path)) changes.push({ ...f, status: "removed" });
    for (const [path, failed] of this.#unsaved) {
      // gone now; if the store never had it, there is nothing to delete
      if (!now.has(path) && failed.status !== "created")
        changes.push({ path, dir: failed.dir, size: 0, mtime: 0, status: "removed" });
    }
    if (!changes.length) return { files: [], skipped: [] };
    if (!this.#store) return { files: [], skipped: [], store_error: this.#storeError!.message };
    let saved: AppliedRun;
    try {
      saved = await this.#store.applyRun(changes);
    } catch (e) {
      this.#unsaved = new Map(changes.map((c) => [c.path, { status: c.status, dir: c.dir }]));
      return { files: [], skipped: [], store_error: this.#errorOf(e).message };
    }
    this.#unsaved = new Map();
    try {
      this.#takePageVersion(saved);
    } catch (e) {
      this.#outOfStep = this.#errorOf(e).message; // the run's files are kept; the page replaces this worker
    }
    return { files: saved.files, skipped: saved.skipped };
  }

  #exists(full: string): boolean {
    return this.#fs.analyzePath(full).exists;
  }

  #removeTree(full: string): void {
    if (!this.#fs.isDir(this.#fs.stat(full).mode)) {
      this.#fs.unlink(full);
      return;
    }
    for (const name of this.#fs.readdir(full)) if (name !== "." && name !== "..") this.#removeTree(`${full}/${name}`);
    this.#fs.rmdir(full);
  }

  #putRecords({ infos, data }: Pick<StoreCopy, "infos" | "data">): void {
    const mtimes = new Map(infos.map((i) => [i.path, i.mtime]));
    for (const i of infos) if (i.dir) this.#fs.mkdirTree(`${ROOT}/${i.path}`);
    for (const [path, bytes] of data) {
      const full = `${ROOT}/${path}`,
        mtime = mtimes.get(path as string) ?? Date.now();
      this.#fs.mkdirTree(this.#path.dirname(full));
      this.#fs.writeFile(full, new Uint8Array(bytes), { canOwn: true }); // the bytes just read: no second copy
      this.#fs.utime(full, mtime, mtime);
    }
  }

  // Puts the page's version of the paths the journal named (applyRun's `resync`) into /work.
  #takePageVersion({ resync }: AppliedRun): void {
    for (const path of resync.paths) {
      if (this.#exists(`${ROOT}/${path}`)) this.#removeTree(`${ROOT}/${path}`);
      this.#forget(path); // /work has the store's version there now: a run's refused write to it is not owed any more
    }
    // Where the store has a folder (above each record it gives, and at each folder the page made), /work may have a
    // file: a run's that the store refused. mkdirTree would pass over it (it ignores EEXIST) and the write under it
    // would fail.
    for (const i of resync.infos) this.#foldersAt(i.path, i.dir);
    for (const path of resync.dirs) this.#foldersAt(path, true);
    this.#putRecords(resync);
    for (const path of resync.dirs) this.#fs.mkdirTree(`${ROOT}/${path}`);
  }

  // The folders above `path` (and `path` itself, with `self`) are folders in the store: a file /work has at one of them
  // goes, and is not owed any more.
  #foldersAt(path: string, self: boolean): void {
    const parts = path.split("/");
    for (let n = 1; n <= parts.length - (self ? 0 : 1); n++) {
      const p = parts.slice(0, n).join("/"),
        full = `${ROOT}/${p}`;
      if (this.#exists(full) && !this.#fs.isDir(this.#fs.stat(full).mode)) {
        this.#fs.unlink(full);
        this.#forget(p);
      }
    }
  }

  // A run's refused write is owed to the store until the page moves or replaces the file.
  #forget(path: string): void {
    for (const p of [...this.#unsaved.keys()]) if (within(p, path)) this.#unsaved.delete(p);
  }
}
