// The plain logic of src/app/files/*.ts on the real store module over fake-indexeddb, no DOM: tree rows and names
// (tree.ts), opening a file (open.ts), rename, new and delete (ops.ts), and upload (upload.ts). The tabs and their
// documents are the real editor/documents.ts, with no view.

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import "fake-indexeddb/auto";
import { effect } from "@preact/signals-core";
import type { ClashAnswer, ClashFacts, Incoming } from "../src/app/files/upload.ts";

const S = await import("../src/app/state.ts");
const { store } = await import("../src/app/store.ts");
const { connectFiles, refresh } = await import("../src/app/files.ts");
const D = await import("../src/app/editor/documents.ts");
const { openFile, toBase64 } = await import("../src/app/files/open.ts");
const Ops = await import("../src/app/files/ops.ts");
const Up = await import("../src/app/files/upload.ts");
const { fileTurn } = await import("../src/app/files/turns.ts");
const T = await import("../src/app/files/tree.ts");
const { formatSize } = await import("../src/app/bytes.ts");
const { fileCommand } = await import("../src/stata/quote.ts");

const enc = (s: string) => new TextEncoder().encode(s);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const info = (path: string, size = 1, dir = false) => ({ path, dir, size, mtime: 0 });

// an edit typed in the tab `path`, as the editor's view would make it
const edit = (path: string) => D.update(path, { changes: { from: 0, insert: "edited " } });

connectFiles(store, { persisted: async () => true, persist: async () => true } as never);
store.blocked = false;

async function reset(files: Record<string, string | Uint8Array> = {}) {
  for (const f of await store.list()) if (!f.path.includes("/")) await store.remove(f.path);
  for (const [path, data] of Object.entries(files))
    await store.write(path, typeof data === "string" ? enc(data) : data);
  await refresh();
  for (const t of D.tabs.value) D.close(t.path);
  S.closeDialog();
  S.layout.value = "desktop";
  S.showPhone("files");
  S.outputTab.value = "data";
  S.closeFullSize();
  for (const b of S.banners.value) S.dismiss(b);
}
beforeEach(() => reset());

// ---- tree.ts ----

test("treeRows: folders first, then files, by name (numbers in order, case ignored); depth; a folded folder hides what is under it; a missing folder record is made up", () => {
  const files = [
    info("b.do"),
    info("A.do"),
    info("data", 0, true),
    info("data/wages.dta", 8000),
    info("data/raw", 0, true),
    info("data/raw/survey.csv"),
    info("old/x10.do"), // no record for old/
    info("old/x9.do"),
  ];
  const rows = T.treeRows(files);
  assert.deepEqual(
    rows.map((r) => [r.path, r.depth, r.dir, r.expanded]),
    [
      ["data", 0, true, true],
      ["data/raw", 1, true, true],
      ["data/raw/survey.csv", 2, false, undefined],
      ["data/wages.dta", 1, false, undefined],
      ["old", 0, true, true],
      ["old/x9.do", 1, false, undefined],
      ["old/x10.do", 1, false, undefined],
      ["A.do", 0, false, undefined],
      ["b.do", 0, false, undefined],
    ],
  );
  assert.deepEqual(
    T.treeRows(files, new Set(["data"])).map((r) => r.path),
    ["data", "old", "old/x9.do", "old/x10.do", "A.do", "b.do"],
  );
  assert.equal(T.treeRows(files, new Set(["data"]))[0].expanded, false);
});

test("names and paths: sizes, a free name, what is wrong with a new name (a control character too), tab labels, row counts", () => {
  assert.deepEqual([0, 999, 1000, 41_200, 999_499, 999_500, 1_234_567, 48_600_000, 2_500_000_000].map(formatSize), [
    "0 B",
    "999 B",
    "1 KB",
    "41 KB",
    "999 KB",
    "1.0 MB",
    "1.2 MB",
    "49 MB",
    "2.5 GB",
  ]);
  assert.equal(T.freeName("", "untitled.do", ["a.do"]), "untitled.do");
  assert.equal(T.freeName("", "untitled.do", ["untitled.do", "untitled-2.do"]), "untitled-3.do");
  assert.equal(T.freeName("data", "folder", ["data/folder"]), "data/folder-2");
  const taken = ["clean.do", "data", "data/wages.dta"];
  assert.equal(T.nameProblem("clean.do", "", taken), "clean.do already exists here.");
  assert.equal(T.nameProblem("clean.do", "", taken, "clean.do"), null, "its own name is not taken");
  assert.equal(T.nameProblem("wages.dta", "data", taken), "wages.dta already exists here.");
  assert.equal(T.nameProblem("wages.dta", "", taken), null);
  assert.equal(T.nameProblem("  ", "", taken), "Enter a name.");
  assert.match(T.nameProblem("a/b.do", "", taken) ?? "", /can't contain/);
  assert.match(T.nameProblem("..", "", taken) ?? "", /isn't allowed/);
  assert.match(T.nameProblem(".dofile", "", taken) ?? "", /dofile's own/);
  const listed = [
    { path: "clean.do", dir: false, size: 1, mtime: 0 },
    { path: "data", dir: true, size: 0, mtime: 0 },
    { path: "data/wages.dta", dir: false, size: 1, mtime: 0 },
  ];
  assert.equal(T.newPathProblem("x.do", "", listed), null);
  assert.equal(T.newPathProblem("data/x.do", "", listed), null, "a folder that exists is not 'taken'");
  assert.equal(T.newPathProblem("new/a/x.do", "", listed), null);
  assert.equal(T.newPathProblem("x.do", "data", listed), null);
  assert.equal(T.newPathProblem("data/wages.dta", "", listed), "wages.dta already exists here.");
  assert.equal(T.newPathProblem("clean.do/x.do", "", listed), "clean.do is a file, not a folder.");
  assert.equal(T.newPathProblem("a//x.do", "", listed), "Enter a name.");
  assert.equal(T.newPathProblem("x/", "", listed), "Enter a name.");
  assert.equal(T.newPathProblem("../x.do", "data", listed), "A name can't go up a folder (..).");
  assert.equal(T.newPathProblem("a/../x.do", "", listed), "A name can't go up a folder (..).");
  assert.equal(T.newPathProblem("./x.do", "", listed), "A name can't be a dot (.).");
  assert.match(T.newPathProblem(".dofile/x.do", "", listed) ?? "", /dofile's own/);
  assert.match(T.newPathProblem("a\\b.do", "", listed) ?? "", /can't contain/);
  assert.deepEqual(T.tabLabels(["a.do", "data/wages.dta", "old/wages.dta", "wages.dta"]), [
    "a.do",
    "wages.dta · data",
    "wages.dta · old",
    "wages.dta",
  ]);
  assert.equal(T.rowCount("a,b\r\n1,2\n\n3,4\n"), "3 rows");
  assert.equal(T.rowCount(`${"x\n".repeat(1204)}`), "1,204 rows");
  assert.equal(T.rowCount("x"), "1 row");
  assert.match(T.nameProblem("a\nb.do", "", taken) ?? "", /line break/);
  assert.match(T.nameProblem("a\tb.do", "", taken) ?? "", /line break/);
  assert.equal(T.movedPath("data/raw/a.csv", "data", "input"), "input/raw/a.csv");
  assert.equal(T.movedPath("database.do", "data", "input"), "database.do", "a name that only starts the same stays");
  const info = (path: string, dir = false) => ({ path, dir, size: 0, mtime: 0 });
  const kept = [info("a.do"), info("data", true), info("data/c.do"), info("pkg/m.do")];
  assert.equal(T.folderOrAbove("data", kept), "data");
  assert.equal(T.folderOrAbove("data/deep/x", kept), "data", "a folder that has gone is the nearest one above it");
  assert.equal(T.folderOrAbove("pkg", kept), "pkg", "a folder with no record of its own, with a path under it");
  assert.equal(T.folderOrAbove("a.do", kept), "", "a file is no folder");
  assert.equal(T.folderOrAbove("", kept), "");
  assert.equal(T.extOf("data/Wages.DTA"), ".dta");
  assert.equal(T.extOf(".hidden"), "");
});

// ---- open.ts ----

test("openFile: a text file gets a tab with its document, made active; opened again it is only made active", async () => {
  await reset({ "a.do": "display 1\n", "b.do": "display 2\n" });
  await openFile("a.do");
  await openFile("b.do");
  assert.deepEqual(
    D.tabs.value.map((t) => [t.path, t.kind, t.dirty]),
    [
      ["a.do", "text", false],
      ["b.do", "text", false],
    ],
  );
  assert.equal(D.activeTab.value, "b.do");
  assert.deepEqual(
    ["a.do", "b.do"].map((p) => D.textOf(p)),
    ["display 1\n", "display 2\n"],
  );
  const a = D.stateOf("a.do");
  await openFile("a.do");
  assert.equal(D.activeTab.value, "a.do");
  assert.equal(D.stateOf("a.do"), a, "an open file is not opened again");
  assert.equal(S.phoneTab.value, "files", "the desktop leaves the phone's view alone");
});

test("openFile on a phone shows the Editor view for a text or .dta tab; a .png goes to the graphs (desktop: the Graph tab; phone: full size)", async () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 250]);
  await reset({ "a.do": "x", "data/w.dta": Uint8Array.from([0x72, 0xff]), "out/g.png": png });
  S.layout.value = "phone";
  await openFile("a.do");
  assert.equal(S.phoneTab.value, "editor");
  S.showPhone("files");
  await openFile("data/w.dta");
  assert.equal(S.phoneTab.value, "editor");
  assert.deepEqual(D.tabs.value.at(-1), { path: "data/w.dta", kind: "dta", dirty: false });
  assert.equal(D.activeTab.value, "data/w.dta");
  assert.equal(D.stateOf("data/w.dta"), undefined, "a .dta tab has no document");
  S.showPhone("files");
  await openFile("out/g.png");
  assert.equal(S.graphFull.value, true);
  assert.equal(S.phoneTab.value, "files", "a graph is no tab");
  const g = S.graphs.value.at(-1)!;
  assert.deepEqual([g.from, g.path, g.png], ["file", "out/g.png", Buffer.from(png).toString("base64")]);
  S.layout.value = "desktop";
  S.closeFullSize();
  await openFile("out/g.png");
  assert.equal(S.outputTab.value, "graph");
  assert.equal(S.graphFull.value, false);
  assert.equal(D.tabs.value.length, 2);
});

test("toBase64 takes a large file in chunks", () => {
  const big = new Uint8Array(200_000).map((_, i) => i * 7);
  assert.equal(toBase64(big), Buffer.from(big).toString("base64"));
});

test("openFile: a file that isn't UTF-8 opens no tab and shows the not-text banner, one at a time", async () => {
  await reset({
    "survey.xlsx": Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0xff, 0xfe]),
    "b.xls": Uint8Array.from([0xd0]),
  });
  await openFile("survey.xlsx");
  assert.deepEqual(D.tabs.value, []);
  assert.deepEqual(S.banners.value, [{ b: "not-text", path: "survey.xlsx" }]);
  await openFile("b.xls");
  assert.deepEqual(S.banners.value, [{ b: "not-text", path: "b.xls" }]);
  await openFile("gone.do"); // not in the store: nothing happens
  assert.deepEqual(D.tabs.value, []);
});

// ---- tabs ----

test("closing a tab: one with no edits closes (the next tab becomes active; its document goes); one with unsaved edits asks", async () => {
  await reset({ "a.do": "1", "b.do": "2", "c.do": "3" });
  for (const p of ["a.do", "b.do", "c.do"]) await openFile(p);
  D.activate("b.do");
  assert.equal(D.askClose("b.do"), true);
  assert.equal(D.activeTab.value, "c.do", "the tab to the right");
  assert.equal(D.stateOf("b.do"), undefined);
  D.close("c.do");
  assert.equal(D.activeTab.value, "a.do", "the last tab: the one to the left");
  edit("a.do"); // no editor here: the test makes the edits
  assert.equal(D.askClose("a.do"), false);
  assert.deepEqual(S.dialog.value, { d: "close-tab", path: "a.do" });
  assert.deepEqual(
    D.tabs.value.map((t) => t.path),
    ["a.do"],
  );
  assert.equal(D.textOf("a.do"), "edited 1", "asked: the document stays");
  D.close("a.do"); // the dialog's "Don't save"
  assert.equal(D.activeTab.value, null);
  assert.equal(D.stateOf("a.do"), undefined);
});

// ---- ops.ts: rename, new, delete ----

test("rename: an open file, and a folder with open files under it: the tabs follow, each with its document", async () => {
  await reset({ "a.do": "1", "data/x.do": "2", "data/raw/y.csv": "3", "database.do": "4" });
  for (const p of ["a.do", "data/x.do", "data/raw/y.csv", "database.do"]) await openFile(p);
  D.activate("data/raw/y.csv");
  await Ops.renameEntry("data", "input");
  assert.deepEqual(
    D.tabs.value.map((t) => t.path),
    ["a.do", "input/x.do", "input/raw/y.csv", "database.do"],
  );
  assert.equal(D.activeTab.value, "input/raw/y.csv");
  assert.deepEqual(
    ["input/x.do", "input/raw/y.csv", "data/x.do", "data/raw/y.csv"].map((p) => D.textOf(p)),
    ["2", "3", null, null],
  );
  await Ops.renameEntry("a.do", "b.do");
  assert.equal(D.tabs.value[0].path, "b.do");
  await assert.rejects(Ops.renameEntry("b.do", "database.do"), /already exists/);
  assert.equal(D.tabs.value[0].path, "b.do", "a refused rename changes no tab");
  await refresh();
  assert.ok(S.files.value.some((f) => f.path === "input/raw/y.csv"));
});

test("rename: the last run and the log's run heads follow the file (Go to line opens the renamed file); a file that cannot be read gives a toast", async () => {
  await reset({ "a.do": "1", "data/x.do": "2" });
  const run = (path: string): import("../src/app/types.ts").LastRun => ({
    kind: "file",
    path,
    fresh_locals: true,
    rc: 111,
    line: 1,
    seconds: 0,
  });
  S.runWriter.lastRun.value = run("data/x.do");
  S.runWriter.log.value = [
    { t: "head" },
    { t: "runhead", run: { kind: "file", path: "data/x.do", fresh_locals: true }, first: true },
    { t: "text", text: "", run: 1, end: run("data/x.do") },
    { t: "runhead", run: { kind: "file", path: "a.do", fresh_locals: true }, first: false },
    { t: "runhead", run: { kind: "command", fresh_locals: false }, first: false },
  ];
  await Ops.renameEntry("data", "input");
  assert.equal(S.lastRun.value?.path, "input/x.do");
  const paths = () => S.log.value.map((i) => (i.t === "runhead" ? i.run.path : i.t === "text" ? i.end?.path : null));
  assert.deepEqual(paths(), [null, "input/x.do", "input/x.do", "a.do", undefined]);
  S.runWriter.lastRun.value = run("a.do");
  await Ops.renameEntry("a.do", "b.do");
  assert.equal(S.lastRun.value?.path, "b.do");
  await openFile("b.do");
  assert.equal(D.activeTab.value, "b.do");
  D.close("b.do");
  S.showToast("");
  await openFile("a.do");
  assert.match(S.toast.value ?? "", /a\.do/);
});

test("fileTurn (the editor's Save): a turn taken while a rename or a delete is in progress sees the tabs they left; a refused one does not stop the next", async () => {
  await reset({ "a.do": "1", "b.do": "2" });
  for (const p of ["a.do", "b.do"]) await openFile(p);
  const tabsNow = () => D.tabs.value.map((t) => t.path);
  const renaming = Ops.renameEntry("a.do", "c.do");
  // a turn that reads the tabs after a store call of its own (a body with no yield is a lint error)
  const turnOf = <T>(f: () => T) =>
    fileTurn(function* (io) {
      yield* io.list();
      return f();
    });
  const seen = turnOf(tabsNow);
  await renaming;
  assert.deepEqual(await seen, ["c.do", "b.do"], "the tab has its new name when the turn comes");
  const deleting = Ops.deleteEntries(["b.do"]);
  assert.deepEqual(await turnOf(tabsNow), ["c.do"], "and the deleted file's tab is closed");
  await deleting;
  const refused = Ops.renameEntry("c.do", "c.do/x");
  const after = turnOf(() => "next");
  await assert.rejects(refused);
  assert.equal(await after, "next");
});

test("a new .do file and a new folder take the name asked for or the first free one, and never replace a file; delete closes the tabs under the path; delete all empties the store", async () => {
  await reset({ "untitled.do": "keep", "a.do": "mine" });
  assert.equal(await Ops.createEntry("file"), "untitled-2.do");
  assert.equal(await Ops.createEntry("folder"), "folder");
  assert.equal(await Ops.createEntry("folder"), "folder-2");
  assert.equal(await Ops.createEntry("file", "", "clean.do"), "clean.do");
  assert.equal(await Ops.createEntry("folder", "", "data"), "data");
  assert.equal(await Ops.createEntry("file", "data", "b.do"), "data/b.do");
  await assert.rejects(Ops.createEntry("file", "", "a.do"), /already exists/);
  await assert.rejects(Ops.createEntry("folder", "", "a.do"), /already exists/);
  assert.equal(
    new TextDecoder().decode(await store.read("a.do")),
    "mine",
    "a name in use is refused, not written over",
  );
  const both = await Promise.all([Ops.createEntry("file"), Ops.createEntry("file")]);
  assert.deepEqual(
    both,
    ["untitled-3.do", "untitled-4.do"],
    "two started together take turns: neither takes the other's name",
  );
  await store.remove("data");
  await store.write("data/x.do", enc("1"));
  await store.write("data/y.do", enc("2"));
  await store.write("survey.xlsx", Uint8Array.from([0xff]));
  for (const p of ["data/x.do", "untitled.do", "data/y.do"]) await openFile(p);
  await openFile("survey.xlsx");
  await Ops.deleteEntries(["data"]);
  assert.deepEqual(
    D.tabs.value.map((t) => t.path),
    ["untitled.do"],
  );
  assert.deepEqual(
    ["data/x.do", "data/y.do"].map((p) => D.stateOf(p)),
    [undefined, undefined],
  );
  await Ops.deleteEntries(["survey.xlsx"]);
  assert.deepEqual(S.banners.value, [], "a deleted file's not-text banner goes");
  await Ops.deleteAll();
  assert.deepEqual(await store.list(), []);
  assert.deepEqual(D.tabs.value, []);
});

test("a folder's Download (.zip): every file and folder under it, named under the folder, nothing else", async () => {
  await reset({ "data/raw/a.csv": "1,2\n", "data/w.dta": "x", "other.do": "y" });
  const zip = await Ops.zipFolder("data/raw");
  assert.equal(zip.name, "raw.zip");
  const text = Buffer.from(await zip.arrayBuffer()).toString("latin1");
  assert.ok(text.includes("raw/a.csv") && text.includes("raw/"));
  assert.ok(!text.includes("data/") && !text.includes("other.do") && !text.includes("w.dta"));
  const all = Buffer.from(await (await Ops.zipFolder("data")).arrayBuffer()).toString("latin1");
  assert.ok(all.includes("data/raw/a.csv") && all.includes("data/w.dta") && !all.includes("other.do"));
});

// ---- upload.ts: upload and its clashes ----

/** Answer each clash dialog as it opens, in order; records what each showed. */
function answering(answers: ClashAnswer[]) {
  const seen: { dialog: unknown; now: ClashFacts | null; inStore: string[] }[] = [];
  const stop = effect(() => {
    const d = S.dialog.value;
    if (d?.d !== "clash") return;
    const now = Up.clashNow();
    store.list().then((l) => {
      seen.push({ dialog: d, now, inStore: l.map((f) => f.path).sort() });
      S.closeDialog();
      Up.answerClash(answers.shift() ?? "stop");
    });
  });
  return { seen, stop };
}
const textOf = async (path: string) => new TextDecoder().decode(await store.read(path));

test("upload with no clash: every file written, folders kept, then the toast", async () => {
  const written = await Up.upload([
    { path: "a.do", data: enc("1") },
    { path: "pkg/data/b.csv", data: enc("2") },
  ]);
  assert.deepEqual(written, ["a.do", "pkg/data/b.csv"]);
  assert.equal(S.toast.value, "2 files uploaded");
  await Up.upload([{ path: "c.do", data: enc("3") }]);
  assert.equal(S.toast.value, "1 file uploaded");
  assert.equal(S.dialog.value, null);
});

test("upload with clashes: the others are written first; each clash asks, Keep mine, Replace, and Do the same for the rest", async () => {
  await reset({ "a.do": "old a", "b.do": "old b", "c.do": "old c", "d.do": "old d" });
  const { seen, stop } = answering([
    { replace: false, isForRest: false }, // a: keep (Enter)
    { replace: true, isForRest: false }, // b: replace
    { replace: true, isForRest: true }, // c: replace, and d the same without asking
  ]);
  await Up.upload(["a", "b", "new", "c", "d"].map((n) => ({ path: `${n}.do`, data: enc(`new ${n}`) })));
  stop();
  assert.deepEqual(
    seen.map((s) => s.dialog),
    [
      { d: "clash", path: "a.do", index: 1, total: 4 },
      { d: "clash", path: "b.do", index: 2, total: 4 },
      { d: "clash", path: "c.do", index: 3, total: 4 },
    ],
  );
  assert.ok(seen[0].inStore.includes("new.do"), "the file that clashes with none is written before the first question");
  assert.deepEqual(
    { ...seen[0].now, yours: { ...seen[0].now!.yours, mtime: 0 } },
    {
      path: "a.do",
      yours: { size: 5, mtime: 0 },
      uploadedBytes: 5,
      unaskedCount: 1,
      remainingCount: 3,
      hasUnsavedEdits: false,
      changedWhileAsked: false,
      words: Up.WORDS.upload,
    },
  );
  assert.deepEqual(await Promise.all(["a", "b", "c", "d", "new"].map((n) => textOf(`${n}.do`))), [
    "old a",
    "new b",
    "new c",
    "new d",
    "new new",
  ]);
  assert.equal(S.toast.value, "4 files uploaded");
  assert.equal(S.dialog.value, null);
  assert.equal(Up.clashNow(), null);
});

test("upload: a clash with the same bytes is not asked and not written, and counts as uploaded; the clashes left are numbered without it", async () => {
  await reset({ "a.do": "same a", "b.do": "old b", "c.do": "old c" });
  const before = (await store.list()).find((f) => f.path === "a.do")!;
  const { seen, stop } = answering([
    { replace: true, isForRest: false },
    { replace: false, isForRest: false },
  ]);
  const written = await Up.upload([
    { path: "a.do", data: enc("same a") },
    { path: "b.do", data: enc("new b") },
    { path: "new.do", data: enc("n") },
    { path: "c.do", data: enc("new c") },
  ]);
  stop();
  assert.deepEqual(
    seen.map((s) => s.dialog),
    [
      { d: "clash", path: "b.do", index: 1, total: 2 },
      { d: "clash", path: "c.do", index: 2, total: 2 },
    ],
  );
  assert.deepEqual(
    [seen[0].now?.unaskedCount, seen[0].now?.remainingCount],
    [2, 1],
    "the same file is one of the others: in place",
  );
  assert.deepEqual(written.sort(), ["b.do", "new.do"], "only what was written");
  assert.equal((await store.list()).find((f) => f.path === "a.do")!.mtime, before.mtime, "a.do was not written");
  assert.equal(S.toast.value, "3 files uploaded", "a.do counts: the store holds what was uploaded");
  // all identical: nothing asked, the toast still says so
  await Up.upload([{ path: "a.do", data: enc("same a") }]);
  assert.equal(S.toast.value, "1 file uploaded");
  assert.equal(S.dialog.value, null);
});

test("upload: a clash with the same bytes but open with unsaved edits is still asked; a clean open one is not, and not reloaded", async () => {
  await reset({ "a.do": "same a", "b.do": "same b" });
  await openFile("a.do");
  await openFile("b.do");
  edit("a.do");
  const b = D.stateOf("b.do");
  const { seen, stop } = answering([{ replace: true, isForRest: false }]);
  await Up.upload(["a", "b"].map((n) => ({ path: `${n}.do`, data: enc(`same ${n}`) })));
  stop();
  assert.deepEqual(
    seen.map((s) => [s.dialog, s.now?.hasUnsavedEdits]),
    [[{ d: "clash", path: "a.do", index: 1, total: 1 }, true]],
  );
  assert.deepEqual(
    [D.textOf("a.do"), D.tabs.value[0].dirty, D.stateOf("b.do") === b],
    ["same a", false, true],
    "Replace drops the edits; b.do, clean and identical, is left as it is",
  );
});

test("upload with the sample's words: the dialog's words, 'Sample restored', 'The sample is already here' when nothing was written or asked, and nothing said when all asked were kept", async () => {
  await reset({ "a.do": "old a", "b.do": "same b" });
  const { seen, stop } = answering([{ replace: false, isForRest: false }]);
  S.showToast("sentinel"); // the toast is not cleared by hand: what an upload says replaces it
  await Up.upload(
    [
      { path: "a.do", data: enc("new a") },
      { path: "b.do", data: enc("same b") },
    ],
    "sample",
  );
  assert.equal(seen[0].now?.words, Up.WORDS.sample);
  assert.equal(seen.length, 1, "b.do holds the sample's bytes: not asked");
  assert.equal(S.toast.value, "sentinel", "everything asked was kept, and nothing was written: no toast");
  assert.equal(await textOf("a.do"), "old a");
  // the visitor replaces
  stop();
  const again = answering([{ replace: true, isForRest: false }]);
  await Up.upload([{ path: "a.do", data: enc("new a") }], "sample");
  again.stop();
  assert.equal(S.toast.value, "Sample restored");
  // nothing to write, nothing to ask
  await Up.upload(
    [
      { path: "a.do", data: enc("new a") },
      { path: "b.do", data: enc("same b") },
    ],
    "sample",
  );
  assert.equal(S.toast.value, "The sample is already here");
  // a file the store refuses
  const warn = console.warn;
  console.warn = () => {};
  try {
    await Up.upload([{ path: "a.do/x", data: enc("1") }], "sample");
  } finally {
    console.warn = warn;
  }
  assert.equal(S.toast.value, "Couldn't restore the sample");
});

test("upload: Esc keeps yours for every clash left and asks no more; Keep mine with Do the same keeps the rest too", async () => {
  await reset({ "a.do": "old a", "b.do": "old b", "c.do": "old c" });
  let { seen, stop } = answering(["stop"]);
  await Up.upload(["a", "b", "c", "x"].map((n) => ({ path: `${n}.do`, data: enc(`new ${n}`) })));
  stop();
  assert.equal(seen.length, 1);
  assert.deepEqual(await Promise.all(["a", "b", "c", "x"].map((n) => textOf(`${n}.do`))), [
    "old a",
    "old b",
    "old c",
    "new x",
  ]);
  assert.equal(S.toast.value, "1 file uploaded");
  ({ seen, stop } = answering([{ replace: false, isForRest: true }]));
  await Up.upload(["a", "b"].map((n) => ({ path: `${n}.do`, data: enc(`new ${n}`) })));
  stop();
  assert.equal(seen.length, 1);
  assert.deepEqual(await Promise.all(["a", "b"].map((n) => textOf(`${n}.do`))), ["old a", "old b"]);
});

test("upload over an open file: the clash says it has unsaved edits; Replace reloads it in the editor; one no longer text closes its tab", async () => {
  await reset({ "a.do": "old a", "b.do": "old b" });
  await openFile("a.do");
  await openFile("b.do");
  edit("a.do"); // no editor here: the test makes the edits
  const { seen, stop } = answering([
    { replace: true, isForRest: false },
    { replace: true, isForRest: false },
  ]);
  await Up.upload([
    { path: "a.do", data: enc("new a") },
    { path: "b.do", data: Uint8Array.from([0xff, 0xfe]) },
  ]);
  stop();
  assert.equal(seen[0].now?.hasUnsavedEdits, true);
  assert.equal(seen[1].now?.hasUnsavedEdits, false);
  assert.deepEqual([D.textOf("a.do"), D.tabs.value[0].dirty, D.stateOf("b.do")], ["new a", false, undefined]);
  assert.deepEqual(
    D.tabs.value.map((t) => t.path),
    ["a.do"],
  );
});

test("upload: a file the store refuses is counted in the toast; a path given twice is written once (the last)", async () => {
  await reset({ "data/x.do": "1" });
  const warn = console.warn;
  console.warn = () => {};
  try {
    await Up.upload([
      { path: "data", data: enc("a file where a folder is") },
      { path: "y.do", data: enc("first") },
      { path: "y.do", data: enc("second") },
    ]);
  } finally {
    console.warn = warn;
  }
  assert.equal(S.toast.value, "1 file uploaded · 1 failed");
  assert.equal(await textOf("y.do"), "second");
  await sleep(0);
});

// ---- stata/quote.ts: a path in a command ----

test("a path in the use and import commands: quoted, compound quotes for a double quote, $ escaped; a backquote, a line break or \"' gives a reason, no command", () => {
  assert.deepEqual(fileCommand("use", "data/wages.dta"), { command: 'use "data/wages.dta", clear' });
  assert.deepEqual(fileCommand("import delimited", "raw/survey.csv"), {
    command: 'import delimited "raw/survey.csv", clear',
  });
  assert.deepEqual(fileCommand("use", 'data/a"b.dta'), { command: 'use `"data/a"b.dta"\', clear' });
  assert.deepEqual(fileCommand("use", "wages_$final.dta"), { command: 'use "wages_\\$final.dta", clear' });
  assert.deepEqual(fileCommand("use", 'a"$x.dta'), { command: 'use `"a"\\$x.dta"\', clear' });
  for (const bad of ["a`x'.dta", 'x.csv", clear\nerase main.do\n*.csv', "a\rb.dta", "a\tb.dta", "a\"'b.dta"])
    assert.ok("problem" in fileCommand("use", bad), JSON.stringify(bad));
  const made = fileCommand("import delimited", "a`b'.csv");
  assert.equal("problem" in made && made.problem, "Its name has a character a command can't use: rename the file.");
});

test("uploads apply in the order of the calls, a read that ends later included (two quick drops of one path); a failed read rejects its upload and the next goes on", async () => {
  await reset({});
  let endFirstRead = (_items: Incoming[]) => {};
  const firstRead = new Promise<Incoming[]>((resolve) => {
    endFirstRead = resolve;
  });
  const { seen, stop } = answering([{ replace: true, isForRest: false }]);

  const first = Up.upload(firstRead);
  const second = Up.upload(Promise.resolve([{ path: "a.do", data: enc("second drop") }]));
  endFirstRead([{ path: "a.do", data: enc("first") }]);
  await Promise.all([first, second]);
  stop();

  assert.deepEqual(
    seen.map((s) => s.now?.uploadedBytes),
    [11],
    "the second upload is the one asked about",
  );
  assert.equal(await textOf("a.do"), "second drop");

  await assert.rejects(Up.upload(Promise.reject(new Error("unreadable"))), /unreadable/);
  await Up.upload([{ path: "b.do", data: enc("b") }]);
  assert.equal(await textOf("b.do"), "b");
});

// ---- upload.ts: the clash flow with other dialogs and other uploads ----

const until = async (ok: () => boolean, what: string) => {
  for (let i = 0; i < 200 && !ok(); i++) await sleep(5);
  assert.ok(ok(), what);
};
const clashOf = () => (S.dialog.value?.d === "clash" ? S.dialog.value.path : null);
/** The clash dialog's answer, as ClashDialog gives it: it closes, then answers. */
const give = (a: ClashAnswer) => {
  S.closeDialog();
  Up.answerClash(a);
};

test("a second upload waits for the first: it writes nothing and asks nothing until the first has ended", async () => {
  await reset({ "a.do": "old a", "b.do": "old b" });
  const first = Up.upload([{ path: "a.do", data: enc("new a") }]);
  await until(() => clashOf() === "a.do", "the first upload asks");
  const second = Up.upload([
    { path: "b.do", data: enc("new b") },
    { path: "z.do", data: enc("z") },
  ]);
  await sleep(30);
  assert.equal(clashOf(), "a.do", "the second does not replace the first's question");
  assert.ok(!(await store.list()).some((f) => f.path === "z.do"), "nor write anything before the first has ended");
  give({ replace: true, isForRest: false });
  assert.deepEqual(await first, ["a.do"]);
  await until(() => clashOf() === "b.do", "then the second asks");
  give({ replace: false, isForRest: false });
  assert.deepEqual(await second, ["z.do"]);
  assert.equal(S.toast.value, "1 file uploaded");
  assert.deepEqual(await Promise.all(["a.do", "b.do"].map(textOf)), ["new a", "old b"]);
  assert.equal(S.dialog.value, null);
});

test("a clash never replaces another dialog: it waits until that one has closed", async () => {
  await reset({ "a.do": "old a" });
  S.openDialog({ d: "download" });
  const done = Up.upload([{ path: "a.do", data: enc("new a") }]);
  await sleep(30);
  assert.deepEqual(S.dialog.value, { d: "download" });
  S.closeDialog();
  await until(() => clashOf() === "a.do", "the clash is asked once the other dialog has closed");
  give("stop");
  assert.deepEqual(await done, []);
  assert.equal(S.dialog.value, null);
});

test("another dialog put in the clash's place with no answer keeps yours for every clash left, and the next upload runs", async () => {
  await reset({ "a.do": "old a", "b.do": "old b" });
  const done = Up.upload(["a", "b", "y"].map((n) => ({ path: `${n}.do`, data: enc(`new ${n}`) })));
  await until(() => clashOf() === "a.do", "the clash is asked");
  S.openDialog({ d: "other-tab" }); // as the engine controller does when another tab takes the engine
  assert.deepEqual(await done, ["y.do"]);
  assert.deepEqual(S.dialog.value, { d: "other-tab" }, "the upload's end leaves the other dialog open");
  assert.deepEqual(await Promise.all(["a", "b"].map((n) => textOf(`${n}.do`))), ["old a", "old b"]);
  S.closeDialog();
  assert.deepEqual(await Up.upload([{ path: "z.do", data: enc("z") }]), ["z.do"], "a later upload is not held up");
});

test("after Do the same with Replace, a clash over an open file with unsaved edits is still asked", async () => {
  await reset({ "a.do": "old a", "b.do": "old b", "c.do": "old c" });
  await openFile("b.do");
  edit("b.do"); // no editor here: the test makes the edits
  const { seen, stop } = answering([
    { replace: true, isForRest: true }, // a: replace, and the rest the same
    { replace: false, isForRest: false }, // b: asked all the same, as it has unsaved edits: keep it
  ]);
  await Up.upload(["a", "b", "c"].map((n) => ({ path: `${n}.do`, data: enc(`new ${n}`) })));
  stop();
  assert.deepEqual(
    seen.map((x) => [(x.dialog as { path: string }).path, x.now?.hasUnsavedEdits]),
    [
      ["a.do", false],
      ["b.do", true],
    ],
  );
  assert.deepEqual(await Promise.all(["a", "b", "c"].map((n) => textOf(`${n}.do`))), ["new a", "old b", "new c"]);
});

test("after Esc, or Do the same with Keep mine, a clash over a file with unsaved edits is not asked: it is kept", async () => {
  for (const first of ["stop", { replace: false, isForRest: true }] as ClashAnswer[]) {
    await reset({ "a.do": "old a", "b.do": "old b" });
    await openFile("b.do");
    edit("b.do");
    const { seen, stop } = answering([first, { replace: true, isForRest: false }]);
    const done = await Up.upload(["a", "b", "y"].map((n) => ({ path: `${n}.do`, data: enc(`new ${n}`) })));
    stop();
    assert.deepEqual(
      seen.map((x) => (x.dialog as { path: string }).path),
      ["a.do"],
      `${JSON.stringify(first)}: one question`,
    );
    assert.deepEqual(done, ["y.do"]);
    assert.deepEqual(await Promise.all(["a", "b"].map((n) => textOf(`${n}.do`))), ["old a", "old b"]);
    assert.equal(S.dialog.value, null);
  }
});

test("another dialog put in the place of a clash, with an unsaved file's clash after it: the upload ends at once and the next one runs", {
  timeout: 10_000, // the bug this guards against left the upload waiting for ever
}, async () => {
  await reset({ "a.do": "old a", "b.do": "old b" });
  await openFile("b.do");
  edit("b.do");
  const done = Up.upload(["a", "b", "y"].map((n) => ({ path: `${n}.do`, data: enc(`new ${n}`) })));
  await until(() => clashOf() === "a.do", "the clash is asked");
  S.openDialog({ d: "other-tab" }); // another tab took the engine
  assert.deepEqual(await done, ["y.do"], "it does not wait for the other dialog to ask about b.do");
  assert.deepEqual(S.dialog.value, { d: "other-tab" });
  assert.deepEqual(await Up.upload([{ path: "z.do", data: enc("z") }]), ["z.do"], "a later upload runs");
  S.closeDialog();
  await sleep(30);
  assert.equal(S.dialog.value, null, "no clash is asked once the other dialog has closed");
  assert.deepEqual(await Promise.all(["a", "b"].map((n) => textOf(`${n}.do`))), ["old a", "old b"]);
});

test("upload: a name with a control character is refused and counted", async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual(
      await Up.upload([
        { path: "ok.do", data: enc("1") },
        { path: "x.csv\nerase ok.do", data: enc("2") },
      ]),
      ["ok.do"],
    );
  } finally {
    console.warn = warn;
  }
  assert.equal(S.toast.value, "1 file uploaded · 1 failed");
  assert.deepEqual(
    (await store.list()).map((f) => f.path),
    ["ok.do"],
  );
});

// ---- upload.ts: an upload against the other file changes (each of its writes takes a turn) ----

test("a new file and an upload of the same name: the new file's turn comes first and the upload asks, so neither replaces the other unasked", async () => {
  const { list, write } = store;
  let wrote = () => {};
  const uploadWrote = new Promise<void>((ok) => {
    wrote = ok;
  });
  store.write = (...args: Parameters<typeof write>) => {
    const w = write.apply(store, args);
    if (args[0] === "a.do" && args[1].byteLength) wrote();
    return w;
  };
  // the first list made answers once the upload has written, or after 100 ms when the upload waits for its turn
  store.list = async () => {
    const l = await list.call(store);
    store.list = list;
    await Promise.race([uploadWrote, sleep(100)]);
    return l;
  };
  const { seen, stop } = answering([{ replace: true, isForRest: false }]);
  try {
    const made = Ops.createEntry("file", "", "a.do");
    const up = Up.upload([{ path: "a.do", data: enc("uploaded") }]);
    await Promise.allSettled([made, up]);
  } finally {
    stop();
    store.list = list;
    store.write = write;
  }
  assert.equal(await textOf("a.do"), "uploaded", "the upload's bytes are not replaced by the new empty file");
  assert.deepEqual(
    seen.map((s) => (s.dialog as { path: string }).path),
    ["a.do"],
    "the upload asks about the new file",
  );
});

test("a clash whose file was saved again while its dialog was open: Replace writes nothing and asks again, with the file's new size; a later clash shows its file as it is when asked; one deleted while asked is written unasked", async () => {
  await reset({ "a.do": "old a", "b.do": "old b", "c.do": "old c" });
  const done = Up.upload(["a", "b", "c"].map((n) => ({ path: `${n}.do`, data: enc(`new ${n}`) })));
  await until(() => clashOf() === "a.do", "a is asked");
  await fileTurn(function* (io) {
    yield* io.write("a.do", enc("saved again a")); // 13 bytes
    yield* io.write("b.do", enc("saved again, b")); // 14 bytes
  });
  give({ replace: true, isForRest: false });
  await until(() => clashOf() === "a.do" && Up.clashNow()?.changedWhileAsked === true, "a is asked again");
  assert.equal(await textOf("a.do"), "saved again a", "nothing written before the second answer");
  assert.equal(Up.clashNow()?.yours?.size, 13);
  assert.equal(Up.WORDS.upload.changedTitle("data/wages.dta"), "data/wages.dta changed while you were deciding");
  assert.equal(
    Up.WORDS.upload.changedQuestion,
    "It was saved again since you were asked. Keep yours, or replace it with the uploaded one?",
  );
  give({ replace: true, isForRest: false });
  await until(() => clashOf() === "b.do", "then b is asked");
  assert.equal(Up.clashNow()?.yours?.size, 14, "b as it is now, not as the upload first listed it");
  assert.equal(Up.clashNow()?.changedWhileAsked, false);
  give({ replace: false, isForRest: false });
  await until(() => clashOf() === "c.do", "then c is asked");
  await store.remove("c.do");
  give({ replace: true, isForRest: false });
  assert.deepEqual(await done, ["a.do", "c.do"]);
  assert.equal(S.dialog.value, null);
  assert.deepEqual(await Promise.all(["a", "b", "c"].map((n) => textOf(`${n}.do`))), [
    "new a",
    "saved again, b",
    "new c",
  ]);
});

test("after Do the same with Replace, a clash whose file was saved again while asked is asked again; the clashes after it are replaced unasked", async () => {
  await reset({ "a.do": "old a", "b.do": "old b" });
  const done = Up.upload(["a", "b"].map((n) => ({ path: `${n}.do`, data: enc(`new ${n}`) })));
  await until(() => clashOf() === "a.do", "a is asked");
  await fileTurn(function* (io) {
    yield* io.write("a.do", enc("saved again a"));
  });
  give({ replace: true, isForRest: true });
  await until(() => clashOf() === "a.do" && Up.clashNow()?.changedWhileAsked === true, "a is asked again");
  give({ replace: true, isForRest: false });
  assert.deepEqual(await done, ["a.do", "b.do"]);
  assert.deepEqual(await Promise.all(["a", "b"].map((n) => textOf(`${n}.do`))), ["new a", "new b"]);
});

test("after Do the same with Replace, a clash over an open file edited before its write's turn is asked in the unsaved words, not replaced", async () => {
  await reset({ "a.do": "old a", "b.do": "old b" });
  await openFile("b.do");
  const { write, read } = store;
  let release = () => {};
  const held = new Promise<Uint8Array<ArrayBuffer>>((ok) => {
    release = () => ok(new Uint8Array(0));
  });
  store.read = (path) => (path === "held" ? held : read.call(store, path));
  store.write = (...args: Parameters<typeof write>) => {
    if (args[0] === "a.do") {
      // a turn holds the chain once a.do is written; b.do is edited while b.do's write waits behind it
      fileTurn(function* (io) {
        yield* io.read("held");
      });
      setTimeout(() => {
        edit("b.do");
        release();
      }, 10);
    }
    return write.apply(store, args);
  };
  const { seen, stop } = answering([
    { replace: true, isForRest: true },
    { replace: false, isForRest: false },
  ]);
  try {
    assert.deepEqual(await Up.upload(["a", "b"].map((n) => ({ path: `${n}.do`, data: enc(`new ${n}`) }))), ["a.do"]);
  } finally {
    stop();
    store.write = write;
    store.read = read;
  }
  assert.deepEqual(
    seen.map((x) => [(x.dialog as { path: string }).path, x.now?.hasUnsavedEdits]),
    [
      ["a.do", false],
      ["b.do", true],
    ],
  );
  assert.equal(await textOf("b.do"), "old b");
  assert.equal(D.textOf("b.do"), "edited old b", "the edits are kept");
});

test("after Do the same with Replace, a clash whose file is saved again before its write's turn is asked again", async () => {
  await reset({ "a.do": "old a", "b.do": "old b" });
  const { write } = store;
  let once = false;
  store.write = (...args: Parameters<typeof write>) => {
    const w = write.apply(store, args);
    if (args[0] === "a.do" && !once) {
      once = true;
      fileTurn(function* (io) {
        yield* io.write("b.do", enc("saved again b")); // a Save of b.do, after the answer and before b.do's turn
      });
    }
    return w;
  };
  const { seen, stop } = answering([
    { replace: true, isForRest: true },
    { replace: true, isForRest: false },
  ]);
  try {
    assert.deepEqual(await Up.upload(["a", "b"].map((n) => ({ path: `${n}.do`, data: enc(`new ${n}`) }))), [
      "a.do",
      "b.do",
    ]);
  } finally {
    stop();
    store.write = write;
  }
  assert.deepEqual(
    seen.map((x) => [(x.dialog as { path: string }).path, x.now?.changedWhileAsked, x.now?.yours?.size]),
    [
      ["a.do", false, 5],
      ["b.do", true, 13],
    ],
  );
  assert.equal(await textOf("b.do"), "new b");
});

test("an upload's Replace of a file whose opening reads the store: the tab ends with what the store ends with", async () => {
  await reset({ "a.do": "old a" });
  const done = Up.upload([{ path: "a.do", data: enc("new a") }]);
  await until(() => clashOf() === "a.do", "a is asked");
  let ended = false;
  done.then(() => {
    ended = true;
  });
  const { read } = store;
  // the opening's read answers once the upload has ended, or after 100 ms when the upload waits for its turn
  store.read = async (path) => {
    const bytes = await read.call(store, path);
    if (path === "a.do") {
      store.read = read;
      for (let i = 0; i < 20 && !ended; i++) await sleep(5);
    }
    return bytes;
  };
  try {
    const opening = openFile("a.do");
    give({ replace: true, isForRest: false });
    await Promise.all([done, opening]);
  } finally {
    store.read = read;
  }
  assert.equal(await textOf("a.do"), "new a");
  assert.equal(D.textOf("a.do"), "new a", "the tab shows the store's text");
  assert.equal(D.tabs.value.find((t) => t.path === "a.do")?.dirty, false);
});

test("a clash whose file left the store while its tab kept unsaved edits is asked in the unsaved words, with no Yours part, even after Do the same with Replace; Keep mine keeps the edits", async () => {
  await reset({ "a.do": "old a", "b.do": "old b" });
  await openFile("b.do");
  edit("b.do");
  const done = Up.upload(["a", "b"].map((n) => ({ path: `${n}.do`, data: enc(`new ${n}`) })));
  await until(() => clashOf() === "a.do", "a is asked");
  await store.remove("b.do"); // as a run's erase b.do does: the dirty tab stays (files.ts afterRun)
  give({ replace: true, isForRest: true });
  await until(() => clashOf() === "b.do", "b is asked, not written or tried again without end");
  assert.equal(Up.clashNow()?.hasUnsavedEdits, true);
  assert.equal(Up.clashNow()?.yours, null);
  give({ replace: false, isForRest: false });
  assert.deepEqual(await done, ["a.do"]);
  assert.deepEqual(
    (await store.list()).map((f) => f.path),
    ["a.do"],
  );
  assert.equal(D.textOf("b.do"), "edited old b");
});

test("a clash waits again for a dialog opened while its file was read: it never replaces one", async () => {
  await reset({ "a.do": "old a", "b.do": "old b" });
  const done = Up.upload(["a", "b"].map((n) => ({ path: `${n}.do`, data: enc(`new ${n}`) })));
  await until(() => clashOf() === "a.do", "a is asked");
  const { read } = store;
  let release = () => {};
  const held = new Promise<Uint8Array<ArrayBuffer>>((ok) => {
    release = () => ok(new Uint8Array(0));
  });
  store.read = (path) => (path === "held" ? held : read.call(store, path));
  fileTurn(function* (io) {
    yield* io.read("held"); // b.do's read of its file waits behind this turn
  });
  try {
    give({ replace: false, isForRest: false });
    await sleep(10);
    S.openDialog({ d: "delete", paths: ["x.do"] });
    release();
    await sleep(30);
    assert.deepEqual(S.dialog.value, { d: "delete", paths: ["x.do"] }, "the other dialog stays");
  } finally {
    store.read = read;
  }
  S.closeDialog();
  await until(() => clashOf() === "b.do", "b is asked once it has closed");
  give("stop");
  assert.deepEqual(await done, []);
});

// ---- ops.ts: a rename that changes how the file opens ----

test("rename: a .dta tab renamed to .csv opens again as text in its place; an unsaved text tab renamed to .dta stays text", async () => {
  await reset({ "a.do": "1", "w.dta": "a,b\n1,2\n", "c.do": "3" });
  for (const p of ["a.do", "w.dta", "c.do"]) await openFile(p);
  D.activate("a.do");
  S.showPhone("files");
  await Ops.renameEntry("w.dta", "w.csv");
  assert.deepEqual(
    D.tabs.value.map((t) => [t.path, t.kind]),
    [
      ["a.do", "text"],
      ["w.csv", "text"],
      ["c.do", "text"],
    ],
  );
  assert.equal(D.activeTab.value, "a.do", "the active tab stays");
  assert.equal(S.phoneTab.value, "files");
  assert.equal(D.textOf("w.csv"), "a,b\n1,2\n", "the store's text, read in the rename's turn");
  edit("c.do");
  await Ops.renameEntry("c.do", "c.dta");
  assert.deepEqual(D.tabs.value.at(-1), { path: "c.dta", kind: "text", dirty: true }, "the editor keeps the edits");
});

test("rename: a .dta tab renamed to .png closes, and the Graph tab and the full-size view are left alone (a phone too)", async () => {
  for (const layout of ["desktop", "phone"] as const) {
    await reset({ "a.do": "1", "w.dta": "x" });
    S.layout.value = layout;
    for (const p of ["a.do", "w.dta"]) await openFile(p);
    const graphs = S.graphs.value.length;
    await Ops.renameEntry("w.dta", "w.png");
    assert.deepEqual(
      D.tabs.value.map((t) => t.path),
      ["a.do"],
      layout,
    );
    assert.equal(D.activeTab.value, "a.do");
    assert.equal(S.graphs.value.length, graphs, "the .png is not opened");
    assert.equal(S.outputTab.value, "data");
    assert.equal(S.graphFull.value, false);
  }
});

test("rename: a .dta tab renamed to a text name is read before its tab moves, so it never shows the new name as a .dta tab", async () => {
  await reset({ "v.dta": "x", "w.dta": "a,b\n1,2\n" });
  for (const p of ["v.dta", "w.dta"]) await openFile(p);
  const seen: string[][] = [];
  const stop = effect(() => {
    seen.push(D.tabs.value.map((t) => `${t.path} ${t.kind}`));
  });
  await Ops.renameEntry("w.dta", "w.csv");
  stop();
  assert.ok(!seen.some((tabs) => tabs.includes("w.csv dta")), JSON.stringify(seen));
  assert.deepEqual(seen.at(-1), ["v.dta dta", "w.csv text"]);
  assert.equal(D.activeTab.value, "w.csv");
});

test("rename to a text name: a file that is not text closes its tab with the not-text banner; one the store cannot give closes it with none", async () => {
  await reset({ "a.do": "1", "v.dta": Uint8Array.from([0xff, 0xfe, 0x00]), "w.dta": "x" });
  for (const p of ["a.do", "v.dta", "w.dta"]) await openFile(p);
  await Ops.renameEntry("v.dta", "v.csv");
  assert.deepEqual(
    D.tabs.value.map((t) => t.path),
    ["a.do", "w.dta"],
  );
  assert.deepEqual(S.banners.value, [{ b: "not-text", path: "v.csv" }]);
  S.dismiss(S.banners.value[0]);
  const read = store.read;
  store.read = async (path) => {
    if (path === "w.csv") throw new Error("the store failed");
    return read.call(store, path);
  };
  try {
    await Ops.renameEntry("w.dta", "w.csv");
  } finally {
    store.read = read;
  }
  assert.deepEqual(
    D.tabs.value.map((t) => t.path),
    ["a.do"],
  );
  assert.deepEqual(S.banners.value, []);
});

test("rename to a text name: the new name opened while the store is read keeps one tab for it", async () => {
  await reset({ "a.do": "1", "w.dta": "a,b\n" });
  for (const p of ["a.do", "w.dta"]) await openFile(p);
  const read = store.read;
  let opened: Promise<void> | null = null;
  store.read = async (path) => {
    const bytes = await read.call(store, path);
    // the visitor opens the new name from the list meanwhile: its read takes the turn after the rename's
    if (path === "w.csv" && !opened) opened = openFile("w.csv");
    return bytes;
  };
  try {
    await Ops.renameEntry("w.dta", "w.csv");
    await opened;
  } finally {
    store.read = read;
  }
  assert.ok(opened, "the store was read during the rename");
  assert.deepEqual(
    D.tabs.value.map((t) => [t.path, t.kind]),
    [
      ["a.do", "text"],
      ["w.csv", "text"],
    ],
  );
  assert.equal(D.activeTab.value, "w.csv");
  assert.equal(D.textOf("w.csv"), "a,b\n");
});

test("rename onto the name of a file a run deleted, its tab still open: a clean tab gives way to the renamed file; one with unsaved edits keeps the name taken", async () => {
  const tabsNow = () => D.tabs.value.map((t) => [t.path, t.kind, t.dirty]);
  await reset({ "a.do": "1", "w.csv": "x\n", "w.dta": "a,b\n" });
  for (const p of ["a.do", "w.csv", "w.dta"]) await openFile(p);
  await store.remove("w.csv"); // a run's erase: files.ts afterRun keeps the tab
  await refresh();
  await Ops.renameEntry("w.dta", "w.csv");
  assert.deepEqual(tabsNow(), [
    ["a.do", "text", false],
    ["w.csv", "text", false],
  ]);
  assert.equal(D.textOf("w.csv"), "a,b\n", "the renamed file's text, as the store has it");

  await reset({ "a.do": "1", "w.csv": "x\n", "w.dta": "a,b\n" });
  for (const p of ["a.do", "w.csv", "w.dta"]) await openFile(p);
  edit("w.csv");
  await store.remove("w.csv");
  await refresh();
  await assert.rejects(Ops.renameEntry("w.dta", "w.csv"), /already exists/);
  assert.deepEqual(tabsNow(), [
    ["a.do", "text", false],
    ["w.csv", "text", true],
    ["w.dta", "dta", false],
  ]);
  assert.deepEqual((await store.list()).map((f) => f.path).sort(), ["a.do", "w.dta"]);
});
