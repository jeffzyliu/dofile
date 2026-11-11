// The file store with a running engine: the real worker.ts in a worker thread, the page's store in this thread
// (fake-indexeddb), as a page and its worker share one database. A page change reaches /work one way: its journal row,
// then `sync` (store.ts). SPEC.md section 7, tests 2 to 8 and 11; and the worker ops that came with prototype 1 (section 6). The transport alone, with no state machine: the test starts and ends the
// workers itself (harness.ts, startWorker), as the machine's effects would.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { EngineClient } from "../src/engine/client.ts";
import { openStore } from "../src/engine/store.ts";
import { bytes, endWorkers, extraWheels, live, nodeWorker, pendingRows, refuseWrites, runOn, sleep, startWorker, text, wheel } from "./harness.ts";
import type { Answer } from "../src/engine/machine.ts";
import type { FileStore } from "../src/engine/store.ts";
import type { BrowseRows, DataSummary, FileInfo } from "../src/engine/types.ts";

/** An op's answer that is not `{ error }` (the tests read the fields of one they expect to succeed). */
type Ok<T> = Exclude<T, { error: string }>;

after(endWorkers);

const byPath = (a: FileInfo, b: FileInfo) => (a.path < b.path ? -1 : 1);
// The store and /work hold the same folders and files, byte for byte. The `files` op waits in the worker's queue behind
// every page change posted before it, so /work is compared after those are in.
async function same(store: FileStore, eng: EngineClient) {
  const inWork = (await eng.query("files")).sort(byPath), inStore = await store.list();
  assert.deepEqual(inWork.map(f => [f.path, f.dir, f.size]), inStore.map(f => [f.path, f.dir, f.size]), "/work (first) is not the store (second)");
  for (const f of inStore) if (!f.dir) assert.deepEqual(await eng.query("read", { path: f.path }), await store.read(f.path), f.path);
  return inStore.map(f => f.path);
}
// Stata code that writes `content` to the file `path`
const writes = (path: string, content: string) => `file open f using ${path}, write replace\nfile write f "${content}"\nfile close f`;
// Start a run whose code has `display "go"` in it: `going` resolves when that line has reached the page (the log streams
// before each command), so a test makes its changes while what follows (a `sleep`) goes on. No guess of how long it takes.
function untilGo(eng: EngineClient, code: string) {
  let log = "", go!: () => void;
  const going = new Promise<void>(ok => { go = ok; });
  const running = runOn(eng, code, { onLog: c => { log += c; if (/^go$/m.test(log)) go(); } });
  running.then(go, go);   // a run that ends first (or is cut): the assertions after it say what went wrong
  return { running, going };
}
// a record's time in the store, set directly (the page's own writes always take the time now)
const setMtime = (store: FileStore, path: string, mtime: number) => store.tx(["info"], "readwrite", t => new Promise<void>((ok, err) => {
  const info = t.objectStore("info"), r = info.get(path);
  r.onsuccess = () => { info.put({ ...r.result, mtime }); ok(); };
  r.onerror = () => err(r.error);
}));
const deleteDatabase = (factory: IDBFactory) => new Promise((ok, err) => { const r = factory.deleteDatabase("dofile"); r.onsuccess = ok; r.onerror = () => err(r.error); });

test("the store and the engine: the start copy, the after-run difference, page changes during a run, a refused write, end() and a new worker", { timeout: 300_000 }, async t => {
  const store = openStore({ indexedDB: new IDBFactory() });
  // written before any worker exists
  await store.write("early.do", bytes('display "early " 6*7'));
  await store.write("data/in.txt", bytes("in the store first\n"));
  await store.mkdir("out");
  for (const name of ["a", "x", "y"]) await store.write(`${name}.txt`, bytes(`first ${name}`));
  // a file whose time is an hour ahead (written by a clock that was ahead): the wait before each run must not skip it
  await setMtime(store, "early.do", Date.now() + 3_600_000);
  assert.deepEqual(await pendingRows(store), []);

  const said: Answer<"start-worker">[] = [];
  const eng = new EngineClient({ createWorker: () => nodeWorker({ store }), wheel, extraWheels, store });
  const starting = startWorker(eng, null, said);
  let up = false;
  starting.then(() => { up = true; });

  await t.test("while mount runs, every store call answers, and what is written then is not lost", async () => {
    await store.write("during.do", bytes('display "during " 6*7'));
    await store.mkdir("tmp/a");
    await store.rename("tmp/a", "tmp/b");
    await store.remove("tmp");
    await store.rename("data/in.txt", "data/moved.txt");
    assert.equal(text(await store.read("data/moved.txt")), "in the store first\n");
    // Changes whose result depends on their order. The worker copies the store as it is after all of them, and their
    // syncs, queued behind mount, then find the journal empty: nothing is applied a second time on top of the copy.
    await store.rename("a.txt", "kept.txt");
    await store.write("a.txt", bytes("second a"));        // applied again: kept.txt would get this text
    await store.rename("x.txt", "swap.tmp");              // a swap of x and y: applied again, it is undone
    await store.rename("y.txt", "x.txt");
    await store.rename("swap.tmp", "y.txt");
    assert.equal((await store.zip()).size > 0, true);
    assert.ok(!said.some(a => a.type === "stage" && a.stage === "files"), "all of it was answered while the worker was still loading Python");
    assert.equal(up, false);
  });

  await t.test("start copy: /work is the store, pending is empty, and a run reads the files", async () => {
    assert.deepEqual(await same(store, eng), ["a.txt", "data", "data/moved.txt", "during.do", "early.do", "kept.txt", "out", "x.txt", "y.txt"]);
    assert.deepEqual(await pendingRows(store), [], "every page change is in /work");
    assert.equal(up, false, "the files were there before the engine finished loading");
    assert.deepEqual(await Promise.all(["kept.txt", "a.txt", "x.txt", "y.txt"].map(async p => text(await eng.query("read", { path: p })))),
      ["first a", "second a", "first y", "first x"], "the changes made during mount were not applied twice");
    const r = await runOn(eng, "do early.do\ndo during.do\ntype data/moved.txt");
    assert.equal(r.rc, 0, r.log);
    assert.match(r.log, /early 42/);
    assert.match(r.log, /during 42/);
    assert.match(r.log, /in the store first/);
    assert.deepEqual(r.files, [], "a run that writes nothing writes nothing to the store");
    assert.deepEqual(r.skipped, []);
    assert.equal(r.store_error, undefined);
    await starting;
    assert.equal(eng.storeError, null);
    for (const p of ["a.txt", "kept.txt", "x.txt", "y.txt"]) await store.remove(p);
  });

  await t.test("each kind of change alone reaches /work through its journal row and sync, and leaves no row", async () => {
    const steps: [string, () => Promise<unknown>][] = [
      ["write a file, with its folder", () => store.write("one/f.txt", bytes("f"))],
      ["write it again", () => store.write("one/f.txt", bytes("f, longer"))],
      ["make a folder", () => store.mkdir("two/deep")],
      ["rename a file", () => store.rename("one/f.txt", "g.txt")],
      ["rename a folder", () => store.rename("two", "three")],
      ["remove a file", () => store.remove("g.txt")],
      ["remove a folder", () => store.remove("three")],
      ["remove an empty folder", () => store.remove("one")],
    ];
    for (const [what, step] of steps) {
      await step();
      const all = await same(store, eng);   // `files` is answered after the change's sync
      assert.deepEqual(await pendingRows(store), [], what);
      if (what === "write it again") assert.equal(text(await eng.query("read", { path: "one/f.txt" })), "f, longer");
      if (what === "rename a folder") assert.ok(all.includes("three/deep") && !all.some(p => p.startsWith("two")));
    }
  });

  // Hold the worker's syncs while `changes` runs, so their rows wait in the journal; then one sync.
  const oneSync = async (changes: () => Promise<unknown>) => {
    const sync = store.sync!, onClosed = store.onClosed;
    let held = 0;
    store.attach(() => { held++; }, { onClosed });
    try {
      await changes();
    } finally {
      store.attach(sync, { onClosed });
    }
    const rows = (await pendingRows(store)).length;
    assert.equal(rows, held, "a row for each change, and the worker has heard of none");
    sync();
    return rows;
  };

  await t.test("one sync takes several journal rows at once; the next finds the journal empty", async () => {
    const rows = await oneSync(async () => {
      await store.write("s/a.txt", bytes("a"));
      await store.write("s/b.txt", bytes("b"));
      await store.rename("s/a.txt", "s/c.txt");
      await store.mkdir("s/d");
      await store.remove("s/b.txt");
      await store.write("s/c.txt", bytes("c, written again"));
    });
    assert.equal(rows, 6);
    const all = await same(store, eng);
    assert.deepEqual(all.filter(p => p.startsWith("s/")), ["s/c.txt", "s/d"]);
    assert.equal(text(await eng.query("read", { path: "s/c.txt" })), "c, written again");
    assert.deepEqual(await pendingRows(store), []);
    const before = await eng.query("files");
    store.sync!();
    assert.deepEqual(await eng.query("files"), before, "the next sync changes nothing");
    await store.remove("s");
  });

  await t.test("through a sync alone: a file replaced by a folder of the same name, and the reverse", async () => {
    await store.write("fx", bytes("a file"));
    await same(store, eng);
    await oneSync(async () => { await store.remove("fx"); await store.write("fx/in.txt", bytes("in the folder")); });
    assert.ok((await same(store, eng)).includes("fx/in.txt"));
    assert.equal(text(await eng.query("read", { path: "fx/in.txt" })), "in the folder");
    await oneSync(async () => { await store.remove("fx"); await store.write("fx", bytes("a file again")); });
    const all = await same(store, eng);
    assert.ok(all.includes("fx") && !all.includes("fx/in.txt"));
    assert.equal(text(await eng.query("read", { path: "fx" })), "a file again");
    assert.deepEqual(await pendingRows(store), []);
    await store.remove("fx");
  });

  await t.test("a sync that finds the journal empty changes nothing", async () => {
    const before = await eng.query("files");
    store.sync!();
    store.sync!();
    assert.deepEqual(await eng.query("files"), before, "the same files, with the same times");
    assert.deepEqual(await pendingRows(store), []);
  });

  await t.test("after-run difference: created, changed and deleted files; an untouched big file is not read; a file the page adds during the run stays", async () => {
    await store.write("keep.txt", bytes("keep"));
    await store.write("change.txt", bytes("KEEP"));   // same size as what the run copies over it: only the time tells
    await store.write("gone.txt", bytes("to be erased"));
    const big = await store.write("big.bin", new Uint8Array(3 << 20).fill(7));
    const seen: string[] = [], applyRun = store.applyRun.bind(store);
    store.applyRun = changes => { seen.push(...changes.map(c => c.path)); return applyRun(changes); };
    t.after(() => { store.applyRun = applyRun; });
    const { running, going } = untilGo(eng, `${writes("new.txt", "made by the run")}
copy keep.txt change.txt, replace
erase gone.txt
mkdir results
clear
set obs 3
generate x = _n
save results/d.dta
display "go"
sleep 1000`);
    await going;
    await store.write("added.txt", bytes("added by the page during the run"));
    const r = await running;
    store.applyRun = applyRun;
    assert.equal(r.rc, 0, r.log);
    assert.deepEqual(r.files!.map(f => [f.name, f.status]).sort(), [["change.txt", "modified"], ["gone.txt", "removed"], ["new.txt", "created"], ["results/d.dta", "created"]]);
    assert.equal(r.files!.find(f => f.name === "new.txt")!.bytes, 15);
    assert.deepEqual(r.skipped, []);
    assert.ok(r.timing!.save >= 0);
    assert.deepEqual(seen.sort(), ["change.txt", "gone.txt", "new.txt", "results", "results/d.dta"], "only what the run touched was read from /work");
    assert.deepEqual((await store.list()).find(f => f.path === "big.bin"), big, "the big file's record is as the page wrote it");
    const all = await same(store, eng);
    assert.deepEqual(all, ["added.txt", "big.bin", "change.txt", "data", "data/moved.txt", "during.do", "early.do", "keep.txt", "new.txt", "out", "results", "results/d.dta"]);
    assert.equal(text(await store.read("added.txt")), "added by the page during the run");
    assert.equal(text(await store.read("change.txt")), "keep");
    assert.equal(text(await store.read("new.txt")), "made by the run");
    assert.deepEqual(await pendingRows(store), []);
    await store.remove("big.bin");
  });

  await t.test("two runs in a row that rewrite a file with the same number of bytes: each one is saved", async () => {
    for (let i = 0; i < 20; i++) {
      const content = String(1000 + i);   // always 4 bytes
      const r = await runOn(eng, writes("tick.txt", content));
      assert.deepEqual(r.files, [{ name: "tick.txt", status: i ? "modified" : "created", bytes: 4 }], `run ${i}`);
      assert.equal(text(await store.read("tick.txt")), content, `run ${i}`);
    }
    await store.remove("tick.txt");
  });

  // MEMFS does not stamp a truncation with a time (its setattr takes no size time, and a write of 0 bytes sets none):
  // only the size tells. The engine has no command that shortens a file but leaves it non-empty without writing to it.
  await t.test("a run that empties a file, with no write or with an empty one: the file is saved as modified, 0 bytes", async () => {
    for (const [i, code] of [`file open f using e.txt, write replace\nfile close f`,
      `file open f using e.txt, write replace\nfile write f ""\nfile close f`].entries()) {
      await store.write("e.txt", bytes("not empty"));
      const r = await runOn(eng, code);
      assert.equal(r.rc, 0, r.log);
      assert.deepEqual(r.files, [{ name: "e.txt", status: "modified", bytes: 0 }], `case ${i}`);
      assert.equal(text(await store.read("e.txt")), "", `case ${i}`);
      assert.equal((await store.list()).find(f => f.path === "e.txt")!.size, 0, `case ${i}`);
    }
    await store.remove("e.txt");
  });

  await t.test("a save, a delete and a rename by the page during a run that writes the same files: the store and /work hold the page's version", async () => {
    await store.write("src.txt", bytes("written by the run"));
    await store.write("same.txt", bytes("old"));
    await store.write("del.txt", bytes("old"));
    await store.write("ren.txt", bytes("the page's file"));
    await store.write("dir/a.txt", bytes("the page's a"));
    const { running, going } = untilGo(eng, `display "go"
sleep 1000
copy src.txt same.txt, replace
copy src.txt del.txt, replace
copy src.txt ren.txt, replace
copy src.txt dir/a.txt, replace
copy src.txt dir/b.txt, replace
copy src.txt other.txt, replace`);
    await going;
    await store.write("same.txt", bytes("the user's text"));
    await store.remove("del.txt");
    await store.rename("ren.txt", "renamed.txt");
    await store.rename("dir", "folder");
    assert.equal((await pendingRows(store)).length, 4, "the worker is busy: the four changes wait");
    const r = await running;
    assert.equal(r.rc, 0, r.log);
    assert.deepEqual(r.files, [{ name: "other.txt", status: "created", bytes: 18 }], "the run's versions of the page's files are left out");
    assert.deepEqual([...r.skipped!].sort(), ["dir/a.txt", "dir/b.txt"], "the result names only the files lost with the folder the page renamed");
    assert.deepEqual(await pendingRows(store), [], "the worker took the page's version with the run's result: nothing waits");
    const all = await same(store, eng);
    for (const gone of ["del.txt", "ren.txt", "dir", "dir/a.txt", "dir/b.txt", "folder/b.txt"]) assert.ok(!all.includes(gone), gone);
    assert.equal(text(await store.read("same.txt")), "the user's text");
    assert.equal(text(await store.read("renamed.txt")), "the page's file");
    assert.equal(text(await store.read("folder/a.txt")), "the page's a");
    assert.equal(text(await eng.query("read", { path: "same.txt" })), "the user's text");
    assert.equal(text(await eng.query("read", { path: "renamed.txt" })), "the page's file");
    // and the next run sees the page's versions and saves over them as usual
    const next = await runOn(eng, "type same.txt\ncopy src.txt same.txt, replace");
    assert.match(next.log, /the user's text/);
    assert.deepEqual(next.files, [{ name: "same.txt", status: "modified", bytes: 18 }]);
    assert.equal(text(await store.read("same.txt")), "written by the run");
    for (const p of ["same.txt", "renamed.txt", "folder", "other.txt"]) await store.remove(p);
  });

  await t.test("renames in a chain during a run that changes the file, and a folder renamed twice: /work ends as the store", async () => {
    await store.write("f.txt", bytes("the page's f"));
    await store.write("box/in.txt", bytes("the page's in"));
    const { running, going } = untilGo(eng, 'display "go"\nsleep 1000\ncopy src.txt f.txt, replace\ncopy src.txt box/in.txt, replace\ncopy src.txt box/new.txt, replace');
    await going;
    await store.rename("f.txt", "t.txt");
    await store.rename("t.txt", "u.txt");
    await store.rename("box", "box2");
    await store.rename("box2", "box3");
    const r = await running;
    assert.equal(r.rc, 0, r.log);
    assert.deepEqual(r.files, []);
    assert.deepEqual([...r.skipped!].sort(), ["box/in.txt", "box/new.txt"], "not f.txt: the page renamed that file itself");
    const all = await same(store, eng);
    assert.ok(all.includes("u.txt") && all.includes("box3/in.txt"));
    for (const gone of ["f.txt", "t.txt", "box", "box2", "box3/new.txt"]) assert.ok(!all.includes(gone), gone);
    assert.equal(text(await eng.query("read", { path: "u.txt" })), "the page's f");
    assert.equal(text(await eng.query("read", { path: "box3/in.txt" })), "the page's in");
    assert.deepEqual(await pendingRows(store), []);
    await store.remove("u.txt");
    await store.remove("box3");
  });

  await t.test("a folder the page makes during a run does not hide the run's files under it", async () => {
    const { running, going } = untilGo(eng, `display "go"\nsleep 1000\nmkdir made\n${writes("made/t.txt", "the run's t")}`);
    await going;
    await store.mkdir("made");
    const r = await running;
    assert.equal(r.rc, 0, r.log);
    assert.deepEqual(r.files, [{ name: "made/t.txt", status: "created", bytes: 11 }]);
    assert.deepEqual(r.skipped, []);
    assert.equal(text(await store.read("made/t.txt")), "the run's t");
    await same(store, eng);
    await store.remove("made");
  });

  await t.test("a run's new file inside a folder the page renamed or removed during the run is dropped, and the result says so", async () => {
    await store.write("proj/main.do", bytes("display 1"));
    await store.write("old/keep.txt", bytes("x"));
    const { running, going } = untilGo(eng, `display "go"\nsleep 1000\n${writes("proj/out.txt", "result")}\n${writes("old/log.txt", "log")}\n${writes("free.txt", "kept")}`);
    await going;
    await store.rename("proj", "project");
    await store.remove("old");
    const r = await running;
    assert.equal(r.rc, 0, r.log);
    assert.deepEqual(r.files, [{ name: "free.txt", status: "created", bytes: 4 }]);
    assert.deepEqual([...r.skipped!].sort(), ["old/log.txt", "proj/out.txt"]);
    const all = await same(store, eng);
    assert.ok(all.includes("project/main.do") && !all.some(p => p.startsWith("proj/") || p.startsWith("old") || p === "project/out.txt"));
    await store.remove("project");
    await store.remove("free.txt");
  });

  await t.test("the page removes the last file of a folder while the run removes the folder: it is gone from both", async () => {
    await store.write("d2/x.txt", bytes("x"));
    const { running, going } = untilGo(eng, 'display "go"\nsleep 1000\nerase d2/x.txt\nrmdir d2');
    await going;
    await store.remove("d2/x.txt");
    const r = await running;
    assert.equal(r.rc, 0, r.log);
    assert.ok(!(await same(store, eng)).includes("d2"));
  });

  await t.test("the page writes a file where the run makes a folder: the page's file is in both, and the run's file is dropped", async () => {
    const { running, going } = untilGo(eng, `display "go"\nsleep 1000\nmkdir q\n${writes("q/inner.txt", "inner")}`);
    await going;
    await store.write("q", bytes("the page's q"));
    const r = await running;
    assert.equal(r.rc, 0, r.log);
    assert.deepEqual(r.skipped, [], "not a folder the page renamed or removed: not listed");
    assert.ok((await same(store, eng)).includes("q"));
    assert.equal(text(await eng.query("read", { path: "q" })), "the page's q");
    assert.deepEqual(await pendingRows(store), []);
    await store.remove("q");
  });

  await t.test("a run's folder the store refused, then the page writes a file at that path: /work takes the page's file, and nothing is owed", async tt => {
    const undo = refuseWrites(tt);
    const r = await runOn(eng, `mkdir clash\n${writes("clash/x.txt", "the run's x")}`);
    assert.match(r.store_error!, /quota/);
    undo();
    assert.ok(!(await store.list()).some(f => f.path.startsWith("clash")), "the store has none of it");
    await store.write("clash", bytes("a file"));   // where /work has the run's folder
    await store.write("after.txt", bytes("the next change still arrives"));
    assert.ok((await same(store, eng)).includes("clash"));
    assert.equal(text(await eng.query("read", { path: "clash" })), "a file");
    assert.deepEqual(await pendingRows(store), [], "no row is left to hide later runs' files");
    assert.deepEqual((await runOn(eng, "display 1")).files, [], "nothing is owed for the run's folder or its file");
    const again = await runOn(eng, writes("clash", "run"));   // and a run's change to it is saved again
    assert.deepEqual(again.files, [{ name: "clash", status: "modified", bytes: 3 }]);
    await store.remove("clash");
    await store.remove("after.txt");
  });

  // A run's file the store refused stands in /work where the page's version has a folder: above a file the page writes
  // (a), or at a folder the page makes (b). The page's version wins: the run's file goes from /work and is not owed.
  for (const [name, page] of [["clashA", "writes clashA/x.txt"], ["clashB", "makes the folder clashB"]] as const) {
    await t.test(`a run's file the store refused, then the page ${page}: /work and the store hold the page's folder, and nothing is owed`, async tt => {
      const undo = refuseWrites(tt);
      assert.match((await runOn(eng, writes(name, "the run's file"))).store_error!, /quota/);
      undo();
      if (name === "clashA") await store.write("clashA/x.txt", bytes("the page's x"));
      else await store.mkdir("clashB");
      const want = name === "clashA" ? [["clashA", true], ["clashA/x.txt", false]] : [["clashB", true]];
      const records = async () => (await store.list()).filter(f => f.path.startsWith(name)).map(f => [f.path, f.dir]);
      const all = await same(store, eng);
      assert.ok(all.includes(name));
      assert.deepEqual(await records(), want);
      if (name === "clashA") assert.equal(text(await eng.query("read", { path: "clashA/x.txt" })), "the page's x");
      assert.deepEqual(await pendingRows(store), []);
      assert.deepEqual((await runOn(eng, "display 1")).files, [], "nothing is owed for the run's file");
      assert.deepEqual(await records(), want, "the store still has the page's folder");
      await same(store, eng);
      await store.remove(name);
    });
  }

  await t.test("a refused after-run write gives the run store_error, and the next run writes it; a file the page renamed meanwhile keeps the page's version, and nothing is owed for either name", async tt => {
    await store.write("m.txt", bytes("old m"));
    await store.write("fold/in.txt", bytes("in"));
    const undo = refuseWrites(tt);
    const r = await runOn(eng, `${writes("quota.txt", "x")}\nerase keep.txt\ncopy src.txt m.txt, replace\nerase fold/in.txt\nrmdir fold`);
    assert.equal(r.rc, 0, r.log);
    assert.match(r.store_error!, /quota/);
    assert.deepEqual(r.files, []);
    const before = (await store.list()).map(f => f.path);
    assert.ok(!before.includes("quota.txt") && before.includes("keep.txt") && before.includes("fold/in.txt"), "nothing of the refused write is in the store");
    undo();
    // The page renames a file whose new text the store has not got. The page's version wins, as for a rename during a
    // run: /work takes the store's n.txt (the text from before the run), and the run's text for m.txt is not owed.
    await store.rename("m.txt", "n.txt");
    assert.equal(text(await eng.query("read", { path: "n.txt" })), "old m", "/work has the store's version");
    const again = await runOn(eng, "display 1");
    assert.equal(again.store_error, undefined);
    // the rest is written: a file the store had is "removed"; the folder is not listed as a file; neither name of the
    // renamed file is listed
    assert.deepEqual(again.files!.map(f => [f.name, f.status]).sort(), [["fold/in.txt", "removed"], ["keep.txt", "removed"], ["quota.txt", "created"]]);
    assert.equal(text(await store.read("n.txt")), "old m");
    const all = await same(store, eng);
    assert.ok(!all.includes("fold") && !all.includes("m.txt"));
    assert.deepEqual((await runOn(eng, "display 2")).files, [], "nothing is tried a third time");
    await store.remove("n.txt");
  });

  // the machine's RESET: end-worker, then start-worker (the run's rc 9998 result is the machine's own: machine.test.ts)
  await t.test("end() during a run, then a new worker: the cut run wrote nothing, /work is rebuilt from the store, pending is empty", async () => {
    const before = (await store.list()).map(f => f.path);
    const { running, going } = untilGo(eng, `${writes("cut.txt", "never saved")}\nerase src.txt\ndisplay "go"\nsleep 30000`);
    await going;
    await store.write("saved.txt", bytes("saved by the page during the run"));
    assert.equal((await pendingRows(store)).length, 1);
    const old = eng.worker;
    eng.end(live(eng), { kind: "reset", reset: "user", reason: "session reset: test. Data in memory is gone; your files are kept." });
    await assert.rejects(running, { kind: "reset", reset: "user", message: "session reset: test. Data in memory is gone; your files are kept." });
    assert.equal(eng.worker, null);
    await startWorker(eng);
    assert.notEqual(eng.worker, old);
    assert.deepEqual(await same(store, eng), [...before, "saved.txt"].sort());
    assert.ok(before.includes("src.txt") && !before.includes("cut.txt"));
    assert.deepEqual(await pendingRows(store), []);
    const r = await runOn(eng, 'display "N=" _N\ntype saved.txt');
    assert.equal(r.rc, 0, r.log);
    assert.match(r.log, /N=0/);
    assert.match(r.log, /saved by the page during the run/);
  });

  // the machine's LOST: end-worker, and no start
  await t.test("end() with no new start: the worker is gone, and the store goes on without it", async () => {
    eng.end(live(eng), { kind: "stopped", reason: "session reset: another tab took over." });
    assert.equal(eng.worker, null);
    await assert.rejects(eng.query("files"), { kind: "no-engine" });
    await store.write("after-stop.txt", bytes("x"));
    assert.deepEqual(await pendingRows(store), [], "no worker: nothing is journalled");
    await assert.rejects(runOn(eng, "display 1"), { kind: "no-engine" }, "a run with no worker is refused");
  });
});

test("after a start that failed, every store call works and nothing is journalled", { timeout: 20_000 }, async () => {
  const store = openStore({ indexedDB: new IDBFactory() });
  const blocked = () => {   // as a worker script that never loads: an error event, no messages
    const port = { onmessage: null, onerror: null as null | ((e: Error) => void), terminate() {}, postMessage() { setTimeout(() => port.onerror?.(new Error("blocked")), 10); } };
    return port as unknown as globalThis.Worker;
  };
  const eng = new EngineClient({ createWorker: blocked, wheel, extraWheels, store });
  const starting = startWorker(eng);
  await store.write("while-failing.do", bytes("display 1"));   // a worker exists for a moment: journalled, and harmless
  await assert.rejects(starting, { type: "crashed", cause: "error", detail: "blocked" });
  eng.end(live(eng), { kind: "failed-twice", reason: "the engine's worker failed twice (blocked); reload the page" });   // the machine's TWICE
  await store.write("a/b.do", bytes("display 2"));
  await store.mkdir("c");
  await store.rename("a/b.do", "c/b.do");
  await store.remove("a");
  assert.equal(text(await store.read("c/b.do")), "display 2");
  assert.deepEqual((await store.list()).map(f => f.path), ["c", "c/b.do", "while-failing.do"]);
  assert.equal((await store.zip()).size > 100, true);
  assert.deepEqual((await pendingRows(store)).map(r => r.path), ["while-failing.do"], "only the change made while a worker existed; the next start clears it");
});

test("a worker that cannot open the file store still starts, and says the files are not saved", { timeout: 120_000 }, async () => {
  const eng = new EngineClient({ createWorker: () => nodeWorker({ noDatabase: true }), wheel, extraWheels });
  await startWorker(eng);
  assert.match(eng.storeError!, /^the files are not saved: this browser has no storage for files/);
  assert.equal(eng.startup!.storeError, eng.storeError);
  const r = await runOn(eng, writes("lost.txt", "x"));
  assert.equal(r.rc, 0, r.log);
  assert.match(r.store_error!, /the files are not saved/);
  assert.deepEqual([r.files, r.skipped], [[], []]);
  assert.equal((await runOn(eng, "display 1")).store_error, undefined, "a run that writes no file has nothing to say");
  eng.worker!.terminate();
});

test("the page's store with a worker that has none: the store is detached, so the page's changes stay in the store, with no `pending` row, and do not reach /work", { timeout: 120_000 }, async () => {
  const store = openStore({ indexedDB: new IDBFactory() });
  const worker = () => nodeWorker({ store: { takeAll: async () => { throw new Error("this browser has no storage for files (IndexedDB)"); } } as unknown as FileStore });
  const eng = new EngineClient({ createWorker: worker, wheel, extraWheels, store });
  await startWorker(eng);
  assert.match(eng.storeError!, /^the files are not saved/);
  assert.equal(store.sync, null, "detached: the worker could not read the journal");
  await store.write("page.txt", bytes("from the page"));
  assert.equal(text(await store.read("page.txt")), "from the page");
  assert.deepEqual(await eng.query("files"), [], "/work does not get it");
  assert.deepEqual(await pendingRows(store), [], "no row that no worker would ever clear");
  eng.worker!.terminate();
});

test("the browser deletes the database under a live worker: the transport says `crashed`, cause storage; a new worker copies the store as it is now", { timeout: 120_000 }, async () => {
  const factory = new IDBFactory(), store = openStore({ indexedDB: factory }), said: Answer<"start-worker">[] = [];
  const eng = new EngineClient({ createWorker: () => nodeWorker({ store }), wheel, extraWheels, store });
  const starting = startWorker(eng, null, said);
  for (let i = 0; i < 5; i++) await store.write(`m${i}.txt`, bytes("x"));   // while it mounts
  await starting;
  await deleteDatabase(factory);   // "Clear site data": the store is empty now, and /work still has the five files
  assert.deepEqual(said.at(-1), { type: "crashed", cause: "storage", reason: "unknown", detail: "the browser closed the file storage" });
  // the machine's RESET(crash): end-worker, then (the list fetched) start-worker
  eng.end(live(eng), { kind: "reset", reset: "crash", reason: "session reset: the browser closed the file storage." });
  const again = startWorker(eng);
  await store.write("new.txt", bytes("after the database was cleared"));
  await again;
  assert.deepEqual(await same(store, eng), ["new.txt"]);
  const r = await runOn(eng, "type new.txt");
  assert.equal(r.rc, 0, r.log);
  assert.match(r.log, /after the database was cleared/);
  eng.worker!.terminate();
});

test("the engine with its own database: the old /work database is left alone; Break (interrupt) on a long command, on one that does not stop, on a loop; the ops", { timeout: 300_000 }, async t => {
  let port!: ReturnType<typeof nodeWorker>;
  const eng = new EngineClient({ createWorker: () => (port = nodeWorker({ oldDatabase: true })), wheel, extraWheels });
  await startWorker(eng);

  await t.test("the old IDBFS database is not read, changed or deleted; the files go to the new one", async () => {
    assert.deepEqual(await eng.query("files"), [], "nothing was imported from the old database");
    const r = await runOn(eng, writes("made.txt", "new store"));
    assert.equal(r.rc, 0, r.log);
    assert.deepEqual(r.files, [{ name: "made.txt", status: "created", bytes: 9 }]);
    const dbs = await port.harness("databases");
    assert.deepEqual(Object.keys(dbs).sort(), ["/work", "dofile"]);
    assert.equal(dbs["/work"].version, 21);
    assert.deepEqual(Object.keys(dbs["/work"].stores), ["FILE_DATA"]);
    const [[key, record]] = dbs["/work"].stores.FILE_DATA;
    assert.equal(dbs["/work"].stores.FILE_DATA.length, 1);
    assert.equal(key, "/work/old.do");
    assert.equal(text(record.contents), "display 1\n");
    assert.equal(record.timestamp.getTime(), 1700000000000);
    assert.deepEqual(dbs.dofile.stores.info.map(([path]: [string]) => path), ["made.txt"]);
    assert.equal(text(new Uint8Array(dbs.dofile.stores.data[0][1])), "new store");
    assert.deepEqual(dbs.dofile.stores.pending, []);
  });

  // The Break timer, its deadline and "Don't reset" are the machine's and the controller's (machine.test.ts, app.test.ts).
  // Here: what the engine does with the request (the `interrupt` effect) while no timer cuts it.
  await t.test("interrupt() during a long command: it is not cut; it ends by itself, then the run stops with rc 1 and the data", async () => {
    // One command that cannot stop mid-way and runs for more than a second: a sort of six million random numbers
    // (`sleep` would not do: it stops at a Break). The Break comes just after the sort starts (the "go" line is sent
    // before it).
    assert.equal((await runOn(eng, "clear\nset obs 6000000\ngenerate double k1 = runiform()\ngenerate double k2 = runiform()\ngenerate byte x = 1")).rc, 0);
    const worker = eng.worker;
    const { running, going } = untilGo(eng, 'display "go"\nsort k1\ngenerate y = 2');
    await going;
    await sleep(30);   // past the Break check before the sort
    eng.interrupt(live(eng));
    const asked = Date.now();
    const r = await running;
    assert.equal(r.rc, 1, r.log);
    assert.ok(Date.now() - asked > 50, "the command was not cut: it ended by itself, well after the Break was asked");
    assert.equal(eng.worker, worker, "the same worker");
    const after = await runOn(eng, "summarize x\nconfirm variable y");
    assert.equal(after.nobs, 6000000, "the data is kept");
    assert.equal(after.rc, 111, "and the command after the Break did not run");
  });

  // the machine's RESET(break), when the grace time runs out: end-worker, then start-worker
  await t.test("a command that has not stopped a while after interrupt() is still running; end() cuts it and a new worker answers", async () => {
    const worker = eng.worker;
    const { running, going } = untilGo(eng, 'display "go"\nsort k2');
    await going;
    await sleep(30);   // the sort is under way
    eng.interrupt(live(eng));
    let settled = false;
    running.then(() => { settled = true; }, () => { settled = true; });
    await sleep(50);
    assert.equal(settled, false, "the sort does not stop mid-way");
    const reason = "session reset: the code did not stop at Break. Data in memory is gone; your files are kept.";
    eng.end(live(eng), { kind: "reset", reset: "break", reason });
    await assert.rejects(running, { kind: "reset", reset: "break", message: reason });
    await startWorker(eng);
    assert.notEqual(eng.worker, worker);
    // (the files are not checked here: this thread's database ended with the thread. The end() test above has them.)
    const next = await runOn(eng, 'display "N=" _N');
    assert.match(next.log, /N=0/, "the data in memory is gone");
  });

  await t.test("a Break that works: rc 1; an interrupt asked while nothing runs does not stop the next run", async () => {
    await runOn(eng, "clear\nset obs 10\ngenerate x = 0");
    const running = runOn(eng, "while 1 {\n quietly replace x = x + 1\n}");
    await sleep(500);
    eng.interrupt(live(eng));   // a loop takes a Break at its next pass
    assert.equal((await running).rc, 1);
    eng.interrupt(live(eng));   // nothing is running
    const next = await runOn(eng, "display 1\ndisplay 2");
    assert.equal(next.rc, 0, "the worker clears the request when a run starts");
    assert.match(next.log, /^2$/m);
  });

  // ---- the worker ops of prototype 1 (SPEC.md section 6). Python's side is src/dofile/browser.py.

  await t.test("an op's error has the error's name, and a file system error is readable", async () => {
    await assert.rejects(eng.query("read", { path: "nothing-here.txt" }), { kind: "op", name: "ErrnoError", message: "file system error ENOENT" });
    await assert.rejects(eng.query("read", { path: "../etc/passwd" }), { kind: "op", name: "Error", message: /not in the working folder/ });
    await assert.rejects(eng.query("nosuchop" as "files"), { kind: "op", message: "unknown op nosuchop" });
  });

  await t.test("run: the log streams to onLog while the run prints, and the result still has all of it", async () => {
    const chunks: string[] = [], at: number[] = [], t0 = Date.now();
    const r = await runOn(eng, 'forvalues i = 1/6 {\n display "line `i\'"\n sleep 250\n}', { onLog: c => { chunks.push(c); at.push(Date.now() - t0); } });
    assert.equal(r.rc, 0, r.log);
    assert.ok(chunks.length >= 2, `${chunks.length} chunks`);
    assert.ok(at[0] < 1200, "the first chunk came while the run was still going");
    assert.equal(chunks.join(""), r.log);
    assert.equal(r.error_line, null);
    assert.deepEqual(r.graph_commands, []);
    assert.deepEqual(r.graph_lines, []);
  });

  await t.test("run options: fresh_locals, plot_theme; the result has error_line, graph_commands and graph_lines", async () => {
    await runOn(eng, "local a 5");
    assert.match((await runOn(eng, 'display "[`a\']"')).log, /\[5\]/);
    assert.match((await runOn(eng, 'display "[`a\']"', { fresh_locals: true })).log, /\[\]/);
    const bad = await runOn(eng, "display 1\nnosuchcommand\ndisplay 3");
    assert.equal(bad.rc, 199);
    assert.equal(bad.error_line, 2);
    const light = await runOn(eng, "clear\nset obs 20\ngenerate x = _n\ngenerate y = x^2\nscatter y x");
    assert.deepEqual(light.graph_lines, [5]);
    const dark = await runOn(eng, "scatter y x", { plot_theme: "dark" });
    assert.equal(dark.rc, 0, dark.log);
    assert.deepEqual(dark.graph_commands, ["scatter y x"]);
    assert.equal(dark.images.length, 1);
    assert.notEqual(dark.images[0], light.images[0], "the dark plot is another picture");
  });

  await t.test("macros, browse, memory, describe_file", async () => {
    await runOn(eng, "clear\nset obs 60\ngenerate x = _n\ngenerate str3 s = \"abc\"\nsave d.dta, replace\nlocal mine 5\nglobal G hello");
    const m = await eng.query("macros");
    assert.equal(m.locals.mine, "5");
    assert.equal(m.globals.G, "hello");
    assert.ok(Array.isArray(m.system_globals));

    const first = await eng.query("browse") as Ok<BrowseRows>;
    assert.deepEqual([first.nobs, first.offset, first.rows.length, first.more], [60, 0, 50, 10]);
    assert.deepEqual(first.vars, ["x", "s"]);
    const page = await eng.query("browse", { vars: "x", offset: 50, limit: 5 }) as Ok<BrowseRows>;
    assert.deepEqual([page.offset, page.rows.length, page.more, page.vars], [50, 5, 5, ["x"]]);
    assert.equal(page.rows[0][0].trim(), "51");
    assert.ok((await eng.query("browse", { vars: "nosuchvar" }) as { error: string }).error);

    const mem = await eng.query("memory");
    assert.ok(mem.data_bytes > 0);
    assert.ok(mem.heap_bytes > 30 << 20 && mem.heap_bytes % 65536 === 0, "the size of the WebAssembly memory");

    await runOn(eng, "clear");
    const d = await eng.query("describe_file", { path: "d.dta" }) as Ok<DataSummary>;
    assert.deepEqual([d.nobs, d.nvars, d.variables.map(v => v.name)], [60, 2, ["x", "s"]]);
    assert.equal((await eng.query("describe") as Ok<DataSummary>).nobs, 0, "the data in memory is as it was");
    assert.ok((await eng.query("describe_file", { path: "nothing.dta" }) as { error: string }).error);
    await assert.rejects(eng.query("describe_file", { path: "../etc/passwd" }), /not in the working folder/);
  });

  eng.worker!.terminate();
});
