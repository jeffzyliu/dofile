// The inline rename and the draft rows (files/rename.ts) over fake-indexeddb: how a field starts, and how Enter, Esc and
// leaving it end, as the focus request and the tree's state show them.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import "fake-indexeddb/auto";

const S = await import("../src/app/state.ts");
const { store } = await import("../src/app/store.ts");
const { connectFiles, refresh } = await import("../src/app/files.ts");
const D = await import("../src/app/editor/documents.ts");
const R = await import("../src/app/files/rename.ts");
const TS = await import("../src/app/files/tree-state.ts");

const enc = (s: string) => new TextEncoder().encode(s);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// what the store holds (the page's list follows a change a moment later)
const paths = async () => (await store.list()).map((f) => f.path).sort();
const NOT_ALLOWED = "That name isn't allowed.";

// what say() has announced: it speaks after a 50 ms window
async function said() {
  await sleep(70);
  return S.announce.value;
}

connectFiles(store, { persisted: async () => true, persist: async () => true } as never);

async function reset(files: Record<string, string> = {}) {
  store.blocked = false;
  for (const f of await store.list()) if (!f.path.includes("/")) await store.remove(f.path);
  for (const [path, data] of Object.entries(files)) await store.write(path, enc(data));
  await refresh();
  for (const t of D.tabs.value) D.close(t.path);
  R.renaming.value = null;
  TS.rovingPath.value = null;
  TS.focusWanted.value = null;
  TS.currentDir.value = "";
  TS.folded.value = new Set();
  S.showToast("");
  await said();
}
beforeEach(() => reset());

/** Count the store's renames and writes while `body` runs. */
async function counting(body: () => Promise<void>) {
  const calls: string[] = [];
  const { rename, write } = store;
  store.rename = (from, to) => {
    calls.push(`rename ${from} ${to}`);
    return rename.call(store, from, to);
  };
  store.write = (path, data, expect) => {
    calls.push(`write ${path}`);
    return write.call(store, path, data, expect);
  };
  try {
    await body();
  } finally {
    store.rename = rename;
    store.write = write;
  }
  return calls;
}

// ---- a field starts ----

test("startRename: the field takes the row in the tab order, remembers the row it came from, and ends a waiting focus request", () => {
  TS.rovingPath.value = "b.do";
  TS.focusWanted.value = { path: "b.do" };
  R.startRename("a.do");
  const first = R.renaming.value!;
  assert.deepEqual(
    { path: first.path, problem: null, draft: undefined, from: "b.do" },
    { path: "a.do", problem: first.problem, draft: first.draft, from: first.from },
  );
  assert.equal(TS.rovingPath.value, "a.do");
  assert.equal(TS.focusWanted.value, null);
  R.startRename("b.do");
  assert.ok(R.renaming.value!.id !== first.id, "each field has its own id");
  assert.equal(R.renaming.value!.from, "a.do");
});

test("startDraft: a row for the free default name in the folder, unfolded and made current, nothing written; a blocked store makes none", async () => {
  await reset({ "untitled.do": "", "data/untitled.do": "" });
  TS.folded.value = new Set(["data"]);
  R.startDraft("file", "data");
  assert.equal(R.renaming.value!.path, "data/untitled-2.do");
  assert.equal(R.renaming.value!.draft, "file");
  assert.equal(TS.currentDir.value, "data");
  assert.deepEqual([...TS.folded.value], []);
  R.startDraft("folder", "");
  assert.equal(R.renaming.value!.path, "folder");
  assert.equal(R.renaming.value!.draft, "folder");
  assert.equal(TS.currentDir.value, "");
  assert.deepEqual(await paths(), ["data", "data/untitled.do", "untitled.do"]);
  R.renaming.value = null;
  store.blocked = true;
  R.startDraft("file", "");
  assert.equal(R.renaming.value, null);
  assert.equal(await said(), "Couldn't create the file");
});

// ---- Enter, Esc and leaving a rename ----

test("Enter with a usable name renames, closes the field, and asks the focus for the new row", async () => {
  await reset({ "a.do": "a", "data/x.do": "x" });
  R.startRename("a.do");
  await R.endRename("b.do");
  assert.deepEqual(await paths(), ["b.do", "data", "data/x.do"]);
  assert.equal(R.renaming.value, null);
  assert.deepEqual(TS.focusWanted.value, { path: "b.do" });
  assert.equal(TS.rovingPath.value, "b.do");
});

test("Enter on a folder that holds the current folder: the current folder follows the rename", async () => {
  await reset({ "data/sub/x.do": "x" });
  TS.currentDir.value = "data/sub";
  R.startRename("data");
  await R.endRename("input");
  assert.equal(TS.currentDir.value, "input/sub");
  assert.deepEqual(TS.focusWanted.value, { path: "input" });
});

test("Enter with the name unchanged writes nothing and still gives the focus back to the row", async () => {
  await reset({ "a.do": "a" });
  R.startRename("a.do");
  const calls = await counting(() => R.endRename("a.do"));
  assert.deepEqual(calls, []);
  assert.equal(R.renaming.value, null);
  assert.deepEqual(TS.focusWanted.value, { path: "a.do" });
});

test("Esc cancels: nothing is written, the focus goes back to the row", async () => {
  await reset({ "a.do": "a" });
  R.startRename("a.do");
  const calls = await counting(() => R.endRename(null));
  assert.deepEqual(calls, []);
  assert.equal(R.renaming.value, null);
  assert.deepEqual(TS.focusWanted.value, { path: "a.do" });
});

test("a name that cannot be used keeps the field open with the reason under it, and says it; typing clears the reason", async () => {
  await reset({ "a.do": "a", "b.do": "b" });
  R.startRename("a.do");
  const field = R.renaming.value!;
  await R.endRename("b.do");
  assert.equal(R.renaming.value!.problem, "b.do already exists here.");
  assert.equal(R.renaming.value!.id, field.id, "the same field");
  assert.equal(TS.focusWanted.value, null);
  assert.equal(await said(), "b.do already exists here.");
  R.clearProblem(R.renaming.value!);
  assert.equal(R.renaming.value!.problem, null);
  await R.endRename("x/y.do");
  assert.match(R.renaming.value!.problem ?? "", /can't contain/);
  await R.endRename("  ");
  assert.equal(R.renaming.value!.problem, "Enter a name.");
  assert.deepEqual(await paths(), ["a.do", "b.do"]);
});

test("a name the list calls free but the store has: the field says it exists; a source the store has lost: the field says it is not allowed", async () => {
  await reset({ "a.do": "a" });
  await store.write("b.do", enc("b")); // the list was not read again
  R.startRename("a.do");
  await R.endRename("b.do");
  assert.equal(R.renaming.value!.problem, "b.do already exists here.");
  await reset({ "a.do": "a" });
  R.startRename("a.do");
  await store.remove("a.do");
  await R.endRename("c.do");
  assert.equal(R.renaming.value!.problem, NOT_ALLOWED);
});

test("Enter, then the blur as the field goes: one rename", async () => {
  await reset({ "a.do": "a" });
  R.startRename("a.do");
  const field = R.renaming.value!;
  const calls = await counting(async () => {
    const enter = R.endRename("b.do");
    const leave = R.leaveField(field, "b.do");
    await Promise.all([enter, leave]);
  });
  assert.deepEqual(calls, ["rename a.do b.do"]);
  assert.deepEqual(await paths(), ["b.do"]);
  assert.equal(R.renaming.value, null);
});

test("leaving a rename's field: a usable name renames, the same name or a name that cannot be used cancels", async () => {
  await reset({ "a.do": "a", "b.do": "b" });
  R.startRename("a.do");
  await R.leaveField(R.renaming.value!, "c.do");
  assert.deepEqual(await paths(), ["b.do", "c.do"]);
  assert.equal(R.renaming.value, null);
  assert.deepEqual(TS.focusWanted.value, { path: "c.do" });
  R.startRename("b.do");
  await R.leaveField(R.renaming.value!, "c.do"); // taken
  assert.deepEqual(await paths(), ["b.do", "c.do"]);
  assert.equal(R.renaming.value, null, "cancelled, not kept open");
  assert.deepEqual(TS.focusWanted.value, { path: "b.do" });
  R.startRename("b.do");
  await R.leaveField(R.renaming.value!, "b.do");
  assert.equal(R.renaming.value, null);
  R.startRename("b.do");
  await R.leaveField(R.renaming.value!, "a/b.do"); // cannot be used
  assert.deepEqual(await paths(), ["b.do", "c.do"]);
  assert.equal(R.renaming.value, null);
});

test("a field that another field has replaced is left alone: its blur does nothing, and its rename's end does not take the focus", async () => {
  await reset({ "a.do": "a", "c.do": "c" });
  R.startRename("a.do");
  const first = R.renaming.value!;
  R.startRename("c.do");
  await R.leaveField(first, "x.do");
  assert.deepEqual(await paths(), ["a.do", "c.do"]);
  assert.equal(R.renaming.value!.path, "c.do");
  R.startRename("a.do");
  const slow = R.endRename("b.do");
  R.startRename("c.do"); // started while the rename writes
  await slow;
  assert.deepEqual(await paths(), ["b.do", "c.do"]);
  assert.equal(R.renaming.value!.path, "c.do", "the new field stays");
  assert.equal(TS.focusWanted.value, null, "and no row is asked to take the focus");
});

// ---- drafts ----

test("a draft's Esc writes nothing and gives the focus back to the row the field came from", async () => {
  await reset({ "a.do": "a" });
  TS.rovingPath.value = "a.do";
  R.startDraft("file", "");
  const calls = await counting(() => R.endRename(null));
  assert.deepEqual(calls, []);
  assert.equal(R.renaming.value, null);
  assert.equal(TS.rovingPath.value, "a.do");
  assert.deepEqual(TS.focusWanted.value, { path: null, anywhere: false }, "the row in the tab order");
  assert.deepEqual(await paths(), ["a.do"]);
});

test("Enter in a file draft writes the typed name, opens it, lists it, and asks the focus for its row", async () => {
  await reset({ "a.do": "a" });
  R.startDraft("file", "");
  await R.endRename("clean.do");
  assert.deepEqual(await paths(), ["a.do", "clean.do"]);
  assert.equal(R.renaming.value, null);
  assert.deepEqual(TS.focusWanted.value, { path: "clean.do" });
  await sleep(50); // the file opens without the draft waiting for it
  assert.equal(D.activeTab.value, "clean.do");
});

test("Enter in a folder draft writes the folder and opens no tab", async () => {
  await reset();
  R.startDraft("folder", "");
  await R.endRename("data");
  assert.deepEqual(
    S.files.value.map((f) => [f.path, f.dir]),
    [["data", true]],
  );
  assert.deepEqual(D.tabs.value, []);
  assert.deepEqual(TS.focusWanted.value, { path: "data" });
});

test("Enter in a draft with an empty or unchanged name writes the free default", async () => {
  await reset({ "untitled.do": "" });
  R.startDraft("file", "");
  assert.equal(R.renaming.value!.path, "untitled-2.do");
  await R.endRename("  ");
  assert.deepEqual(await paths(), ["untitled-2.do", "untitled.do"]);
  R.startDraft("file", "");
  await R.endRename("untitled-3.do");
  assert.deepEqual(await paths(), ["untitled-2.do", "untitled-3.do", "untitled.do"]);
});

test("a draft's name may be a path: the folders it goes through are made and unfolded", async () => {
  await reset();
  TS.folded.value = new Set(["sub"]);
  R.startDraft("file", "");
  await R.endRename("sub/deep/x.do");
  assert.deepEqual(await paths(), ["sub", "sub/deep", "sub/deep/x.do"]);
  assert.deepEqual([...TS.folded.value], []);
  assert.deepEqual(TS.focusWanted.value, { path: "sub/deep/x.do" });
});

test("Enter in a draft with a name in use keeps the field open with the reason; a name the list lacks but the store has says so too", async () => {
  await reset({ "a.do": "a", "data/x.do": "x" });
  R.startDraft("file", "");
  const calls = await counting(() => R.endRename("a.do"));
  assert.deepEqual(calls, []);
  assert.equal(R.renaming.value!.problem, "a.do already exists here.");
  assert.equal(R.renaming.value!.draft, "file");
  await R.endRename("a.do/y.do");
  assert.equal(R.renaming.value!.problem, "a.do is a file, not a folder.");
  await store.write("late.do", enc("l"));
  await R.endRename("late.do");
  assert.equal(R.renaming.value!.problem, "late.do already exists here.");
  assert.deepEqual(await paths(), ["a.do", "data", "data/x.do", "late.do"]);
  assert.equal((await store.read("late.do")).length, 1, "the file in the way is untouched");
});

test("leaving a draft's field writes the typed name, opens nothing, and leaves the focus where the visitor tapped", async () => {
  await reset({ "a.do": "a" });
  TS.rovingPath.value = "a.do";
  R.startDraft("file", "");
  await R.leaveField(R.renaming.value!, "clean.do");
  assert.deepEqual(await paths(), ["a.do", "clean.do"]);
  assert.equal(R.renaming.value, null);
  assert.equal(TS.focusWanted.value, null);
  assert.deepEqual(D.tabs.value, []);
  assert.equal(TS.rovingPath.value, "a.do", "the draft's path is not a row");
});

test("leaving a draft's field with a name that cannot be used writes the free default and a toast says so", async () => {
  await reset({ "a.do": "a" });
  R.startDraft("file", "");
  await R.leaveField(R.renaming.value!, "a.do");
  assert.deepEqual(await paths(), ["a.do", "untitled.do"]);
  assert.equal(S.toast.value, "a.do already exists here. Made untitled.do instead.");
  assert.equal(R.renaming.value, null);
  assert.equal(TS.focusWanted.value, null);
  R.startDraft("folder", "");
  await R.leaveField(R.renaming.value!, "../x");
  assert.deepEqual(await paths(), ["a.do", "folder", "untitled.do"]);
  assert.match(S.toast.value ?? "", /Made folder instead\.$/);
  await store.write("b.do", enc("b")); // in the store, not in the list
  R.startDraft("file", "");
  await R.leaveField(R.renaming.value!, "b.do");
  assert.deepEqual(await paths(), ["a.do", "b.do", "folder", "untitled-2.do", "untitled.do"].sort());
  assert.equal(S.toast.value, "b.do already exists here. Made untitled-2.do instead.");
});

test("a draft whose write fails closes the field, says so, and asks the focus for the tree", async () => {
  await reset({ "a.do": "a" });
  R.startDraft("file", "");
  const { write } = store;
  store.write = async () => {
    throw new Error("quota");
  };
  try {
    await R.endRename("x.do");
  } finally {
    store.write = write;
  }
  assert.equal(R.renaming.value, null);
  assert.deepEqual(TS.focusWanted.value, { path: null, anywhere: false });
  assert.equal(await said(), "Couldn't create the file");
  assert.deepEqual(await paths(), ["a.do"]);
});

test("a draft's end while another field was started: that field stays and no row is asked for the focus", async () => {
  await reset({ "a.do": "a" });
  R.startDraft("file", "");
  const slow = R.endRename("x.do");
  R.startRename("a.do");
  await slow;
  assert.deepEqual(await paths(), ["a.do", "x.do"]);
  assert.equal(R.renaming.value!.path, "a.do");
  assert.equal(R.renaming.value!.draft, undefined);
  assert.equal(TS.focusWanted.value, null);
});
