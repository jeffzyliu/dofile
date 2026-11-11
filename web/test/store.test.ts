// The file store (src/engine/store.js) by itself, with no engine and no worker: its API, the pending journal, the zip,
// a failing transaction; and the tab lock and storage.persist() (src/engine/tab.js). The store with a running engine is
// in files.test.mjs. SPEC.md section 7, tests 1, 2, 8, 12 and 13.
import { test } from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { loadPyodide } from "pyodide";
import { openStore } from "../src/engine/store.ts";
import type { FileStore, RunChange } from "../src/engine/store.ts";
import type { PendingRow } from "../src/engine/types.ts";
import { crc32 } from "../src/engine/zip.ts";
import { keepFiles, tabLock } from "../src/engine/tab.ts";
import { abortWrites, bytes, pendingRows, refuseWrites, text } from "./harness.ts";

const fresh = () => openStore({ indexedDB: new IDBFactory() });   // a new, empty database
const paths = async (store: FileStore) => (await store.list()).map(f => f.path);

test("store API: write, list, read, mkdir, rename and remove of a file and of a folder", async () => {
  const store = fresh();
  assert.deepEqual(await store.list(), []);
  const info = await store.write("data/raw/cps.csv", bytes("a,b\n1,2\n"));
  assert.deepEqual({ ...info, mtime: 0 }, { path: "data/raw/cps.csv", dir: false, size: 8, mtime: 0 });
  assert.ok(Math.abs(info.mtime - Date.now()) < 5000);
  await store.write("main.do", bytes("display 1"));
  await store.mkdir("out/tables");
  assert.deepEqual((await store.list()).map(f => [f.path, f.dir, f.size]), [
    ["data", true, 0], ["data/raw", true, 0], ["data/raw/cps.csv", false, 8], ["main.do", false, 9], ["out", true, 0], ["out/tables", true, 0]]);
  assert.equal(text(await store.read("data/raw/cps.csv")), "a,b\n1,2\n");

  // a write gets its own copy: the caller's array is still usable, and changing it does not change the file
  const mine = bytes("abc");
  await store.write("copy.txt", mine);
  mine[0] = 120;
  assert.equal(text(await store.read("copy.txt")), "abc");
  // a view into a bigger buffer stores the view only
  await store.write("view.txt", new Uint8Array(bytes("0123456789").buffer, 2, 3));
  assert.equal(text(await store.read("view.txt")), "234");
  await store.remove("copy.txt");
  await store.remove("view.txt");

  // a file: renamed, into a folder that is made for it
  await store.rename("main.do", "code/analysis.do");
  assert.equal(text(await store.read("code/analysis.do")), "display 1");
  await assert.rejects(store.read("main.do"), /no such file: main\.do/);
  // a folder, with everything under it
  await store.rename("data", "input");
  assert.deepEqual(await paths(store), ["code", "code/analysis.do", "input", "input/raw", "input/raw/cps.csv", "out", "out/tables"]);
  assert.equal(text(await store.read("input/raw/cps.csv")), "a,b\n1,2\n");
  // not onto something that is there, not into itself, not something that is not there
  await assert.rejects(store.rename("code/analysis.do", "input/raw/cps.csv"), /already exists/);
  await assert.rejects(store.rename("input", "input/raw/deeper"), /into itself/);
  await assert.rejects(store.rename("nothing.do", "x.do"), /no such file/);
  assert.equal(text(await store.read("code/analysis.do")), "display 1", "a refused rename changed nothing");

  // remove: a file, a folder with everything under it, and a path that is not there
  await store.remove("code/analysis.do");
  await store.remove("input");
  await store.remove("never-there");
  assert.deepEqual(await paths(store), ["code", "out", "out/tables"]);

  // a file is not a folder and a folder is not a file
  await store.write("plain", bytes("x"));
  await assert.rejects(store.write("plain/under.txt", bytes("y")), /plain is a file/);
  await assert.rejects(store.write("out", bytes("y")), /out is a folder/);
  // a name that only starts like another is not under it
  await store.write("out.txt", bytes("z"));
  await store.remove("out");
  assert.deepEqual(await paths(store), ["code", "out.txt", "plain"]);
});

test("a path that leaves the folder, or names the hidden one, is refused by every call", async () => {
  const store = fresh();
  for (const bad of ["../etc/passwd", "/abs.do", "a/../../b", "a//b", "a/./b", "", "dir/", ".dofile/log.txt", ".dofile", undefined]) {
    await assert.rejects(store.write(bad as string, bytes("x")), /not in the working folder/, `write ${bad}`);
    await assert.rejects(store.read(bad as string), /not in the working folder/, `read ${bad}`);
    await assert.rejects(store.mkdir(bad as string), /not in the working folder/, `mkdir ${bad}`);
    await assert.rejects(store.remove(bad as string), /not in the working folder/, `remove ${bad}`);
    await assert.rejects(store.rename(bad as string, "ok.do"), /not in the working folder/, `rename from ${bad}`);
    await assert.rejects(store.rename("ok.do", bad as string), /not in the working folder/, `rename to ${bad}`);
  }
  assert.deepEqual(await store.list(), []);
  await store.write("a..b/.hidden/..c", bytes("x"));   // dots inside a name are only a name
  assert.equal((await store.list()).length, 3);
});

test("list reads the info records only, never a file's bytes", async () => {
  const store = fresh();
  await store.write("big.dta", new Uint8Array(1 << 20));
  const opened: string[][] = [], tx = store.tx.bind(store);
  store.tx = (stores, ...rest) => { opened.push(stores); return tx(stores, ...rest); };
  assert.equal((await store.list())[0].size, 1 << 20);
  assert.deepEqual(opened, [["info"]]);
});

test("with no worker nothing is journalled; with one, each change adds a pending row and then posts the op with its seq", async () => {
  const store = fresh();
  await store.write("a.do", bytes("1"));
  await store.mkdir("d");
  await store.rename("a.do", "d/b.do");
  await store.remove("d");
  assert.deepEqual(await pendingRows(store), [], "no worker: no rows");

  const posted: { op: string, args: Parameters<NonNullable<FileStore["post"]>>[1], transfer: Transferable[] }[] = [];
  let rowsAtPost: Promise<PendingRow[]> | undefined;
  store.attach((op, args, transfer) => { posted.push({ op, args, transfer }); rowsAtPost ??= pendingRows(store); });
  let changes = 0;
  store.onChange = () => { changes++; };
  await store.write("a.do", bytes("12"));
  assert.equal((await rowsAtPost)!.length, 1, "the row is in the store before the op is posted");
  await store.mkdir("d/e");
  await store.rename("a.do", "d/b.do");
  await store.remove("d/e");
  assert.deepEqual(await pendingRows(store), [
    { op: "write", path: "a.do" }, { op: "mkdir", path: "d/e" }, { op: "rename", path: "a.do", to: "d/b.do" }, { op: "remove", path: "d/e" }]);
  assert.deepEqual(posted.map(p => [p.op, p.args.seq]), [["write", 1], ["mkdir", 2], ["rename", 3], ["remove", 4]]);
  assert.equal(text(posted[0].args.data!), "12");
  assert.deepEqual(posted[0].transfer, [posted[0].args.data!.buffer], "the bytes are moved to the worker, not copied");
  assert.deepEqual([posted[2].args.from, posted[2].args.to], ["a.do", "d/b.do"]);
  assert.equal(changes, 4);

  // the worker's side: done(seq) drops one row; takeAll gives every record, the highest seq it covers, and empties the journal
  await store.done(2);
  assert.deepEqual((await pendingRows(store)).map(r => r.op), ["write", "rename", "remove"]);
  const all = await store.takeAll();
  assert.deepEqual(all.infos.map(i => i.path), ["d", "d/b.do"]);
  assert.deepEqual(all.data.map(([path, data]) => [path, text(new Uint8Array(data))]), [["d/b.do", "12"]]);
  assert.equal(all.upTo, 4, "the copy holds every change up to the newest row");
  assert.deepEqual(await pendingRows(store), []);
  assert.equal((await store.takeAll()).upTo, 0, "an empty journal covers no op");
  await store.mkdir("later");
  assert.equal(posted.at(-1)!.args.seq, 5, "the seq goes on counting after the journal was emptied");
  await store.done(5);

  // a refused change posts nothing and journals nothing
  await assert.rejects(store.rename("nothing", "x"), /no such file/);
  assert.equal(posted.length, 5);
  assert.deepEqual(await pendingRows(store), []);

  // a listener that throws does not undo a change that was made
  store.onChange = () => { throw new Error("a bug in the page"); };
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal((await store.write("still.do", bytes("x"))).size, 1);
  } finally {
    console.warn = warn;
  }
  assert.equal(text(await store.read("still.do")), "x");
  store.onChange = () => {};
  await store.remove("still.do");
  await store.remove("later");

  // a tab that does not own the files writes nothing
  store.blocked = true;
  await assert.rejects(store.write("b.do", bytes("x")), /open in another tab/);
  await assert.rejects(store.remove("d"), /open in another tab/);
  assert.deepEqual(await paths(store), ["d", "d/b.do"]);
});

const change = (path: string, status: RunChange["status"], dir = false): RunChange => ({ path, dir, size: 3, mtime: 5, status, data: dir || status === "removed" ? undefined : bytes("run") });
const names = (records: ({ path: string } | [string, ArrayBuffer])[]) => records.map(r => (Array.isArray(r) ? `${r[0]}=${text(new Uint8Array(r[1]))}` : r.path));

test("the after-run write: the page's version of what it changed stays, is given back for /work, and the journal is emptied", async () => {
  const store = fresh();
  for (const p of ["same.txt", "dir/in.txt", "old.txt", "free.txt", "deep/er/x.txt"]) await store.write(p, bytes("page"));
  store.attach(() => {});
  await store.write("same.txt", bytes("page 2"));        // pending 1: same.txt
  await store.remove("dir");                             // pending 2: dir (and so dir/in.txt, dir/new.txt)
  await store.rename("old.txt", "new.txt");              // pending 3: old.txt and new.txt
  await store.write("deep/er/y.txt", bytes("page"));     // pending 4: deep/er/y.txt (deep and deep/er are above it)
  const { files, skipped, upTo, resync } = await store.applyRun([
    change("same.txt", "modified"), change("dir/in.txt", "modified"), change("dir/new.txt", "created"), change("old.txt", "modified"),
    change("new.txt", "created"), change("deep", "removed", true), change("deep/er", "removed", true), change("deep/er/x.txt", "removed"),
    change("free.txt", "modified"), change("made", "created", true), change("made/out.txt", "created")]);
  assert.deepEqual(files, [{ name: "deep/er/x.txt", status: "removed", bytes: 0 }, { name: "free.txt", status: "modified", bytes: 3 }, { name: "made/out.txt", status: "created", bytes: 3 }]);
  // only the run's files lost under a folder the page removed; the page's own file (same.txt, a rename's names) wins
  assert.deepEqual(skipped, ["dir/in.txt", "dir/new.txt"], "the run's files dropped with a folder the page removed");
  assert.equal(upTo, 4);
  assert.deepEqual(await pendingRows(store), [], "the copy covers the four changes: their rows are gone");
  // the folders the run removed stay, since the page put a file under them
  assert.deepEqual(await paths(store), ["deep", "deep/er", "deep/er/y.txt", "free.txt", "made", "made/out.txt", "new.txt", "same.txt"]);
  assert.equal(text(await store.read("same.txt")), "page 2");
  assert.equal(text(await store.read("new.txt")), "page");
  assert.equal(text(await store.read("free.txt")), "run");
  assert.deepEqual((await store.list()).find(f => f.path === "free.txt"), { path: "free.txt", dir: false, size: 3, mtime: 5 });
  // what /work must take: every path the page changed, with the store's records for it (none for what the page removed)
  assert.deepEqual(resync.paths, ["same.txt", "dir", "old.txt", "new.txt", "deep/er/y.txt"]);
  assert.deepEqual(names(resync.infos), ["same.txt", "new.txt", "deep/er/y.txt"]);
  assert.deepEqual(names(resync.data), ["same.txt=page 2", "new.txt=page", "deep/er/y.txt=page"]);
  assert.deepEqual(resync.dirs, []);
});

test("the after-run write: a folder the page made covers only itself; a chain of renames gives the final names; an emptied folder goes", async () => {
  const store = fresh();
  for (const p of ["f.txt", "d/x.txt", "d/y.txt", "folder/a.txt", "q"]) await store.write(p, bytes("page"));
  store.attach(() => {});
  await store.mkdir("out");                    // the run makes the same folder and writes into it
  await store.rename("f.txt", "t.txt");
  await store.rename("t.txt", "u.txt");        // f -> t -> u
  await store.remove("d/x.txt");               // the run removes all of d
  await store.rename("folder", "moved");
  await store.rename("moved", "moved2");       // a folder renamed twice
  await store.write("q", bytes("page q"));     // the run puts a folder where the page has this file
  await store.write("file/under.txt", bytes("page"));   // the run puts a file where the page has this folder
  const { files, skipped, upTo, resync } = await store.applyRun([
    change("out", "created", true), change("out/t.txt", "created"), change("f.txt", "modified"),
    change("d", "removed", true), change("d/x.txt", "removed"), change("d/y.txt", "removed"),
    change("folder/a.txt", "modified"), change("folder/new.txt", "created"),
    change("q", "modified", true), change("q/inner.txt", "created"), change("file", "created")]);
  assert.deepEqual(files, [{ name: "out/t.txt", status: "created", bytes: 3 }, { name: "d/y.txt", status: "removed", bytes: 0 }]);
  // under a folder the page renamed: listed. f.txt (the page renamed that file), q/inner.txt (under a file the page wrote)
  // and `file` (where the page has a folder) are dropped and not listed
  assert.deepEqual(skipped, ["folder/a.txt", "folder/new.txt"]);
  assert.equal(upTo, 8);
  assert.deepEqual(await paths(store), ["file", "file/under.txt", "moved2", "moved2/a.txt", "out", "out/t.txt", "q", "u.txt"]);
  assert.equal(text(await store.read("out/t.txt")), "run", "the run's file under the folder the page made is saved");
  assert.equal(text(await store.read("u.txt")), "page");
  assert.equal(text(await store.read("q")), "page q");
  assert.deepEqual(resync.paths, ["f.txt", "t.txt", "u.txt", "d/x.txt", "folder", "moved", "moved2", "q", "file"]);
  assert.deepEqual(names(resync.data), ["u.txt=page", "moved2/a.txt=page", "q=page q", "file/under.txt=page"]);
  assert.deepEqual(resync.dirs, ["out"]);
  // with no changes it is only the copy: nothing pending, nothing to take
  assert.deepEqual(await store.applyRun([]), { files: [], skipped: [], upTo: 0, resync: { paths: [], infos: [], data: [], dirs: [] } });
});

test("a transaction that aborts after its requests were taken rejects the write with its error and keeps the old record", async t => {
  const store = fresh();
  await store.write("keep.do", bytes("old text"));
  const posted: string[] = [];
  store.attach(op => posted.push(op));
  const undo = abortWrites(t);
  await assert.rejects(store.write("keep.do", bytes("new text, longer")), { name: "ConstraintError" });
  await assert.rejects(store.write("new/deep/file.do", bytes("x")), { name: "ConstraintError" });
  await assert.rejects(store.rename("keep.do", "moved.do"), { name: "ConstraintError" });
  await assert.rejects(store.applyRun([{ path: "run.txt", dir: false, size: 1, mtime: 1, status: "created", data: bytes("r") }]), { name: "ConstraintError" });
  undo();
  assert.equal(text(await store.read("keep.do")), "old text");
  assert.deepEqual((await store.list()).map(f => [f.path, f.size]), [["keep.do", 8]]);
  assert.deepEqual(await pendingRows(store), []);
  assert.deepEqual(posted, []);
});

test("a database the browser closed under the store is opened again by the next call", async () => {
  const factory = new IDBFactory(), store = openStore({ indexedDB: factory });
  await store.write("a.do", bytes("x"));
  // another page deletes (or upgrades) the database: this one gets "versionchange" and must close
  await new Promise((ok, err) => { const r = factory.deleteDatabase("dofile"); r.onsuccess = ok; r.onerror = () => err(r.error); });
  assert.deepEqual(await store.list(), [], "no InvalidStateError: a new connection, to the database as it is now");
  await store.write("b.do", bytes("y"));
  assert.equal(text(await store.read("b.do")), "y");
});

test("a failing transaction rejects the page's write with the browser's error and keeps the old record", async t => {
  const store = fresh();
  await store.write("keep.do", bytes("old text"));
  const posted: string[] = [];
  store.attach(op => posted.push(op));
  const undo = refuseWrites(t);
  await assert.rejects(store.write("keep.do", bytes("new text, longer")), { name: "QuotaExceededError" });
  await assert.rejects(store.write("new/deep/file.do", bytes("x")), { name: "QuotaExceededError" });
  await assert.rejects(store.applyRun([{ path: "run.txt", dir: false, size: 1, mtime: 1, status: "created", data: bytes("r") }]), { name: "QuotaExceededError" });
  undo();
  assert.equal(text(await store.read("keep.do")), "old text");
  assert.deepEqual((await store.list()).map(f => [f.path, f.size]), [["keep.do", 8]], "no half-made folders, no size of the refused write");
  assert.deepEqual(await pendingRows(store), [], "no row for a change that was not made");
  assert.deepEqual(posted, [], "and no op to the worker");
  await store.write("keep.do", bytes("new"));   // the store still works
  assert.equal(text(await store.read("keep.do")), "new");
});

test("a database that cannot be opened rejects every call with the reason", async () => {
  const refusing = { open() { const r: { error?: DOMException, onerror?: () => void } = {}; queueMicrotask(() => { r.error = new DOMException("storage is not allowed", "SecurityError"); r.onerror!(); }); return r; } };
  const store = openStore({ indexedDB: refusing as unknown as IDBFactory });
  await assert.rejects(store.list(), { name: "SecurityError" });
  await assert.rejects(store.write("a.do", bytes("x")), { name: "SecurityError" });
  await assert.rejects(openStore({ indexedDB: null }).list(), /no storage for files/);
});

test("zip: every file with its folders, no engine, named with the date, and a real unzip reads it", { timeout: 60_000 }, async () => {
  const store = fresh();
  const big = new Uint8Array(300_000).map((_, i) => (i * 31) % 251);
  await store.write("analysis.do", bytes("display 1\n"));
  await store.write("data/wages.dta", big);
  await store.write("data/raw/naïve données.csv", bytes("é,ü\n"));
  await store.write("empty.txt", new Uint8Array(0));
  await store.mkdir("out/empty-folder");
  assert.equal(store.post, null, "no worker was ever attached");
  const zip = await store.zip();
  const d = new Date(), two = (n: number) => String(n).padStart(2, "0");
  assert.equal(zip.name, `dofile-${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}.zip`);
  assert.equal(zip.type, "application/zip");
  assert.ok(zip instanceof Blob);

  // read it back with Python's zipfile (here only as the checker: the zip above was made without it)
  const py = await loadPyodide();
  py.FS.writeFile("/tmp/all.zip", new Uint8Array(await zip.arrayBuffer()));
  const read = JSON.parse(py.runPython(`
import json, zipfile, zlib
z = zipfile.ZipFile("/tmp/all.zip")
json.dumps({"bad": z.testzip(), "names": z.namelist(), "dirs": [i.filename for i in z.infolist() if i.is_dir()],
            "sizes": {i.filename: i.file_size for i in z.infolist()}, "crc": {i.filename: i.CRC for i in z.infolist()},
            "text": z.read("data/raw/naïve données.csv").decode(), "year": z.getinfo("analysis.do").date_time[0],
            "big": zlib.crc32(z.read("data/wages.dta"))})`));
  assert.equal(read.bad, null, "every entry's CRC is right");
  assert.deepEqual(read.names, ["analysis.do", "data/", "data/raw/", "data/raw/naïve données.csv", "data/wages.dta", "empty.txt", "out/", "out/empty-folder/"]);
  assert.deepEqual(read.dirs, ["data/", "data/raw/", "out/", "out/empty-folder/"]);
  assert.equal(read.sizes["data/wages.dta"], 300_000);
  assert.equal(read.sizes["empty.txt"], 0);
  assert.equal(read.text, "é,ü\n");
  assert.equal(read.year, d.getFullYear());
  assert.equal(read.big, crc32(big));
  assert.ok(!read.names.some((n: string) => n.startsWith(".dofile")));
});

test("storage.persist() is asked once, and what persisted() says comes back: false, true, or null with no such API", async () => {
  const storage = (answer: boolean) => ({ asks: 0, async persist() { this.asks++; return answer; }, async persisted() { return answer; } });
  const no = storage(false), yes = storage(true), heard: (boolean | null)[] = [];
  assert.equal(await keepFiles(no, kept => heard.push(kept)), false);
  assert.equal(await keepFiles(no), false);
  assert.equal(await keepFiles(no), false);
  assert.equal(no.asks, 1, "asked once");
  await new Promise(setImmediate);
  assert.deepEqual(heard, [false, false], "a false answer reaches the page: before the browser was asked, and after");
  assert.equal(await keepFiles(yes), true);
  assert.equal(yes.asks, 1);
  const throwing = { async persist() { throw new Error("not allowed"); }, async persisted() { return false; } };
  assert.equal(await keepFiles(throwing), false);
  const broken = { async persist() { return true; }, async persisted(): Promise<boolean> { throw new DOMException("no", "SecurityError"); } }, told: (boolean | null)[] = [];
  assert.equal(await keepFiles(broken, kept => told.push(kept)), null, "a persisted() that fails: not known, and no rejection");
  await new Promise(setImmediate);
  assert.deepEqual(told, [null, null]);
  const none: (boolean | null)[] = [];
  assert.equal(await keepFiles({} as StorageManager, kept => none.push(kept)), null);
  assert.equal(await keepFiles(null), null);
  assert.deepEqual(none, [null]);
});

test("a browser that asks the user before it answers persist(): the page has the state at once, and the answer when it comes", async () => {
  let answer: () => void, granted = false;
  const prompting = { asks: 0, persist() { this.asks++; return new Promise<boolean>(ok => { answer = () => { granted = true; ok(true); }; }); }, async persisted() { return granted; } };
  const heard: (boolean | null)[] = [];
  assert.equal(await keepFiles(prompting, kept => heard.push(kept)), false, "it does not wait for the prompt");
  assert.deepEqual(heard, [false]);
  await new Promise(setImmediate);
  assert.equal(prompting.asks, 1);
  answer!();   // the user allows it, some time later
  await new Promise(setImmediate);
  assert.deepEqual(heard, [false, true]);
});

test("the tab lock: one holder; a second tab is told no; a take-over tells the first it lost", { skip: !globalThis.navigator?.locks && "this Node has no Web Locks" }, async () => {
  const name = `dofile-test-${process.pid}-${Date.now()}`, lost: [string, string][] = [];
  let firstLost!: () => void;
  const told = new Promise<void>(ok => { firstLost = ok; });
  const first = tabLock({ name, onLost: e => { lost.push(["first", (e as Error).name]); firstLost(); } });
  const second = tabLock({ name, onLost: e => lost.push(["second", (e as Error).name]) });
  assert.equal(await first.take(), true);
  assert.equal(await second.take(), false);
  assert.deepEqual(lost, []);
  assert.equal(await second.take({ steal: true }), true);
  await told;
  assert.deepEqual(lost, [["first", "AbortError"]]);
  assert.equal(await first.take(), false, "the first tab cannot simply take it back");
});

test("the tab lock: with no Web Locks, or when the browser refuses the request, every tab owns the engine", async () => {
  assert.equal(await tabLock({ locks: null }).take(), true);
  const warn = console.warn;
  console.warn = () => {};
  try {
    const rejecting = { request: async () => { throw new DOMException("not allowed here", "SecurityError"); } };
    assert.equal(await tabLock({ locks: rejecting }).take(), true, "a request that rejects before its callback");
    assert.equal(await tabLock({ locks: rejecting }).take({ steal: true }), true);
    const throwing = { request() { throw new DOMException("not supported", "NotSupportedError"); } };
    assert.equal(await tabLock({ locks: throwing }).take(), true);
  } finally {
    console.warn = warn;
  }
});
