// The user's files: dofile's own store in IndexedDB, one record per file or folder (docs/design/SPEC.md, section 7).
//   info:    path -> { path, dir, size, mtime }
//   data:    path -> ArrayBuffer                    a file's bytes
//   pending: key  -> { op, path, to? }              the journal: a page change that /work has not taken yet
//
// A page change writes its records and a `pending` row in one transaction, then calls `sync`, which tells the worker to
// read the journal (applyRun with no changes). So /work takes the store's version of a path whichever message or copy
// finds its row first, and the order in which syncs arrive does not matter.

import type { FileChange, FileInfo, PendingRow } from "./types.ts";
import { zipParts } from "./zip.ts";

/** What a run did to one path in /work, for applyRun. `data`: a file's bytes, unless removed. */
export interface RunChange {
  path: string;
  dir: boolean;
  size: number;
  mtime: number;
  status: FileChange["status"];
  data?: Uint8Array;
}
export interface StoreCopy {
  infos: FileInfo[];
  data: [IDBValidKey, ArrayBuffer][];
}
export interface AppliedRun {
  files: FileChange[];
  skipped: string[];
  resync: { paths: string[]; infos: FileInfo[]; data: [string, ArrayBuffer][]; dirs: string[] };
}

export const DB_NAME = "dofile";
const HIDDEN = ".dofile"; // never listed, copied or zipped
const ALL = ["info", "data", "pending"];

/** The name of the error a change rejects with when the store does not hold what the caller expected: a name taken
 *  (`rename`'s `to`, `write` expecting "absent") or a file changed since it was read (`write` expecting its info). The
 *  page decides from the name, never from the text. */
export const CONFLICT = "StoreConflict";

/** What `write` expects at its path: "absent" (no file or folder), or the file as it was read. Two writes of one path never
 *  share an mtime (`write` moves it on by 1 ms when the clock has not), so the size and mtime tell them apart. */
export type Expect = "absent" | Pick<FileInfo, "size" | "mtime">;

export class StoreConflict extends Error {
  declare now: FileInfo | null; // what the store holds at the path
  constructor(message: string, now: FileInfo | null) {
    super(message);
    this.name = CONFLICT;
    this.now = now;
  }
}

export const isConflict = (e: unknown): e is StoreConflict => (e as Error | null)?.name === CONFLICT;

/** Throws unless `path` is inside the working folder: relative, with "/", no "..", not in the hidden folder. */
export function cleanPath(path: string): string {
  const parts = typeof path === "string" ? path.split("/") : [""];
  if (parts[0] === HIDDEN || parts.some((p) => p === "" || p === "." || p === ".."))
    throw new Error(`not in the working folder: ${path}`);
  return path;
}

const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((ok, err) => {
    r.onsuccess = () => ok(r.result);
    r.onerror = () => err(r.error);
  });
// "0" is the character after "/"
const under = (path: string) => IDBKeyRange.bound(`${path}/`, `${path}0`, false, true);
const exact = (data: Uint8Array): ArrayBuffer =>
  data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
const within = (path: string, top: string) => path === top || path.startsWith(`${top}/`); // `path` is `top` or under it

function parents(path: string): string[] {
  const out: string[] = [];
  for (let i = path.indexOf("/"); i > 0; i = path.indexOf("/", i + 1)) out.push(path.slice(0, i));
  return out;
}

async function makeParents(t: IDBTransaction, path: string) {
  const info = t.objectStore("info");
  for (const p of parents(path)) {
    const old = await req(info.get(p));
    if (old && !old.dir) throw new Error(`${p} is a file, not a folder`);
    if (!old) info.put({ path: p, dir: true, size: 0, mtime: Date.now() });
  }
}

async function tree(t: IDBTransaction, path: string): Promise<[FileInfo[], [string, ArrayBuffer][]]> {
  const info = t.objectStore("info");
  const data = t.objectStore("data");
  const top = await req(info.get(path));
  const infos: FileInfo[] = [...(top ? [top] : []), ...(await req(info.getAll(under(path))))];
  return [
    infos,
    await Promise.all(
      infos
        .filter((i) => !i.dir)
        .map(async (i): Promise<[string, ArrayBuffer]> => [i.path, await req(data.get(i.path))]),
    ),
  ];
}

// `closed()` is called when the browser closes the database under us (another page upgrades or deletes it).
function open(factory: IDBFactory | null | undefined, closed: () => void) {
  return new Promise<IDBDatabase>((ok, err) => {
    if (!factory) return err(new Error("this browser has no storage for files (IndexedDB)"));
    const r = factory.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("info", { keyPath: "path" });
      r.result.createObjectStore("data");
      r.result.createObjectStore("pending", { autoIncrement: true });
    };
    r.onsuccess = () => {
      r.result.onversionchange = () => {
        r.result.close();
        closed();
      };
      r.result.onclose = closed;
      ok(r.result);
    };
    r.onerror = () => err(r.error);
    r.onblocked = () => err(new Error("the file storage is in use by an older page; close the other dofile tabs"));
  });
}

export class FileStore {
  declare factory: IDBFactory | null | undefined;
  declare opened: Promise<IDBDatabase> | undefined;
  declare sync: null | (() => void);
  declare blocked: boolean;
  declare onChange: null | ((row: PendingRow) => void);
  declare onClosed: null | (() => void);
  constructor(factory: IDBFactory | null | undefined) {
    this.factory = factory;
    this.opened = undefined; // the open database, once asked for
    this.sync = null; // tells the live worker to take the journal; null while there is none
    this.blocked = false; // true in a tab that does not own the files (the tab lock): it writes nothing
    this.onChange = () => {}; // called after every change this page made, with its journal row (what it changed)
    this.onClosed = null; // the engine client's: called when the browser closed the database under us
  }

  /** Called when a worker starts, and with null when it is gone (or has no store of its own). While `sync` is null a
   *  change writes no `pending` row: the next worker copies the whole store.
   *  @param onClosed - called when the browser closes the database (another page deleted or upgraded it, "Clear site
   *  data"): /work then holds files the store may no longer have, which the journal cannot say. After a deleted
   *  database the new worker's mount copies the store as it is now; after an upgrade by another page this page still
   *  opens version 1, which fails (VersionError): the new worker's start fails with reason "updated". */
  attach(sync: FileStore["sync"], { onClosed = null }: { onClosed?: null | (() => void) } = {}) {
    Object.assign(this, { sync, onClosed });
  }

  /** One transaction. It rejects with the browser's error if it fails, and then nothing of it is kept. A database the
   *  browser closed is opened again by the next call. */
  async tx<T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => T | Promise<T>): Promise<T> {
    this.opened ??= open(this.factory, () => {
      if (this.opened !== mine) return;
      this.opened = undefined;
      try {
        this.onClosed?.();
      } catch (e) {
        console.warn(e);
      }
    }).catch((e) => {
      this.opened = undefined;
      throw e;
    });
    const mine: Promise<IDBDatabase> = this.opened;
    const t = (await mine).transaction(stores, mode);
    const done = new Promise<void>((ok, err) => {
      t.oncomplete = () => ok();
      t.onabort = () => err(t.error ?? new Error("the transaction was aborted"));
    });
    done.catch(() => {});
    try {
      const out = await fn(t);
      await done;
      return out;
    } catch (e: any) {
      try {
        t.abort();
      } catch {
        /* already aborted */
      }
      // a request that was waiting when the transaction aborted only says "aborted": the transaction's error says why
      throw e?.name === "AbortError" && t.error ? t.error : e;
    }
  }

  /** A change made by the page: the records and, when a worker is live, a `pending` row in one transaction; then
   *  `sync`. Changes apply in the order called: `tx` makes its transaction right after the shared `opened` promise, and
   *  IndexedDB runs readwrite transactions over the same stores in the order made (a write called before a rename is
   *  moved by it; the page's Save relies on that: app/files/turns.ts fileTurn). */
  async change<T>(row: PendingRow, fn: (t: IDBTransaction) => T | Promise<T>): Promise<T> {
    if (this.blocked) throw new Error("dofile is open in another tab");
    const sync = this.sync;
    const out = await this.tx(ALL, "readwrite", async (t) => {
      const out = await fn(t);
      if (sync) await req(t.objectStore("pending").add(row));
      return out;
    });
    sync?.();
    try {
      this.onChange?.(row);
    } catch (e) {
      console.warn(e);
    } // the change is made: a listener that throws does not undo it
    return out;
  }

  // ---- the page's API ----

  async list(): Promise<FileInfo[]> {
    return this.tx(["info"], "readonly", (t) => req(t.objectStore("info").getAll()));
  }

  async read(path: string): Promise<Uint8Array<ArrayBuffer>> {
    cleanPath(path);
    const bytes: ArrayBuffer | undefined = await this.tx(["data"], "readonly", (t) =>
      req(t.objectStore("data").get(path)),
    );
    if (!bytes) throw new Error(`no such file: ${path}`);
    return new Uint8Array(bytes);
  }

  /** Rejects with a StoreConflict, writing nothing, when the path does not hold what `expect` says (checked in the
   *  write's transaction). */
  async write(path: string, data: Uint8Array, expect?: Expect): Promise<FileInfo> {
    cleanPath(path);
    const bytes = exact(data); // only the view's bytes, not the whole buffer under it
    return this.change({ op: "write", path }, async (t) => {
      await makeParents(t, path);
      const old: FileInfo | undefined = await req(t.objectStore("info").get(path));
      if (expect === "absent" && old) throw new StoreConflict(`${path} already exists`, old);
      if (
        expect !== undefined &&
        expect !== "absent" &&
        (old?.dir !== false || old.size !== expect.size || old.mtime !== expect.mtime)
      )
        throw new StoreConflict(`${path} changed since it was read`, old ?? null);
      if (old?.dir) throw new Error(`${path} is a folder`);
      const info: FileInfo = {
        path,
        dir: false,
        size: bytes.byteLength,
        mtime: Math.max(Date.now(), (old?.mtime ?? 0) + 1),
      };
      t.objectStore("info").put(info);
      t.objectStore("data").put(bytes, path);
      return info;
    });
  }

  /** The record of `path`, a file or a folder; null when there is none. */
  async info(path: string): Promise<FileInfo | null> {
    cleanPath(path);
    return (
      (await this.tx(["info"], "readonly", (t) => req<FileInfo | undefined>(t.objectStore("info").get(path)))) ?? null
    );
  }

  async mkdir(path: string): Promise<void> {
    cleanPath(path);
    await this.change({ op: "mkdir", path }, (t) => makeParents(t, `${path}/`));
  }

  /** A file, or a folder with everything under it. */
  async rename(from: string, to: string): Promise<void> {
    cleanPath(from);
    cleanPath(to);
    if (to === from) return;
    if (to.startsWith(`${from}/`)) throw new Error(`cannot move ${from} into itself`);
    await this.change({ op: "rename", path: from, to }, async (t) => {
      const info = t.objectStore("info");
      const data = t.objectStore("data");
      const old: FileInfo | undefined = await req(info.get(from));
      if (!old) throw new Error(`no such file: ${from}`);
      const there: FileInfo | undefined = await req(info.get(to));
      if (there) throw new StoreConflict(`${to} already exists`, there);
      await makeParents(t, to);
      for (const i of [old, ...(old.dir ? await req<FileInfo[]>(info.getAll(under(from))) : [])]) {
        const dest = to + i.path.slice(from.length);
        info.delete(i.path);
        info.put({ ...i, path: dest });
        if (i.dir) continue;
        data.put(await req(data.get(i.path)), dest);
        data.delete(i.path);
      }
    });
  }

  /** A path that is not there is not an error. */
  async remove(path: string): Promise<void> {
    cleanPath(path);
    await this.change({ op: "remove", path }, (t) => {
      for (const s of ["info", "data"]) {
        t.objectStore(s).delete(path);
        t.objectStore(s).delete(under(path));
      }
    });
  }

  /** "Download all (.zip)": every file with its folders. A File, named with the date. */
  async zip(): Promise<File> {
    const [infos, keys, values] = await this.tx(["info", "data"], "readonly", (t) =>
      Promise.all([
        req(t.objectStore("info").getAll()),
        req(t.objectStore("data").getAllKeys()),
        req(t.objectStore("data").getAll()),
      ]),
    );
    const bytes = new Map(keys.map((k, i) => [k, new Uint8Array(values[i])]));
    const parts = zipParts(
      infos.map((i) => ({
        name: i.dir ? `${i.path}/` : i.path,
        mtime: i.mtime,
        data: bytes.get(i.path) ?? new Uint8Array(0),
      })),
    );
    const d = new Date();
    const two = (n: number) => String(n).padStart(2, "0");
    return new File(parts, `dofile-${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}.zip`, {
      type: "application/zip",
    });
  }

  // ---- the worker's side ----

  /** The worker's start: every record, and the journal emptied, in one transaction. */
  async takeAll(): Promise<StoreCopy> {
    return this.tx(ALL, "readwrite", async (t) => {
      const [infos, keys, values] = await Promise.all([
        req(t.objectStore("info").getAll()),
        req(t.objectStore("data").getAllKeys()),
        req(t.objectStore("data").getAll()),
      ]);
      t.objectStore("pending").clear();
      return { infos, data: keys.map((k, i): [IDBValidKey, ArrayBuffer] => [k, values[i]]) };
    });
  }

  /**
   * After a run: write what it did to /work, and give back the page's version of what the page changed meanwhile. With
   * no changes (the worker's `sync`) it is only the second part. One transaction, so a page change lands wholly before
   * it (its row is read here) or wholly after it (its row waits for the next one). The journal is emptied.
   *  - What the page changed (a `pending` row for a write, remove or rename: the path, anything under it, both names of
   *    a rename) keeps the page's version: the run's change to it is left out.
   *  - A folder the page made (a mkdir row) keeps only itself: the run's files under it are written.
   *  - Above something the page changed or made, the run can still make a folder, and its removal of a folder holds if
   *    nothing is left under it; a file the run put where the page has a folder is left out.
   * @param changes - what the run did to each path; status is "created", "modified" or "removed".
   * @returns `files`: what was written (files only). `skipped`: files the run created or changed that were left out
   * because they are under a folder the page renamed or removed (a file the page saved, removed or renamed itself is
   * not listed: the page's version wins). `resync`: what the worker must put into /work to have the page's version:
   * `paths` to replace with the records in `infos` and `data`, and `dirs` to make.
   */
  async applyRun(changes: RunChange[]): Promise<AppliedRun> {
    return this.tx(ALL, "readwrite", async (t) => {
      const info = t.objectStore("info");
      const data = t.objectStore("data");
      const pending = t.objectStore("pending");
      const rows: PendingRow[] = await req(pending.getAll());
      const deep: string[] = [];
      const made: string[] = [];
      const gone: string[] = []; // what the page renamed (the old name) or removed
      for (const r of rows) {
        if (r.op === "mkdir") made.push(r.path);
        else deep.push(r.path, ...(r.to ? [r.to] : []));
        if (r.op === "rename" || r.op === "remove") gone.push(r.path);
      }
      const pageHas = (p: string) => deep.some((h) => within(p, h));
      const above = (p: string) => made.includes(p) || [...deep, ...made].some((h) => h.startsWith(`${p}/`));
      const written: FileChange[] = [];
      const skipped: string[] = [];
      const emptied: string[] = [];
      const replace = [...deep];
      for (const c of changes) {
        if (pageHas(c.path)) {
          // listed only when lost with a folder the page renamed or removed
          if (!c.dir && c.status !== "removed" && gone.some((g) => c.path.startsWith(`${g}/`))) skipped.push(c.path);
          continue;
        }
        if (above(c.path)) {
          if (c.dir && c.status === "removed") emptied.push(c.path);
          else if (c.dir) {
            if (!(await req(info.get(c.path)))) info.put({ path: c.path, dir: true, size: 0, mtime: c.mtime });
          } else replace.push(c.path);
          continue;
        }
        if (c.status === "removed") {
          info.delete(c.path);
          data.delete(c.path);
        } else {
          info.put({ path: c.path, dir: c.dir, size: c.size, mtime: c.mtime });
          if (c.dir) data.delete(c.path);
          else data.put(exact(c.data!), c.path);
        }
        if (!c.dir) written.push({ name: c.path, status: c.status, bytes: c.status === "removed" ? 0 : c.size });
      }
      for (const p of emptied.sort((a, b) => b.length - a.length)) {
        // deepest first
        if ((await req(info.count(under(p)))) === 0) info.delete(p);
      }
      pending.clear();
      // the page's version of what it changed, as the store has it now
      const paths = [...new Set(replace)].filter((p, _, all) => !all.some((q) => q !== p && within(p, q)));
      const resync: AppliedRun["resync"] = { paths, infos: [], data: [], dirs: [] };
      for (const p of paths) {
        const [infos, files] = await tree(t, p);
        resync.infos.push(...infos);
        resync.data.push(...files);
      }
      for (const p of made) if ((await req(info.get(p)))?.dir) resync.dirs.push(p);
      return { files: written, skipped, resync };
    });
  }
}

// `indexedDB`: the tests pass their own factory.
export const openStore = ({ indexedDB = globalThis.indexedDB }: { indexedDB?: IDBFactory | null } = {}) =>
  new FileStore(indexedDB);
