// The user's files: dofile's own store in IndexedDB, one record per file or folder (docs/design/SPEC.md, section 7).
// The page works on it directly, with no engine, during a run and after a failed start. The worker (worker.js) copies it
// into /work when it starts and writes back what each run changed.
//   info:    path -> { path, dir, size, mtime }    one record per file or folder
//   data:    path -> ArrayBuffer                    a file's bytes
//   pending: seq  -> { op, path, to? }              a page change the worker has not put into /work yet
// The old Emscripten IDBFS database (named "/work") is another database: nothing here opens it.
//
// How the page's changes reach /work. The page writes the store first (the records and a `pending` row, one
// transaction), then posts the op with the row's seq, and the worker applies it to /work and deletes the row. The worker
// also copies from the store: everything when it starts (takeAll), and after a run the paths the page changed meanwhile
// (applyRun). Each copy reads the highest seq in `pending` in the same transaction (`upTo`) and empties the journal:
// the copy already holds every change up to that seq, so the worker ignores the ops with a seq up to it.
import { zipParts } from "./zip.js";

export const DB_NAME = "dofile";
const HIDDEN = ".dofile";   // the engine's own folder: never listed, copied or zipped
const ALL = ["info", "data", "pending"];

// a path inside the working folder: relative, with "/", no "..", and not in the hidden folder
export function cleanPath(path) {
  const parts = typeof path === "string" ? path.split("/") : [""];
  if (parts[0] === HIDDEN || parts.some(p => p === "" || p === "." || p === "..")) throw new Error(`not in the working folder: ${path}`);
  return path;
}

const req = r => new Promise((ok, err) => { r.onsuccess = () => ok(r.result); r.onerror = () => err(r.error); });
const under = path => IDBKeyRange.bound(`${path}/`, `${path}0`, false, true);   // "0" is the character after "/"
const exact = data => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
const within = (path, top) => path === top || path.startsWith(`${top}/`);   // `path` is `top` or under it

function parents(path) {
  const out = [];
  for (let i = path.indexOf("/"); i > 0; i = path.indexOf("/", i + 1)) out.push(path.slice(0, i));
  return out;
}

// the folders above `path`, made if missing
async function makeParents(t, path) {
  const info = t.objectStore("info");
  for (const p of parents(path)) {
    const old = await req(info.get(p));
    if (old && !old.dir) throw new Error(`${p} is a file, not a folder`);
    if (!old) info.put({ path: p, dir: true, size: 0, mtime: Date.now() });
  }
}

// `path` and everything under it: [info records, [path, bytes] of the files]
async function tree(t, path) {
  const info = t.objectStore("info"), data = t.objectStore("data"), top = await req(info.get(path));
  const infos = [...(top ? [top] : []), ...await req(info.getAll(under(path)))];
  return [infos, await Promise.all(infos.filter(i => !i.dir).map(async i => [i.path, await req(data.get(i.path))]))];
}

// `closed()` is called when the browser closes the database under us (another page upgrades or deletes it)
function open(factory, closed) {
  return new Promise((ok, err) => {
    if (!factory) return err(new Error("this browser has no storage for files (IndexedDB)"));
    const r = factory.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("info", { keyPath: "path" });
      r.result.createObjectStore("data");
      r.result.createObjectStore("pending", { autoIncrement: true });
    };
    r.onsuccess = () => {
      r.result.onversionchange = () => { r.result.close(); closed(); };
      r.result.onclose = closed;
      ok(r.result);
    };
    r.onerror = () => err(r.error);
    r.onblocked = () => err(new Error("the file storage is in use by an older page; close the other dofile tabs"));
  });
}

export class FileStore {
  constructor(factory) {
    this.factory = factory;
    /** @type {any} */
    this.opened = undefined;   // the open database, once asked for
    /** @type {null | ((op: string, args: object, transfer: Transferable[]) => void)} */
    this.post = null;      // sends the op to the worker; null while there is no worker
    this.blocked = false;  // true in a tab that does not own the files (the tab lock): it writes nothing
    this.onChange = () => {};   // called after every change this page made
    this.onClosed = null;   // the engine client's: called when the browser closed the database under us
    this.journal = true;    // false: the worker has no store of its own, so it would never delete a `pending` row
  }

  // The engine client calls this when a worker starts (and with null when it is gone for good). `onClosed`: called when
  // the browser closes the database (another page deleted or upgraded it, "Clear site data"): the seqs may start again
  // from 1, so the worker must copy the store afresh. `journal`: as above.
  attach(post, { onClosed = null, journal = true } = {}) { Object.assign(this, { post, onClosed, journal }); }

  // One transaction. It rejects with the browser's error if it fails, and then nothing of it is kept. A database the
  // browser closed is opened again by the next call.
  async tx(stores, mode, fn) {
    const mine = this.opened ??= open(this.factory, () => {
      if (this.opened !== mine) return;
      this.opened = undefined;
      try { this.onClosed?.(); } catch (e) { console.warn(e); }
    })
      .catch(e => { this.opened = undefined; throw e; });
    const t = (await mine).transaction(stores, mode);
    const done = new Promise((ok, err) => { t.oncomplete = () => ok(); t.onabort = () => err(t.error ?? new Error("the transaction was aborted")); });
    done.catch(() => {});
    try {
      const out = await fn(t);
      await done;
      return out;
    } catch (e) {
      try { t.abort(); } catch { /* already aborted */ }
      // a request that was waiting when the transaction aborted only says "aborted": the transaction's error says why
      throw e?.name === "AbortError" && t.error ? t.error : e;
    }
  }

  // A change made by the page: the records and, when a worker exists, a `pending` row in one transaction; then the op
  // goes to the worker with the row's seq, and the worker deletes the row once /work has the change.
  async change(op, args, fn, transfer = []) {
    if (this.blocked) throw new Error("dofile is open in another tab");
    const post = this.post, journal = post && this.journal;
    let seq;
    const out = await this.tx(ALL, "readwrite", async t => {
      const out = await fn(t);
      if (journal) seq = await req(t.objectStore("pending").add({ op, path: args.path ?? args.from, ...(args.to ? { to: args.to } : {}) }));
      return out;
    });
    if (post) post(op, { ...args, seq }, transfer);
    try { this.onChange?.(); } catch (e) { console.warn(e); }   // the change is made: a listener that throws does not undo it
    return out;
  }

  // ---- the page's API ----

  /** @returns {Promise<{ path: string, dir: boolean, size: number, mtime: number }[]>} */
  async list() {   // reads `info` only
    return this.tx(["info"], "readonly", t => req(t.objectStore("info").getAll()));
  }

  /** @returns {Promise<Uint8Array<ArrayBuffer>>} */
  async read(path) {
    cleanPath(path);
    const bytes = await this.tx(["data"], "readonly", t => req(t.objectStore("data").get(path)));
    if (!bytes) throw new Error(`no such file: ${path}`);
    return new Uint8Array(bytes);
  }

  async write(path, data) {
    cleanPath(path);
    const bytes = exact(data);   // our own copy: the caller keeps its array, and this one can be moved to the worker
    const info = { path, dir: false, size: bytes.byteLength, mtime: Date.now() };
    await this.change("write", { path, data: new Uint8Array(bytes) }, async t => {
      await makeParents(t, path);
      if ((await req(t.objectStore("info").get(path)))?.dir) throw new Error(`${path} is a folder`);
      t.objectStore("info").put(info);
      t.objectStore("data").put(bytes, path);
    }, [bytes]);
    return info;
  }

  async mkdir(path) {
    cleanPath(path);
    await this.change("mkdir", { path }, t => makeParents(t, `${path}/`));
  }

  // a file, or a folder with everything under it
  async rename(from, to) {
    cleanPath(from);
    cleanPath(to);
    if (to === from) return;
    if (to.startsWith(`${from}/`)) throw new Error(`cannot move ${from} into itself`);
    await this.change("rename", { from, to }, async t => {
      const info = t.objectStore("info"), data = t.objectStore("data");
      const old = await req(info.get(from));
      if (!old) throw new Error(`no such file: ${from}`);
      if (await req(info.get(to))) throw new Error(`${to} already exists`);
      await makeParents(t, to);
      for (const i of [old, ...(old.dir ? await req(info.getAll(under(from))) : [])]) {
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
  async remove(path) {
    cleanPath(path);
    await this.change("remove", { path }, t => {
      for (const s of ["info", "data"]) { t.objectStore(s).delete(path); t.objectStore(s).delete(under(path)); }
    });
  }

  // "Download all (.zip)": every file with its folders, made here with no engine. A File, named with the date.
  async zip() {
    const [infos, keys, values] = await this.tx(["info", "data"], "readonly", t => Promise.all([
      req(t.objectStore("info").getAll()), req(t.objectStore("data").getAllKeys()), req(t.objectStore("data").getAll())]));
    const bytes = new Map(keys.map((k, i) => [k, new Uint8Array(values[i])]));
    const parts = zipParts(infos.map(i => ({ name: i.dir ? `${i.path}/` : i.path, mtime: i.mtime, data: bytes.get(i.path) ?? new Uint8Array(0) })));
    const d = new Date(), two = n => String(n).padStart(2, "0");
    return new File(parts, `dofile-${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}.zip`, { type: "application/zip" });
  }

  // ---- the worker's side ----

  // The engine's start: every record, the highest seq in `pending` (upTo: every page change up to it is in this copy), and
  // the journal emptied, in one transaction.
  async takeAll() {
    return this.tx(ALL, "readwrite", async t => {
      const [infos, keys, values, seqs] = await Promise.all([
        req(t.objectStore("info").getAll()), req(t.objectStore("data").getAllKeys()), req(t.objectStore("data").getAll()),
        req(t.objectStore("pending").getAllKeys())]);
      t.objectStore("pending").clear();
      return { infos, data: keys.map((k, i) => [k, values[i]]), upTo: seqs.at(-1) ?? 0 };
    });
  }

  // a page change is in /work now
  async done(seq) {
    await this.tx(["pending"], "readwrite", t => { t.objectStore("pending").delete(seq); });
  }

  // After a run: write what it did to /work, and give back the page's version of what the page changed meanwhile.
  // `changes`: [{ path, dir, size, mtime, status, data? }], status "created", "modified" or "removed". One transaction,
  // so a page change lands wholly before it or wholly after it.
  //  - What the page changed (a `pending` row for a write, remove or rename: the path, anything under it, both names of
  //    a rename) keeps the page's version: the run's change to it is left out.
  //  - A folder the page made (a mkdir row) keeps only itself: the run's files under it are written.
  //  - Above something the page changed or made, the run can still make a folder, and its removal of a folder holds if
  //    nothing is left under it; a file the run put where the page has a folder is left out.
  // Returns { files: what was written, as RunResult.files (files only); skipped: the files the run created or changed
  // that were left out because they are under a folder the page renamed or removed (a file the page saved, removed or
  // renamed itself is not listed: the page's version wins, nothing is lost); upTo: the highest seq in `pending`, which is emptied; resync: what the worker must now
  // put into /work to have the page's version: `paths` to replace with the records in `infos` and `data`, and `dirs`
  // to make }. With no changes it is only the copy: the worker calls it so when an op of the page failed in /work.
  async applyRun(changes) {
    return this.tx(ALL, "readwrite", async t => {
      const info = t.objectStore("info"), data = t.objectStore("data"), pending = t.objectStore("pending");
      const [seqs, rows] = await Promise.all([req(pending.getAllKeys()), req(pending.getAll())]);
      const deep = [], made = [], gone = [];   // gone: what the page renamed (the old name) or removed
      for (const r of rows) {
        if (r.op === "mkdir") made.push(r.path); else deep.push(r.path, ...(r.to ? [r.to] : []));
        if (r.op === "rename" || r.op === "remove") gone.push(r.path);
      }
      const pageHas = p => deep.some(h => within(p, h));
      const above = p => made.includes(p) || [...deep, ...made].some(h => h.startsWith(`${p}/`));
      const written = [], skipped = [], emptied = [], replace = [...deep];
      for (const c of changes) {
        if (pageHas(c.path)) {   // listed only when lost with a folder the page renamed or removed
          if (!c.dir && c.status !== "removed" && gone.some(g => c.path.startsWith(`${g}/`))) skipped.push(c.path);
          continue;
        }
        if (above(c.path)) {
          if (c.dir && c.status === "removed") emptied.push(c.path);
          else if (c.dir) { if (!await req(info.get(c.path))) info.put({ path: c.path, dir: true, size: 0, mtime: c.mtime }); }
          else replace.push(c.path);
          continue;
        }
        if (c.status === "removed") {
          info.delete(c.path);
          data.delete(c.path);
        } else {
          info.put({ path: c.path, dir: c.dir, size: c.size, mtime: c.mtime });
          if (c.dir) data.delete(c.path); else data.put(exact(c.data), c.path);
        }
        if (!c.dir) written.push({ name: c.path, status: c.status, bytes: c.status === "removed" ? 0 : c.size });
      }
      for (const p of emptied.sort((a, b) => b.length - a.length)) {   // the deepest first
        if (await req(info.count(under(p))) === 0) info.delete(p);
      }
      pending.clear();
      // the page's version of what it changed, as the store has it now
      const paths = [...new Set(replace)].filter((p, _, all) => !all.some(q => q !== p && within(p, q)));
      const resync = { paths, infos: [], data: [], dirs: [] };
      for (const p of paths) {
        const [infos, files] = await tree(t, p);
        resync.infos.push(...infos);
        resync.data.push(...files);
      }
      for (const p of made) if ((await req(info.get(p)))?.dir) resync.dirs.push(p);
      return { files: written, skipped, upTo: seqs.at(-1) ?? 0, resync };
    });
  }
}

// indexedDB: the factory to use (the tests pass their own); by default the browser's
export const openStore = ({ indexedDB = globalThis.indexedDB } = {}) => new FileStore(indexedDB);
