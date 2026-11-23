// The worker's /work mirror (src/engine/work-mirror.ts) on an in-memory file system and a fake store; files.test.ts runs
// it in the real worker over IndexedDB.

import assert from "node:assert/strict";
import { posix } from "node:path";
import { test } from "node:test";
import type { AppliedRun, RunChange, StoreCopy } from "../src/engine/store.ts";
import type { MirrorFS, MirrorStore } from "../src/engine/work-mirror.ts";
import { WorkMirror } from "../src/engine/work-mirror.ts";

const DIR = 0o040000;
const FILE = 0o100000;
type Node = { dir: boolean; data: Uint8Array; mtime: number };
const errno = (n: number) => Object.assign(new Error(`errno ${n}`), { errno: n });

// MEMFS as the mirror sees it: a write stamps the time, a truncation does not (truncate), mkdirTree passes over a file.
function memfs() {
  const nodes = new Map<string, Node>([["/", { dir: true, data: new Uint8Array(), mtime: 0 }]]);
  const parentIsDir = (p: string) => nodes.get(posix.dirname(p))?.dir === true;
  const fs: MirrorFS & { failWrites: boolean } = {
    failWrites: false,
    readdir: (p) => [
      ".",
      "..",
      ...[...nodes.keys()].filter((k) => k !== p && posix.dirname(k) === p).map((k) => posix.basename(k)),
    ],
    stat(p) {
      const n = nodes.get(p);
      if (!n) throw errno(44);
      return { mode: n.dir ? DIR : FILE, size: n.dir ? 4096 : n.data.length, mtime: new Date(n.mtime) };
    },
    isDir: (mode) => (mode & 0o170000) === DIR,
    analyzePath: (p) => ({ exists: nodes.has(p) }),
    unlink(p) {
      if (nodes.get(p)?.dir !== false) throw errno(31);
      nodes.delete(p);
    },
    rmdir(p) {
      if (fs.readdir(p).length > 2) throw errno(55);
      nodes.delete(p);
    },
    mkdirTree(p) {
      let at = "";
      for (const part of p.split("/").filter(Boolean)) {
        at += `/${part}`;
        if (!nodes.has(at)) nodes.set(at, { dir: true, data: new Uint8Array(), mtime: Date.now() });
      }
    },
    writeFile(p, data) {
      if (fs.failWrites || !parentIsDir(p) || nodes.get(p)?.dir) throw errno(54);
      nodes.set(p, { dir: false, data: data.slice(), mtime: Date.now() });
    },
    readFile(p) {
      const n = nodes.get(p);
      if (!n || n.dir) throw errno(44);
      return n.data.slice();
    },
    utime(p, _atime, mtime) {
      nodes.get(p)!.mtime = mtime;
    },
  };
  return { fs, nodes };
}

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (data: Uint8Array) => new TextDecoder().decode(data);
const noResync = (): AppliedRun["resync"] => ({ paths: [], infos: [], data: [], dirs: [] });
const record = (path: string, body: string, mtime: number) => ({
  info: { path, dir: false, size: bytes(body).length, mtime },
  data: [path, bytes(body).buffer] as [string, ArrayBuffer],
});

// The store as the mirror sees it: what takeAll gives, and per applyRun what it was given and what the page changed.
function fakeStore(copy: StoreCopy = { infos: [], data: [] }) {
  const store = {
    runs: [] as RunChange[][],
    refuse: null as Error | null,
    resync: noResync(),
    takeAll: async () => copy,
    async applyRun(changes: RunChange[]): Promise<AppliedRun> {
      store.runs.push(changes);
      if (store.refuse) throw store.refuse;
      const resync = store.resync;
      store.resync = noResync();
      return { files: changes.map((c) => ({ name: c.path, status: c.status, bytes: c.size })), skipped: [], resync };
    },
  };
  return store;
}

async function mirrorOf(copy?: StoreCopy) {
  const { fs, nodes } = memfs();
  const store = fakeStore(copy);
  const mirror = new WorkMirror(fs, posix, (e) => ({ message: (e as Error).message, name: (e as Error).name }));
  await mirror.copyStore(() => store as MirrorStore);
  const file = (path: string) => nodes.get(`/work/${path}`);
  const write = (path: string, body: string) => fs.writeFile(`/work/${path}`, bytes(body));
  return { fs, nodes, store, mirror, file, write };
}
const changed = (changes: RunChange[] | undefined) => (changes ?? []).map((c) => `${c.status} ${c.path}`).sort();

test("mount's copy puts each record in /work with its time; the hidden folder is not listed", async () => {
  const a = record("a.do", "display 1\n", 1700000000000);
  const b = record("data/b.csv", "x\n1\n", 1700000001000);
  const { mirror, write, fs } = await mirrorOf({
    infos: [{ path: "data", dir: true, size: 0, mtime: 1 }, a.info, b.info],
    data: [a.data, b.data],
  });
  fs.mkdirTree("/work/.dofile");
  write(".dofile/x", "hidden");
  assert.deepEqual(
    mirror
      .walk()
      .map(({ path, dir, size, mtime }) => [path, dir, size, dir ? 0 : mtime])
      .sort(),
    [
      ["a.do", false, 10, 1700000000000],
      ["data", true, 0, 0],
      ["data/b.csv", false, 4, 1700000001000],
    ],
  );
  assert.equal(mirror.storeError, null);
});

test("a store that cannot be opened, or whose copy fails, leaves /work empty and says why; a run then says it too", async () => {
  const { fs } = memfs();
  const opened = new WorkMirror(fs, posix, (e) => ({ message: (e as Error).message, name: "QuotaExceededError" }));
  await opened.copyStore(() => {
    throw new Error("refused");
  });
  assert.deepEqual(opened.storeError, { message: "refused", name: "QuotaExceededError", cause: "open" });
  await opened.sync(); // no store: nothing to read
  fs.writeFile("/work/out.csv", bytes("1"));
  assert.deepEqual(await opened.saveRun([]), { files: [], skipped: [], store_error: "refused" });

  const { fs: fs2 } = memfs();
  const copied = new WorkMirror(fs2, posix, (e) => ({ message: (e as Error).message, name: "Error" }));
  const a = record("a.do", "x", 1);
  fs2.failWrites = true;
  await copied.copyStore(() => fakeStore({ infos: [a.info], data: [a.data] }));
  assert.equal(copied.storeError?.cause, "copy");
});

test("sync puts the page's version of each path the journal named into /work: a write, a remove, a rename, a mkdir", async () => {
  const { mirror, store, file, write, nodes } = await mirrorOf();
  write("old.do", "old");
  nodes.set("/work/gone", { dir: true, data: new Uint8Array(), mtime: 1 });
  write("gone/x.do", "x");
  const saved = record("a.do", "page's", 5);
  const moved = record("new.do", "old", 6);
  store.resync = {
    paths: ["a.do", "gone", "old.do", "new.do"],
    infos: [saved.info, moved.info],
    data: [saved.data, moved.data],
    dirs: ["made/sub"],
  };
  await mirror.sync();
  assert.deepEqual(changed(store.runs[0]), [], "sync takes the journal with no changes");
  assert.equal(text(file("a.do")!.data), "page's");
  assert.equal(file("a.do")!.mtime, 5);
  assert.equal(file("gone"), undefined);
  assert.equal(file("gone/x.do"), undefined);
  assert.equal(file("old.do"), undefined);
  assert.equal(text(file("new.do")!.data), "old");
  assert.equal(file("made/sub")?.dir, true);
});

test("a run: created, a same-size rewrite (time only), emptied (size only), deleted and renamed files; the rest is not read", async () => {
  const recs = ["same.do", "rewrite.do", "empty.do", "delete.do", "from.do"].map((p) => record(p, "12345", 1));
  const { mirror, store, fs, nodes, write } = await mirrorOf({
    infos: recs.map((r) => r.info),
    data: recs.map((r) => r.data),
  });
  const now = Date.now(); // the files' time is the clock's: beforeRun must wait past it for the rewrite to show
  for (const n of nodes.values()) n.mtime = now;
  const before = mirror.beforeRun();
  assert.ok(Date.now() > now, "the clock is past the newest file");
  write("new.do", "n");
  write("rewrite.do", "54321");
  nodes.get("/work/empty.do")!.data = new Uint8Array(); // a truncation: MEMFS stamps no time
  fs.unlink("/work/delete.do");
  write("to.do", text(fs.readFile("/work/from.do")));
  fs.unlink("/work/from.do");
  const read: string[] = [];
  const readFile = fs.readFile;
  fs.readFile = (p) => {
    read.push(p);
    return readFile(p);
  };
  const result = await mirror.saveRun(before);
  assert.deepEqual(changed(store.runs[0]), [
    "created new.do",
    "created to.do",
    "modified empty.do",
    "modified rewrite.do",
    "removed delete.do",
    "removed from.do",
  ]);
  assert.equal(store.runs[0].find((c) => c.path === "empty.do")!.data!.length, 0);
  assert.ok(!read.includes("/work/same.do"), "an untouched file is not read");
  assert.equal(result.files.length, 6);
  assert.equal(result.store_error, undefined);

  const idle = await mirror.saveRun(mirror.beforeRun());
  assert.deepEqual(idle, { files: [], skipped: [] });
  assert.equal(store.runs.length, 1, "a run that changed nothing does not call the store");
});

test("a write the store refused is tried again by the next run, until the page replaces the file", async () => {
  const a = record("a.do", "a", 1);
  const { mirror, store, write } = await mirrorOf({ infos: [a.info], data: [a.data] });
  let before = mirror.beforeRun();
  write("out.csv", "1");
  write("a.do", "changed");
  store.refuse = Object.assign(new Error("quota"), { name: "QuotaExceededError" });
  assert.deepEqual(await mirror.saveRun(before), { files: [], skipped: [], store_error: "quota" });

  store.refuse = null;
  before = mirror.beforeRun();
  await mirror.saveRun(before); // this run changed nothing: the refused writes go again
  assert.deepEqual(changed(store.runs[1]), ["created out.csv", "modified a.do"]);

  store.refuse = new Error("quota");
  before = mirror.beforeRun();
  write("out.csv", "2");
  write("a.do", "again");
  await mirror.saveRun(before);
  store.refuse = null;
  const page = record("out.csv", "page's", 9);
  store.resync = { paths: ["out.csv"], infos: [page.info], data: [page.data], dirs: [] };
  await mirror.sync(); // the page wrote out.csv: /work has its version, and the run's is not owed any more
  await mirror.saveRun(mirror.beforeRun());
  assert.deepEqual(changed(store.runs.at(-1)), ["modified a.do"]);
});

test("where the store has a folder, a file /work has there (a run's the store refused) goes and is not owed", async () => {
  const { mirror, store, file, write } = await mirrorOf();
  const before = mirror.beforeRun();
  write("d", "a run's file");
  store.refuse = new Error("quota");
  await mirror.saveRun(before);
  store.refuse = null;
  const page = record("d/x.do", "page's", 9);
  store.resync = { paths: ["d/x.do"], infos: [page.info], data: [page.data], dirs: [] };
  await mirror.sync();
  assert.equal(file("d")?.dir, true);
  assert.equal(text(file("d/x.do")!.data), "page's");
  const runs = store.runs.length;
  await mirror.saveRun(mirror.beforeRun());
  assert.equal(store.runs.length, runs, "nothing owed: no call");
});

test("a /work that cannot take the page's version after a run keeps the run's result and says why once", async () => {
  const { mirror, store, fs, write } = await mirrorOf();
  const before = mirror.beforeRun();
  write("out.csv", "1");
  const page = record("p.do", "page's", 9);
  store.resync = { paths: ["p.do"], infos: [page.info], data: [page.data], dirs: [] };
  fs.failWrites = true;
  const result = await mirror.saveRun(before);
  assert.deepEqual(result.files, [{ name: "out.csv", status: "created", bytes: 1 }]);
  assert.equal(result.store_error, undefined);
  assert.equal(mirror.takeOutOfStep(), "errno 54");
  assert.equal(mirror.takeOutOfStep(), null);
});

test("inRoot refuses a path outside /work", async () => {
  const { mirror } = await mirrorOf();
  assert.equal(mirror.inRoot("a/../b.dta"), "/work/b.dta");
  assert.throws(() => mirror.inRoot("../etc/x"), /not in the working folder/);
});
