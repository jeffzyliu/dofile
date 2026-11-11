// Step 4a's plain logic (src/app/files/*.ts) on the page's real store module over fake-indexeddb, with no DOM: the tree's
// rows and names (tree.ts), opening a file as SPEC 3.11 says (open.ts), and what the file panel and the tabs do (actions.ts:
// close, rename, delete, upload with its name clashes, a folder's .zip). The editor is stood in for by recording the calls
// made through `editorCommands`; the views (FilesPane.tsx, EditorTabs.tsx, dialogs.tsx) are tested in e2e/files.spec.ts.

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import "fake-indexeddb/auto";
import { effect } from "@preact/signals-core";

const S = await import("../src/app/state.ts");
const { store } = await import("../src/app/store.ts");
const { connectFiles, refresh } = await import("../src/app/files.ts");
const { editorCommands } = await import("../src/app/editor/commands.ts");
const { openFile, toBase64 } = await import("../src/app/files/open.ts");
const A = await import("../src/app/files/actions.ts");
const T = await import("../src/app/files/tree.ts");

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
  for (const [path, data] of Object.entries(files)) await store.write(path, typeof data === "string" ? enc(data) : data);
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

test("names and paths: sizes, a free name, what is wrong with a new name, tab labels, row counts, quoting", () => {
  assert.deepEqual(
    [0, 999, 1000, 41_200, 999_499, 999_500, 1_234_567, 48_600_000, 2_500_000_000].map(T.formatSize),
    ["0 B", "999 B", "1 KB", "41 KB", "999 KB", "1.0 MB", "1.2 MB", "49 MB", "2.5 GB"],
  );
  assert.equal(T.freeName("", "untitled.do", ["a.do"]), "untitled.do");
  assert.equal(T.freeName("", "untitled.do", ["untitled.do", "untitled-2.do"]), "untitled-3.do");
  assert.equal(T.freeName("data", "folder", ["data/folder"]), "data/folder-2");
  const taken = ["clean.do", "data", "data/wages.dta"];
  assert.equal(T.nameProblem("clean.do", "", taken), "clean.do already exists here.");
  assert.equal(T.nameProblem("clean.do", "", taken, "clean.do"), null, "its own name is not taken");
  assert.equal(T.nameProblem("wages.dta", "data", taken), "wages.dta already exists here.");
  assert.equal(T.nameProblem("wages.dta", "", taken), null);
  assert.equal(T.nameProblem("  ", "", taken), "Type a name.");
  assert.match(T.nameProblem("a/b.do", "", taken) ?? "", /can't contain/);
  assert.match(T.nameProblem("..", "", taken) ?? "", /isn't allowed/);
  assert.match(T.nameProblem(".dofile", "", taken) ?? "", /dofile's own/);
  assert.deepEqual(T.tabLabels(["a.do", "data/wages.dta", "old/wages.dta", "wages.dta"]), [
    "a.do",
    "wages.dta · data",
    "wages.dta · old",
    "wages.dta",
  ]);
  assert.equal(T.rowCount("a,b\r\n1,2\n\n3,4\n"), "3 rows");
  assert.equal(T.rowCount(`${"x\n".repeat(1204)}`), "1,204 rows");
  assert.equal(T.rowCount("x"), "1 row");
  assert.equal(T.quoted("data/a.csv"), '"data/a.csv"');
  assert.equal(T.quoted('my "x".csv'), '`"my "x".csv"\'');
  assert.equal(T.movedPath("data/raw/a.csv", "data", "input"), "input/raw/a.csv");
  assert.equal(T.movedPath("database.do", "data", "input"), "database.do", "a name that only starts the same stays");
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
  await reset({ "survey.xlsx": Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0xff, 0xfe]), "b.xls": Uint8Array.from([0xd0]) });
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
  assert.ok(calls.every((c) => c.tabs.includes("input/x.do")), "tabs first, then the editor");
  await A.renameEntry("a.do", "b.do");
  assert.equal(S.tabs.value[0].path, "b.do");
  await assert.rejects(A.renameEntry("b.do", "database.do"), /already exists/);
  assert.equal(S.tabs.value[0].path, "b.do", "a refused rename changes no tab");
  await refresh();
  assert.ok(S.files.value.some((f) => f.path === "input/raw/y.csv"));
});

test("new .do file and new folder take the first free name; delete closes the tabs under the path; delete all empties the store", async () => {
  await reset({ "untitled.do": "" });
  assert.equal(await A.newDoFile(), "untitled-2.do");
  assert.equal(await A.newFolder(), "folder");
  assert.equal(await A.newFolder(), "folder-2");
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
function answering(answers: A.ClashAnswer[]) {
  const seen: { dialog: unknown; now: A.ClashNow | null; inStore: string[] }[] = [];
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
    { path: "a.do", yours: { size: 5, mtime: 0 }, uploaded: 5, others: 1, left: 3, unsaved: false },
  );
  assert.deepEqual(
    await Promise.all(["a", "b", "c", "d", "new"].map((n) => textOf(`${n}.do`))),
    ["old a", "new b", "new c", "new d", "new new"],
  );
  assert.equal(S.toast.value, "4 files uploaded");
  assert.equal(S.dialog.value, null);
  assert.equal(A.clashNow(), null);
});

test("upload: Esc keeps yours for every clash left and asks no more; Keep mine with Do the same keeps the rest too", async () => {
  await reset({ "a.do": "old a", "b.do": "old b", "c.do": "old c" });
  let { seen, stop } = answering(["stop"]);
  await A.upload(["a", "b", "c", "x"].map((n) => ({ path: `${n}.do`, data: enc(`new ${n}`) })));
  stop();
  assert.equal(seen.length, 1);
  assert.deepEqual(
    await Promise.all(["a", "b", "c", "x"].map((n) => textOf(`${n}.do`))),
    ["old a", "old b", "old c", "new x"],
  );
  assert.equal(S.toast.value, "1 file uploaded");
  ({ seen, stop } = answering([{ replace: false, same: true }]));
  await A.upload(["a", "b"].map((n) => ({ path: `${n}.do`, data: enc(`new ${n}`) })));
  stop();
  assert.equal(seen.length, 1);
  assert.deepEqual(
    await Promise.all(["a", "b"].map((n) => textOf(`${n}.do`))),
    ["old a", "old b"],
  );
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
  assert.equal(S.toast.value, "1 file uploaded · 1 couldn't be");
  assert.equal(await textOf("y.do"), "second");
  await sleep(0);
});
