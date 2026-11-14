// Step 4a's plain logic (src/app/files/*.ts) on the page's real store module over fake-indexeddb, with no DOM: the tree's
// rows and names (tree.ts), opening a file as SPEC 3.11 says (open.ts), and what the file panel and the tabs do (actions.ts:
// close, rename, delete, upload with its name clashes, a folder's .zip). The editor is stood in for by recording the calls
// made through `editorCommands`; the views (FilesPane.tsx, EditorTabs.tsx, dialogs.tsx) are tested in e2e/files.spec.ts.

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import "fake-indexeddb/auto";
import { effect } from "@preact/signals-core";
import type { ClashAnswer, ClashNow } from "../src/app/files/actions.ts";

const S = await import("../src/app/state.ts");
const { store } = await import("../src/app/store.ts");
const { connectFiles, refresh } = await import("../src/app/files.ts");
const { editorCommands } = await import("../src/app/editor/commands.ts");
const { openFile, toBase64 } = await import("../src/app/files/open.ts");
const A = await import("../src/app/files/actions.ts");
const T = await import("../src/app/files/tree.ts");
const { fileCommand } = await import("../src/stata/quote.ts");

const enc = (s: string) => new TextEncoder().encode(s);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const info = (path: string, size = 1, dir = false) => ({ path, dir, size, mtime: 0 });

// the editor's calls, in order, with the tabs as they were at each call
let calls: { op: string; args: unknown[]; tabs: string[] }[] = [];
for (const op of ["open", "reload", "renamed", "closed"] as const) {
  (editorCommands as Record<string, unknown>)[op] = (...args: unknown[]) => {
    calls.push({ op, args, tabs: S.tabs.value.map((t) => t.path) });
  };
}

connectFiles(store, { persisted: async () => true, persist: async () => true } as never);
store.blocked = false;

async function reset(files: Record<string, string | Uint8Array> = {}) {
  for (const f of await store.list()) if (!f.path.includes("/")) await store.remove(f.path);
  for (const [path, data] of Object.entries(files))
    await store.write(path, typeof data === "string" ? enc(data) : data);
  await refresh();
  S.tabs.value = [];
  S.activeTab.value = null;
  S.dialog.value = null;
  S.layout.value = "desktop";
  S.phoneTab.value = "files";
  S.outputTab.value = "data";
  S.graphFull.value = false;
  for (const b of S.banners.value) S.dismiss(b);
  calls = [];
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
  assert.deepEqual([0, 999, 1000, 41_200, 999_499, 999_500, 1_234_567, 48_600_000, 2_500_000_000].map(T.formatSize), [
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
  assert.match(T.newPathProblem("a/../x.do", "", listed) ?? "", /isn't allowed/);
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

test("openFile: a text file gets a tab, made active, before the editor is told; opened again it is only made active", async () => {
  await reset({ "a.do": "display 1\n", "b.do": "display 2\n" });
  await openFile("a.do");
  await openFile("b.do");
  assert.deepEqual(
    S.tabs.value.map((t) => [t.path, t.kind, t.dirty]),
    [
      ["a.do", "text", false],
      ["b.do", "text", false],
    ],
  );
  assert.equal(S.activeTab.value, "b.do");
  assert.deepEqual(calls, [
    { op: "open", args: ["a.do", "display 1\n"], tabs: ["a.do"] },
    { op: "open", args: ["b.do", "display 2\n"], tabs: ["a.do", "b.do"] },
  ]);
  await openFile("a.do");
  assert.equal(S.activeTab.value, "a.do");
  assert.equal(calls.length, 2, "an open file is not opened again");
  assert.equal(S.phoneTab.value, "files", "the desktop leaves the phone's view alone");
});

test("openFile on a phone shows the Editor view for a text or .dta tab; a .png goes to the graphs (desktop: the Graph tab; phone: full size)", async () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 250]);
  await reset({ "a.do": "x", "data/w.dta": Uint8Array.from([0x72, 0xff]), "out/g.png": png });
  S.layout.value = "phone";
  await openFile("a.do");
  assert.equal(S.phoneTab.value, "editor");
  S.phoneTab.value = "files";
  await openFile("data/w.dta");
  assert.equal(S.phoneTab.value, "editor");
  assert.deepEqual(S.tabs.value.at(-1), { path: "data/w.dta", kind: "dta", dirty: false });
  assert.equal(S.activeTab.value, "data/w.dta");
  assert.equal(calls.length, 1, "a .dta tab is not the editor's");
  S.phoneTab.value = "files";
  await openFile("out/g.png");
  assert.equal(S.graphFull.value, true);
  assert.equal(S.phoneTab.value, "files", "a graph is no tab");
  const g = S.graphs.value.at(-1)!;
  assert.deepEqual([g.from, g.path, g.png], ["file", "out/g.png", Buffer.from(png).toString("base64")]);
  S.layout.value = "desktop";
  S.graphFull.value = false;
  await openFile("out/g.png");
  assert.equal(S.outputTab.value, "graph");
  assert.equal(S.graphFull.value, false);
  assert.equal(S.tabs.value.length, 2);
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
  assert.deepEqual(S.tabs.value, []);
  assert.deepEqual(S.banners.value, [{ b: "not-text", path: "survey.xlsx" }]);
  await openFile("b.xls");
  assert.deepEqual(S.banners.value, [{ b: "not-text", path: "b.xls" }]);
  await openFile("gone.do"); // not in the store: nothing happens
  assert.deepEqual(S.tabs.value, []);
});

// ---- actions.ts: tabs ----

test("closing a tab: one with no edits closes (the next tab becomes active; the editor is told after `tabs` changed); one with unsaved edits asks", async () => {
  await reset({ "a.do": "1", "b.do": "2", "c.do": "3" });
  for (const p of ["a.do", "b.do", "c.do"]) await openFile(p);
  S.activeTab.value = "b.do";
  calls = [];
  assert.equal(A.askCloseTab("b.do"), true);
  assert.equal(S.activeTab.value, "c.do", "the tab to the right");
  assert.deepEqual(calls, [{ op: "closed", args: ["b.do"], tabs: ["a.do", "c.do"] }]);
  A.closeTab("c.do");
  assert.equal(S.activeTab.value, "a.do", "the last tab: the one to the left");
  S.setDirty("a.do", true); // no editor yet (step 4b): the test makes the edits
  calls = [];
  assert.equal(A.askCloseTab("a.do"), false);
  assert.deepEqual(S.dialog.value, { d: "close-tab", path: "a.do" });
  assert.deepEqual(
    S.tabs.value.map((t) => t.path),
    ["a.do"],
  );
  assert.deepEqual(calls, []);
  A.closeTab("a.do"); // the dialog's "Don't save"
  assert.equal(S.activeTab.value, null);
  assert.deepEqual(calls, [{ op: "closed", args: ["a.do"], tabs: [] }]);
});

// ---- actions.ts: rename, new, delete ----

test("rename: an open file, and a folder with open files under it: the tabs follow, then the editor is told for each", async () => {
  await reset({ "a.do": "1", "data/x.do": "2", "data/raw/y.csv": "3", "database.do": "4" });
  for (const p of ["a.do", "data/x.do", "data/raw/y.csv", "database.do"]) await openFile(p);
  S.activeTab.value = "data/raw/y.csv";
  calls = [];
  await A.renameEntry("data", "input");
  assert.deepEqual(
    S.tabs.value.map((t) => t.path),
    ["a.do", "input/x.do", "input/raw/y.csv", "database.do"],
  );
  assert.equal(S.activeTab.value, "input/raw/y.csv");
  assert.deepEqual(
    calls.map((c) => [c.op, ...c.args]),
    [
      ["renamed", "data/x.do", "input/x.do"],
      ["renamed", "data/raw/y.csv", "input/raw/y.csv"],
    ],
  );
  assert.ok(
    calls.every((c) => c.tabs.includes("input/x.do")),
    "tabs first, then the editor",
  );
  await A.renameEntry("a.do", "b.do");
  assert.equal(S.tabs.value[0].path, "b.do");
  await assert.rejects(A.renameEntry("b.do", "database.do"), /already exists/);
  assert.equal(S.tabs.value[0].path, "b.do", "a refused rename changes no tab");
  await refresh();
  assert.ok(S.files.value.some((f) => f.path === "input/raw/y.csv"));
});

test("fileTurn (the editor's Save): a turn taken while a rename or a delete is in progress sees the tabs they left; a refused one does not stop the next", async () => {
  await reset({ "a.do": "1", "b.do": "2" });
  for (const p of ["a.do", "b.do"]) await openFile(p);
  const tabsNow = () => S.tabs.value.map((t) => t.path);
  const renaming = A.renameEntry("a.do", "c.do");
  const seen = A.fileTurn(async () => tabsNow());
  await renaming;
  assert.deepEqual(await seen, ["c.do", "b.do"], "the tab has its new name when the turn comes");
  const deleting = A.deleteEntries(["b.do"]);
  assert.deepEqual(await A.fileTurn(async () => tabsNow()), ["c.do"], "and the deleted file's tab is closed");
  await deleting;
  const refused = A.renameEntry("c.do", "c.do/x");
  const after = A.fileTurn(async () => "next");
  await assert.rejects(refused);
  assert.equal(await after, "next");
});

test("a new .do file and a new folder take the name asked for or the first free one, and never replace a file; delete closes the tabs under the path; delete all empties the store", async () => {
  await reset({ "untitled.do": "keep", "a.do": "mine" });
  assert.equal(await A.createEntry("file"), "untitled-2.do");
  assert.equal(await A.createEntry("folder"), "folder");
  assert.equal(await A.createEntry("folder"), "folder-2");
  assert.equal(await A.createEntry("file", "", "clean.do"), "clean.do");
  assert.equal(await A.createEntry("folder", "", "data"), "data");
  assert.equal(await A.createEntry("file", "data", "b.do"), "data/b.do");
  await assert.rejects(A.createEntry("file", "", "a.do"), /already exists/);
  await assert.rejects(A.createEntry("folder", "", "a.do"), /already exists/);
  assert.equal(
    new TextDecoder().decode(await store.read("a.do")),
    "mine",
    "a name in use is refused, not written over",
  );
  const both = await Promise.all([A.createEntry("file"), A.createEntry("file")]);
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
  calls = [];
  await A.deleteEntries(["data"]);
  assert.deepEqual(
    S.tabs.value.map((t) => t.path),
    ["untitled.do"],
  );
  assert.deepEqual(
    calls.map((c) => [c.op, ...c.args]),
    [
      ["closed", "data/x.do"],
      ["closed", "data/y.do"],
    ],
  );
  await A.deleteEntries(["survey.xlsx"]);
  assert.deepEqual(S.banners.value, [], "a deleted file's not-text banner goes");
  await A.deleteAll();
  assert.deepEqual(await store.list(), []);
  assert.deepEqual(S.tabs.value, []);
});

test("a folder's Download (.zip): every file and folder under it, named under the folder, nothing else", async () => {
  await reset({ "data/raw/a.csv": "1,2\n", "data/w.dta": "x", "other.do": "y" });
  const zip = await A.zipFolder("data/raw");
  assert.equal(zip.name, "raw.zip");
  const text = Buffer.from(await zip.arrayBuffer()).toString("latin1");
  assert.ok(text.includes("raw/a.csv") && text.includes("raw/"));
  assert.ok(!text.includes("data/") && !text.includes("other.do") && !text.includes("w.dta"));
  const all = Buffer.from(await (await A.zipFolder("data")).arrayBuffer()).toString("latin1");
  assert.ok(all.includes("data/raw/a.csv") && all.includes("data/w.dta") && !all.includes("other.do"));
});

// ---- actions.ts: upload and its clashes ----

/** Answer each clash dialog as it opens, in order; records what each showed. */
function answering(answers: ClashAnswer[]) {
  const seen: { dialog: unknown; now: ClashNow | null; inStore: string[] }[] = [];
  const stop = effect(() => {
    const d = S.dialog.value;
    if (d?.d !== "clash") return;
    const now = A.clashNow();
    store.list().then((l) => {
      seen.push({ dialog: d, now, inStore: l.map((f) => f.path).sort() });
      S.dialog.value = null;
      A.answerClash(answers.shift() ?? "stop");
    });
  });
  return { seen, stop };
}
const textOf = async (path: string) => new TextDecoder().decode(await store.read(path));

test("upload with no clash: every file written, folders kept, then the toast", async () => {
  const written = await A.upload([
    { path: "a.do", data: enc("1") },
    { path: "pkg/data/b.csv", data: enc("2") },
  ]);
  assert.deepEqual(written, ["a.do", "pkg/data/b.csv"]);
  assert.equal(S.toast.value, "2 files uploaded");
  await A.upload([{ path: "c.do", data: enc("3") }]);
  assert.equal(S.toast.value, "1 file uploaded");
  assert.equal(S.dialog.value, null);
});

test("upload with clashes: the others are written first; each clash asks, Keep mine, Replace, and Do the same for the rest", async () => {
  await reset({ "a.do": "old a", "b.do": "old b", "c.do": "old c", "d.do": "old d" });
  const { seen, stop } = answering([
    { replace: false, same: false }, // a: keep (Enter)
    { replace: true, same: false }, // b: replace
    { replace: true, same: true }, // c: replace, and d the same without asking
  ]);
  await A.upload(["a", "b", "new", "c", "d"].map((n) => ({ path: `${n}.do`, data: enc(`new ${n}`) })));
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
      uploaded: 5,
      others: 1,
      left: 3,
      unsaved: false,
      words: A.WORDS.upload,
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
  assert.equal(A.clashNow(), null);
});

test("upload: a clash with the same bytes is not asked and not written, and counts as uploaded; the clashes left are numbered without it", async () => {
  await reset({ "a.do": "same a", "b.do": "old b", "c.do": "old c" });
  const before = (await store.list()).find((f) => f.path === "a.do")!;
  const { seen, stop } = answering([
    { replace: true, same: false },
    { replace: false, same: false },
  ]);
  const written = await A.upload([
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
  assert.deepEqual([seen[0].now?.others, seen[0].now?.left], [2, 1], "the same file is one of the others: in place");
  assert.deepEqual(written.sort(), ["b.do", "new.do"], "only what was written");
  assert.equal((await store.list()).find((f) => f.path === "a.do")!.mtime, before.mtime, "a.do was not written");
  assert.equal(S.toast.value, "3 files uploaded", "a.do counts: the store holds what was uploaded");
  // all identical: nothing asked, the toast still says so
  await A.upload([{ path: "a.do", data: enc("same a") }]);
  assert.equal(S.toast.value, "1 file uploaded");
  assert.equal(S.dialog.value, null);
});

test("upload: a clash with the same bytes but open with unsaved edits is still asked; a clean open one is not, and not reloaded", async () => {
  await reset({ "a.do": "same a", "b.do": "same b" });
  await openFile("a.do");
  await openFile("b.do");
  S.setDirty("a.do", true);
  calls = [];
  const { seen, stop } = answering([{ replace: true, same: false }]);
  await A.upload(["a", "b"].map((n) => ({ path: `${n}.do`, data: enc(`same ${n}`) })));
  stop();
  assert.deepEqual(
    seen.map((s) => [s.dialog, s.now?.unsaved]),
    [[{ d: "clash", path: "a.do", index: 1, total: 1 }, true]],
  );
  assert.deepEqual(
    calls.map((c) => [c.op, ...c.args]),
    [["reload", "a.do", "same a"]],
    "Replace drops the edits; b.do, clean and identical, is left as it is",
  );
});

test("upload with the sample's words: the dialog's words, 'Sample restored', 'The sample is already here' when nothing was written or asked, and nothing said when all asked were kept", async () => {
  await reset({ "a.do": "old a", "b.do": "same b" });
  const { seen, stop } = answering([{ replace: false, same: false }]);
  S.showToast("sentinel"); // the toast is not cleared by hand: what an upload says replaces it
  await A.upload(
    [
      { path: "a.do", data: enc("new a") },
      { path: "b.do", data: enc("same b") },
    ],
    "sample",
  );
  assert.equal(seen[0].now?.words, A.WORDS.sample);
  assert.equal(seen.length, 1, "b.do holds the sample's bytes: not asked");
  assert.equal(S.toast.value, "sentinel", "everything asked was kept, and nothing was written: no toast");
  assert.equal(await textOf("a.do"), "old a");
  // the visitor replaces
  stop();
  const again = answering([{ replace: true, same: false }]);
  await A.upload([{ path: "a.do", data: enc("new a") }], "sample");
  again.stop();
  assert.equal(S.toast.value, "Sample restored");
  // nothing to write, nothing to ask
  await A.upload(
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
    await A.upload([{ path: "a.do/x", data: enc("1") }], "sample");
  } finally {
    console.warn = warn;
  }
  assert.equal(S.toast.value, "Couldn't restore the sample");
});

test("upload: Esc keeps yours for every clash left and asks no more; Keep mine with Do the same keeps the rest too", async () => {
  await reset({ "a.do": "old a", "b.do": "old b", "c.do": "old c" });
  let { seen, stop } = answering(["stop"]);
  await A.upload(["a", "b", "c", "x"].map((n) => ({ path: `${n}.do`, data: enc(`new ${n}`) })));
  stop();
  assert.equal(seen.length, 1);
  assert.deepEqual(await Promise.all(["a", "b", "c", "x"].map((n) => textOf(`${n}.do`))), [
    "old a",
    "old b",
    "old c",
    "new x",
  ]);
  assert.equal(S.toast.value, "1 file uploaded");
  ({ seen, stop } = answering([{ replace: false, same: true }]));
  await A.upload(["a", "b"].map((n) => ({ path: `${n}.do`, data: enc(`new ${n}`) })));
  stop();
  assert.equal(seen.length, 1);
  assert.deepEqual(await Promise.all(["a", "b"].map((n) => textOf(`${n}.do`))), ["old a", "old b"]);
});

test("upload over an open file: the clash says it has unsaved edits; Replace reloads it in the editor; one no longer text closes its tab", async () => {
  await reset({ "a.do": "old a", "b.do": "old b" });
  await openFile("a.do");
  await openFile("b.do");
  S.setDirty("a.do", true); // no editor yet (step 4b): the test makes the edits
  calls = [];
  const { seen, stop } = answering([
    { replace: true, same: false },
    { replace: true, same: false },
  ]);
  await A.upload([
    { path: "a.do", data: enc("new a") },
    { path: "b.do", data: Uint8Array.from([0xff, 0xfe]) },
  ]);
  stop();
  assert.equal(seen[0].now?.unsaved, true);
  assert.equal(seen[1].now?.unsaved, false);
  assert.deepEqual(
    calls.map((c) => [c.op, ...c.args]),
    [
      ["reload", "a.do", "new a"],
      ["closed", "b.do"],
    ],
  );
  assert.deepEqual(
    S.tabs.value.map((t) => t.path),
    ["a.do"],
  );
});

test("upload: a file the store refuses is counted in the toast; a path given twice is written once (the last)", async () => {
  await reset({ "data/x.do": "1" });
  const warn = console.warn;
  console.warn = () => {};
  try {
    await A.upload([
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

// ---- actions.ts: the clash flow with other dialogs and other uploads ----

const until = async (ok: () => boolean, what: string) => {
  for (let i = 0; i < 200 && !ok(); i++) await sleep(5);
  assert.ok(ok(), what);
};
const clashOf = () => (S.dialog.value?.d === "clash" ? S.dialog.value.path : null);
/** The clash dialog's answer, as ClashDialog gives it: it closes, then answers. */
const give = (a: ClashAnswer) => {
  S.dialog.value = null;
  A.answerClash(a);
};

test("a second upload waits for the first: it writes nothing and asks nothing until the first has ended", async () => {
  await reset({ "a.do": "old a", "b.do": "old b" });
  const first = A.upload([{ path: "a.do", data: enc("new a") }]);
  await until(() => clashOf() === "a.do", "the first upload asks");
  const second = A.upload([
    { path: "b.do", data: enc("new b") },
    { path: "z.do", data: enc("z") },
  ]);
  await sleep(30);
  assert.equal(clashOf(), "a.do", "the second does not replace the first's question");
  assert.ok(!(await store.list()).some((f) => f.path === "z.do"), "nor write anything before the first has ended");
  give({ replace: true, same: false });
  assert.deepEqual(await first, ["a.do"]);
  await until(() => clashOf() === "b.do", "then the second asks");
  give({ replace: false, same: false });
  assert.deepEqual(await second, ["z.do"]);
  assert.equal(S.toast.value, "1 file uploaded");
  assert.deepEqual(await Promise.all(["a.do", "b.do"].map(textOf)), ["new a", "old b"]);
  assert.equal(S.dialog.value, null);
});

test("a clash never replaces another dialog: it waits until that one has closed", async () => {
  await reset({ "a.do": "old a" });
  S.dialog.value = { d: "download" };
  const done = A.upload([{ path: "a.do", data: enc("new a") }]);
  await sleep(30);
  assert.deepEqual(S.dialog.value, { d: "download" });
  S.dialog.value = null;
  await until(() => clashOf() === "a.do", "the clash is asked once the other dialog has closed");
  give("stop");
  assert.deepEqual(await done, []);
  assert.equal(S.dialog.value, null);
});

test("another dialog put in the clash's place with no answer keeps yours for every clash left, and the next upload runs", async () => {
  await reset({ "a.do": "old a", "b.do": "old b" });
  const done = A.upload(["a", "b", "y"].map((n) => ({ path: `${n}.do`, data: enc(`new ${n}`) })));
  await until(() => clashOf() === "a.do", "the clash is asked");
  S.dialog.value = { d: "other-tab" }; // as the engine controller does when another tab takes the engine
  assert.deepEqual(await done, ["y.do"]);
  assert.deepEqual(S.dialog.value, { d: "other-tab" }, "the upload's end leaves the other dialog open");
  assert.deepEqual(await Promise.all(["a", "b"].map((n) => textOf(`${n}.do`))), ["old a", "old b"]);
  S.dialog.value = null;
  assert.deepEqual(await A.upload([{ path: "z.do", data: enc("z") }]), ["z.do"], "a later upload is not held up");
});

test("after Do the same with Replace, a clash over an open file with unsaved edits is still asked", async () => {
  await reset({ "a.do": "old a", "b.do": "old b", "c.do": "old c" });
  await openFile("b.do");
  S.setDirty("b.do", true); // no editor yet (step 4b): the test makes the edits
  const { seen, stop } = answering([
    { replace: true, same: true }, // a: replace, and the rest the same
    { replace: false, same: false }, // b: asked all the same, as it has unsaved edits: keep it
  ]);
  await A.upload(["a", "b", "c"].map((n) => ({ path: `${n}.do`, data: enc(`new ${n}`) })));
  stop();
  assert.deepEqual(
    seen.map((x) => [(x.dialog as { path: string }).path, x.now?.unsaved]),
    [
      ["a.do", false],
      ["b.do", true],
    ],
  );
  assert.deepEqual(await Promise.all(["a", "b", "c"].map((n) => textOf(`${n}.do`))), ["new a", "old b", "new c"]);
});

test("after Esc, or Do the same with Keep mine, a clash over a file with unsaved edits is not asked: it is kept", async () => {
  for (const first of ["stop", { replace: false, same: true }] as ClashAnswer[]) {
    await reset({ "a.do": "old a", "b.do": "old b" });
    await openFile("b.do");
    S.setDirty("b.do", true);
    const { seen, stop } = answering([first, { replace: true, same: false }]);
    const done = await A.upload(["a", "b", "y"].map((n) => ({ path: `${n}.do`, data: enc(`new ${n}`) })));
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
  S.setDirty("b.do", true);
  const done = A.upload(["a", "b", "y"].map((n) => ({ path: `${n}.do`, data: enc(`new ${n}`) })));
  await until(() => clashOf() === "a.do", "the clash is asked");
  S.dialog.value = { d: "other-tab" }; // another tab took the engine
  assert.deepEqual(await done, ["y.do"], "it does not wait for the other dialog to ask about b.do");
  assert.deepEqual(S.dialog.value, { d: "other-tab" });
  assert.deepEqual(await A.upload([{ path: "z.do", data: enc("z") }]), ["z.do"], "a later upload runs");
  S.dialog.value = null;
  await sleep(30);
  assert.equal(S.dialog.value, null, "no clash is asked once the other dialog has closed");
  assert.deepEqual(await Promise.all(["a", "b"].map((n) => textOf(`${n}.do`))), ["old a", "old b"]);
});

test("upload: a name with a control character is refused and counted", async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual(
      await A.upload([
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

// ---- actions.ts: a rename that changes how the file opens ----

test("rename: a .dta tab renamed to .csv opens again as text in its place; an unsaved text tab renamed to .dta stays text", async () => {
  await reset({ "a.do": "1", "w.dta": "a,b\n1,2\n", "c.do": "3" });
  for (const p of ["a.do", "w.dta", "c.do"]) await openFile(p);
  S.activeTab.value = "a.do";
  S.phoneTab.value = "files";
  calls = [];
  await A.renameEntry("w.dta", "w.csv");
  assert.deepEqual(
    S.tabs.value.map((t) => [t.path, t.kind]),
    [
      ["a.do", "text"],
      ["w.csv", "text"],
      ["c.do", "text"],
    ],
  );
  assert.equal(S.activeTab.value, "a.do", "the active tab stays");
  assert.equal(S.phoneTab.value, "files");
  assert.ok(calls.some((c) => c.op === "open" && c.args[0] === "w.csv"));
  S.setDirty("c.do", true);
  await A.renameEntry("c.do", "c.dta");
  assert.deepEqual(S.tabs.value.at(-1), { path: "c.dta", kind: "text", dirty: true }, "the editor keeps the edits");
});

test("rename: a .dta tab renamed to .png closes, and the Graph tab and the full-size view are left alone (a phone too)", async () => {
  for (const layout of ["desktop", "phone"] as const) {
    await reset({ "a.do": "1", "w.dta": "x" });
    S.layout.value = layout;
    for (const p of ["a.do", "w.dta"]) await openFile(p);
    const graphs = S.graphs.value.length;
    await A.renameEntry("w.dta", "w.png");
    assert.deepEqual(
      S.tabs.value.map((t) => t.path),
      ["a.do"],
      layout,
    );
    assert.equal(S.activeTab.value, "a.do");
    assert.equal(S.graphs.value.length, graphs, "the .png is not opened");
    assert.equal(S.outputTab.value, "data");
    assert.equal(S.graphFull.value, false);
  }
});
