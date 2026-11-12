// The user's files: dofile's own store in IndexedDB, one record per file or folder (docs/design/SPEC.md, section 7).
// The page works on it directly, with no engine, during a run and after a failed start. The worker (worker.ts) copies it
// into /work when it starts and writes back what each run changed.
//   info:    path -> { path, dir, size, mtime }    one record per file or folder
//   data:    path -> ArrayBuffer                    a file's bytes
//   pending: key  -> { op, path, to? }              the journal: a page change that /work has not taken yet
// The old Emscripten IDBFS database (named "/work") is another database: nothing here opens it.
//
// How the page's changes reach /work: one way, the journal. While a worker is live, a page change writes its records
// and a `pending` row in one transaction, then calls `sync` (the transport's), which posts the worker the op `sync`, with
// nothing in it. The worker then reads the journal in one transaction (applyRun with no changes): the store's version of
// every path in it, and the journal emptied. After a run, applyRun does the same in the transaction that writes the
// run's files. When it starts, the worker copies everything and empties the journal (takeAll). So /work takes the
// store's version of a path, whichever message or copy finds its row first; a sync that finds the journal empty does
// nothing, and the order in which the syncs arrive does not matter.

import type { FileChange, FileInfo, PendingRow } from "./types.ts";
import { zipParts } from "./zip.ts";

/** What a run did to one path in /work (worker.ts saveRun), for applyRun. `data`: a file's bytes, unless removed. */
export interface RunChange {
  path: string;
  dir: boolean;
  size: number;
  mtime: number;
  status: FileChange["status"];
  data?: Uint8Array;
}
/** What takeAll gives the worker: every record. */
export interface StoreCopy {
  infos: FileInfo[];
  data: [IDBValidKey, ArrayBuffer][];
}
/** What applyRun gives back (see there). */
export interface AppliedRun {
  files: FileChange[];
  skipped: string[];
  resync: { paths: string[]; infos: FileInfo[]; data: [string, ArrayBuffer][]; dirs: string[] };
}

export const DB_NAME = "dofile";
const HIDDEN = ".dofile"; // the engine's own folder: never listed, copied or zipped
const ALL = ["info", "data", "pending"];

// a path inside the working folder: relative, with "/", no "..", and not in the hidden folder
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
const under = (path: string) => IDBKeyRange.bound(`${path}/`, `${path}0`, false, true); // "0" is the character after "/"
const exact = (data: Uint8Array): ArrayBuffer =>
  data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
const within = (path: string, top: string) => path === top || path.startsWith(`${top}/`); // `path` is `top` or under it

function parents(path: string): string[] {
  const out: string[] = [];
  for (let i = path.indexOf("/"); i > 0; i = path.indexOf("/", i + 1)) out.push(path.slice(0, i));
  return out;
}

// the folders above `path`, made if missing
async function makeParents(t: IDBTransaction, path: string) {
  const info = t.objectStore("info");
  for (const p of parents(path)) {
    const old = await req(info.get(p));
    if (old && !old.dir) throw new Error(`${p} is a file, not a folder`);
    if (!old) info.put({ path: p, dir: true, size: 0, mtime: Date.now() });
  }
}

// `path` and everything under it: [info records, [path, bytes] of the files]
async function tree(t: IDBTransaction, path: string): Promise<[FileInfo[], [string, ArrayBuffer][]]> {
  const info = t.objectStore("info"),
    data = t.objectStore("data"),
    top = await req(info.get(path));
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

// `closed()` is called when the browser closes the database under us (another page upgrades or deletes it)
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

  // The engine client calls this when a worker starts, and with null when the worker is gone (or has no store of its own,
  // so it could never read the journal). While `sync` is null, a change writes no `pending` row: the next worker copies
  // the whole store. `onClosed`: called when the browser closes the database (another page deleted or upgraded it,
  // "Clear site data"): /work then holds files the store may no longer have, which the journal cannot say. After a
  // deleted database the new worker's mount copies the store as it is now; after an upgrade by another page this page
  // still opens version 1, which fails (VersionError): the new worker mounts with a store error and an empty /work, and
  // the store is detached from it.
  attach(sync: FileStore["sync"], { onClosed = null }: { onClosed?: null | (() => void) } = {}) {
    Object.assign(this, { sync, onClosed });
  }

  // One transaction. It rejects with the browser's error if it fails, and then nothing of it is kept. A database the
  // browser closed is opened again by the next call.
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

  // A change made by the page: the records and, when a worker is live, a `pending` row in one transaction; then `sync`
  // tells the worker, which takes the store's version of what the journal names and empties it.
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
    // reads `info` only
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

  async write(path: string, data: Uint8Array): Promise<FileInfo> {
    cleanPath(path);
    const bytes = exact(data); // only the view's bytes, not the whole buffer under it
    const info: FileInfo = { path, dir: false, size: bytes.byteLength, mtime: Date.now() };
    await this.change({ op: "write", path }, async (t) => {
      await makeParents(t, path);
      if ((await req(t.objectStore("info").get(path)))?.dir) throw new Error(`${path} is a folder`);
      t.objectStore("info").put(info);
      t.objectStore("data").put(bytes, path);
    });
    return info;
  }

  async mkdir(path: string): Promise<void> {
    cleanPath(path);
    await this.change({ op: "mkdir", path }, (t) => makeParents(t, `${path}/`));
  }

  // a file, or a folder with everything under it
  async rename(from: string, to: string): Promise<void> {
    cleanPath(from);
    cleanPath(to);
    if (to === from) return;
    if (to.startsWith(`${from}/`)) throw new Error(`cannot move ${from} into itself`);
    await this.change({ op: "rename", path: from, to }, async (t) => {
      const info = t.objectStore("info"),
        data = t.objectStore("data");
      const old: FileInfo | undefined = await req(info.get(from));
      if (!old) throw new Error(`no such file: ${from}`);
      if (await req(info.get(to))) throw new Error(`${to} already exists`);
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

  // the same; a path that is not there is not an error
  async remove(path: string): Promise<void> {
    cleanPath(path);
    await this.change({ op: "remove", path }, (t) => {
      for (const s of ["info", "data"]) {
        t.objectStore(s).delete(path);
        t.objectStore(s).delete(under(path));
      }
    });
  }

  // "Download all (.zip)": every file with its folders, made here with no engine. A File, named with the date.
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
    const d = new Date(),
      two = (n: number) => String(n).padStart(2, "0");
    return new File(parts, `dofile-${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}.zip`, {
      type: "application/zip",
    });
  }

  // ---- the worker's side ----

  // The engine's start: every record, and the journal emptied, in one transaction (the copy holds every change in it).
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

  // After a run: write what it did to /work, and give back the page's version of what the page changed meanwhile.
  // With no changes (the worker's `sync`) it is only the second part: the page's version of what the journal names.
  // `changes`: [{ path, dir, size, mtime, status, data? }], status "created", "modified" or "removed". One transaction,
  // so a page change lands wholly before it (its row is read here) or wholly after it (its row waits for the next one).
  //  - What the page changed (a `pending` row for a write, remove or rename: the path, anything under it, both names of
  //    a rename) keeps the page's version: the run's change to it is left out.
  //  - A folder the page made (a mkdir row) keeps only itself: the run's files under it are written.
  //  - Above something the page changed or made, the run can still make a folder, and its removal of a folder holds if
  //    nothing is left under it; a file the run put where the page has a folder is left out.
  // Returns { files: what was written, as RunResult.files (files only); skipped: the files the run created or changed
  // that were left out because they are under a folder the page renamed or removed (a file the page saved, removed or
  // renamed itself is not listed: the page's version wins); resync: what the worker must now put into /work to have the
  // page's version: `paths` to replace with the records in `infos` and `data`, and `dirs` to make }. The journal is
  // emptied.
  async applyRun(changes: RunChange[]): Promise<AppliedRun> {
    return this.tx(ALL, "readwrite", async (t) => {
      const info = t.objectStore("info"),
        data = t.objectStore("data"),
        pending = t.objectStore("pending");
      const rows: PendingRow[] = await req(pending.getAll());
      const deep: string[] = [],
        made: string[] = [],
        gone: string[] = []; // gone: what the page renamed (the old name) or removed
      for (const r of rows) {
        if (r.op === "mkdir") made.push(r.path);
        else deep.push(r.path, ...(r.to ? [r.to] : []));
        if (r.op === "rename" || r.op === "remove") gone.push(r.path);
      }
      const pageHas = (p: string) => deep.some((h) => within(p, h));
      const above = (p: string) => made.includes(p) || [...deep, ...made].some((h) => h.startsWith(`${p}/`));
      const written: FileChange[] = [],
        skipped: string[] = [],
        emptied: string[] = [],
        replace = [...deep];
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
        // the deepest first
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

// indexedDB: the factory to use (the tests pass their own); by default the browser's
export const openStore = ({ indexedDB = globalThis.indexedDB }: { indexedDB?: IDBFactory | null } = {}) =>
  new FileStore(indexedDB);
