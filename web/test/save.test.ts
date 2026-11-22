// Save (src/app/editor/documents.ts save) on the real store module over fake-indexeddb, no view: its turn against a
// rename and a delete, and the Save rule (docs/design/workspace.md, section 3): a reload, "Reload from the run", an
// upload's Replace or a run's text shown in the tab cancels a pending Save of that tab.

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import "fake-indexeddb/auto";
import { effect } from "@preact/signals-core";
import type { ClashAnswer } from "../src/app/files/actions.ts";

const S = await import("../src/app/state.ts");
const { store } = await import("../src/app/store.ts");
const { connectFiles, refresh, afterRun, reloadFromStore } = await import("../src/app/files.ts");
const D = await import("../src/app/editor/documents.ts");
const { openFile } = await import("../src/app/files/open.ts");
const A = await import("../src/app/files/actions.ts");
const { fileTurn } = await import("../src/app/files/turns.ts");

const enc = (s: string) => new TextEncoder().encode(s);
const stored = async (path: string) => new TextDecoder("utf-8", { ignoreBOM: true }).decode(await store.read(path));
const has = async (path: string) => (await store.list()).some((f) => f.path === path);
const edit = (path: string, insert = "edited ") => D.update(path, { changes: { from: 0, insert } });
const tab = (path: string) => D.tabs.value.find((t) => t.path === path);

connectFiles(store, { persisted: async () => true, persist: async () => true } as never);
store.blocked = false;

beforeEach(async () => {
  for (const f of await store.list()) if (!f.path.includes("/")) await store.remove(f.path);
  await refresh();
  for (const t of D.tabs.value) D.close(t.path);
  for (const b of S.banners.value) S.dismiss(b);
  S.dialog.value = null;
});

/** Open `path` with `text` in the store, as the active tab. */
async function opened(path: string, text: string) {
  await store.write(path, enc(text));
  await refresh();
  await openFile(path);
}

/** A turn that holds the chain until `open()`: a Save pressed meanwhile is pending. */
function hold() {
  let open = () => {};
  const held = new Promise<void>((r) => {
    open = r;
  });
  fileTurn(() => held);
  return open;
}

/** Answer each clash dialog as it opens with `a`. */
function answering(a: ClashAnswer) {
  return effect(() => {
    if (S.dialog.value?.d !== "clash") return;
    queueMicrotask(() => {
      S.dialog.value = null;
      A.answerClash(a);
    });
  });
}

test("Save writes the tab's text in the file's form and clears the dot and the banners; a keystroke typed while it waits is not saved and keeps the dot", async () => {
  await opened("win.csv", "\uFEFFa\r\nb\r\n");
  edit("win.csv", "x");
  S.addBanner({ b: "run-changed", path: "win.csv" });
  const open = hold();
  const saved = D.save();
  edit("win.csv", "y"); // typed after Save was pressed
  open();
  assert.equal(await saved, true);
  assert.equal(await stored("win.csv"), "\uFEFFxa\r\nb\r\n", "the text when pressed, BOM and CRLF kept");
  assert.equal(tab("win.csv")?.dirty, true, "the later keystroke is unsaved");
  assert.deepEqual(S.banners.value, []);
  edit("win.csv", ""); // no change
  D.update("win.csv", { changes: { from: 0, to: 1, insert: "" } }); // undo the keystroke by hand
  assert.equal(tab("win.csv")?.dirty, false, "the saved text is what Save wrote");
});

test("Save: no tab, or a .dta tab, saves nothing; a store that refuses gives the save-failed banner", async () => {
  assert.equal(await D.save("none.do"), false);
  D.addDta("w.dta");
  assert.equal(await D.save("w.dta"), false);
  await opened("a.do", "1");
  edit("a.do");
  const write = store.write;
  store.write = async () => {
    throw new Error("the disk is full");
  };
  try {
    assert.equal(await D.save("a.do"), false);
  } finally {
    store.write = write;
  }
  assert.deepEqual(
    S.banners.value.map((b) => [b.b, "path" in b ? b.path : null]),
    [["save-failed", "a.do"]],
  );
  assert.equal(tab("a.do")?.dirty, true);
});

test("Save against rename: a rename pressed before it is honoured, the text written under the new name", async () => {
  await opened("a.do", "1");
  edit("a.do");
  const open = hold();
  const renamed = A.renameEntry("a.do", "b.do");
  const saved = D.save("a.do");
  open();
  await renamed;
  assert.equal(await saved, true);
  assert.equal(await has("a.do"), false);
  assert.equal(await stored("b.do"), "edited 1");
  assert.deepEqual(D.tabs.value, [{ path: "b.do", kind: "text", dirty: false }]);
});

test("Save against rename: a Save that answers after a rename leaves its outcome on the tab under the new name", async () => {
  await opened("a.do", "1");
  edit("a.do");
  const write = store.write;
  // the write is issued at once (the store's order), its answer comes late
  store.write = (path, data) => {
    const w = write.call(store, path, data);
    return new Promise((r) => setTimeout(r, 30)).then(() => w);
  };
  let saved: Promise<boolean>;
  try {
    saved = D.save("a.do");
    await new Promise((r) => setTimeout(r, 5)); // its turn has issued the write
    await A.renameEntry("a.do", "b.do");
  } finally {
    store.write = write;
  }
  assert.equal(await saved, true);
  assert.equal(await stored("b.do"), "edited 1", "the rename moved the bytes Save wrote");
  assert.deepEqual(D.tabs.value, [{ path: "b.do", kind: "text", dirty: false }]);
});

test("Save against a rename that retypes its clean tab (a.do to a.dta): nothing is written", async () => {
  await opened("a.do", "1"); // an edited tab keeps its text under the new name: no retype
  const open = hold();
  const renamed = A.renameEntry("a.do", "a.dta");
  const saved = D.save("a.do");
  open();
  await renamed;
  assert.equal(await saved, false);
  assert.deepEqual(D.tabs.value, [{ path: "a.dta", kind: "dta", dirty: false }]);
  assert.equal(await stored("a.dta"), "1");
  assert.equal(await has("a.do"), false);
});

test("Save against delete: a delete pressed before it closes the tab, and nothing is written", async () => {
  await opened("a.do", "1");
  edit("a.do");
  const open = hold();
  const deleted = A.deleteEntries(["a.do"]);
  const saved = D.save("a.do");
  open();
  await deleted;
  assert.equal(await saved, false);
  assert.equal(await has("a.do"), false);
  assert.deepEqual(D.tabs.value, []);
  assert.deepEqual(S.banners.value, []);
});

// ---- the Save rule: the later action wins ----

test("Save rule: an upload's Replace of the tab cancels a pending Save: the store keeps the upload, the tab shows it clean", async () => {
  await opened("a.do", "mine");
  edit("a.do");
  const open = hold();
  const saved = D.save("a.do");
  const stop = answering({ replace: true, same: false });
  try {
    await A.upload([{ path: "a.do", data: enc("uploaded") }]);
  } finally {
    stop();
  }
  open();
  assert.equal(await saved, false);
  assert.equal(await stored("a.do"), "uploaded");
  assert.equal(D.textOf("a.do"), "uploaded");
  assert.equal(tab("a.do")?.dirty, false);
  assert.deepEqual(S.banners.value, []);
});

test('Save rule: "Reload from the run" cancels a pending Save of the edited tab: the store keeps the run\'s text', async () => {
  await opened("out.log", "old");
  edit("out.log");
  await store.write("out.log", enc("the run's")); // as the run wrote it
  S.addBanner({ b: "run-changed", path: "out.log" });
  const open = hold();
  const saved = D.save("out.log");
  await reloadFromStore("out.log");
  open();
  assert.equal(await saved, false);
  assert.equal(await stored("out.log"), "the run's");
  assert.equal(D.textOf("out.log"), "the run's");
  assert.equal(tab("out.log")?.dirty, false);
  assert.deepEqual(S.banners.value, [], "no save-failed banner, the run-changed one gone with the reload");
});

test("Save rule: a run's text shown in the tab cancels a pending Save: the store keeps the run's text", async () => {
  await opened("t.csv", "old");
  const open = hold();
  const saved = D.save("t.csv"); // a clean tab: Save still writes
  await store.write("t.csv", enc("the run's")); // the run's write, not a turn
  await afterRun([{ name: "t.csv", status: "modified", bytes: 9 }]);
  assert.equal(D.textOf("t.csv"), "the run's", "shown");
  open();
  assert.equal(await saved, false);
  assert.equal(await stored("t.csv"), "the run's");
  assert.equal(tab("t.csv")?.dirty, false);
});

test("a run against unsaved edits (afterRun keeps them): a Save pressed before it still writes, and replaces the run's version", async () => {
  await opened("out.log", "old");
  edit("out.log");
  const open = hold();
  const saved = D.save("out.log");
  await store.write("out.log", enc("the run's"));
  await afterRun([{ name: "out.log", status: "modified", bytes: 9 }]);
  assert.equal(D.textOf("out.log"), "edited old", "kept");
  assert.deepEqual(
    S.banners.value.map((b) => b.b),
    ["run-changed"],
  );
  open();
  assert.equal(await saved, true);
  assert.equal(await stored("out.log"), "edited old");
  assert.equal(tab("out.log")?.dirty, false);
  assert.deepEqual(S.banners.value, [], "the run-changed banner goes with the Save");
});

/** The store's reads answer after 10 ms and its writes after 30 ms, each issued at once (the store's order); `readIssued`
 *  resolves when the next read is issued. Returns the undo. */
let readIssued: Promise<void> = Promise.resolve();
function slow() {
  const { read, write } = store;
  let issued = () => {};
  readIssued = new Promise((r) => {
    issued = r;
  });
  store.read = (path) => {
    const x = read.call(store, path);
    issued();
    return new Promise((r) => setTimeout(r, 10)).then(() => x);
  };
  store.write = (path, data) => {
    const w = write.call(store, path, data);
    return new Promise((r) => setTimeout(r, 30)).then(() => w);
  };
  return () => {
    store.read = read;
    store.write = write;
  };
}

test("a Save pressed while a run's read of its clean tab waits: the write answers after the run's text is shown, so the tab is unsaved (the store has the Save's text)", async () => {
  await opened("t.csv", "old");
  await store.write("t.csv", enc("the run's"));
  const restore = slow();
  try {
    const ran = afterRun([{ name: "t.csv", status: "modified", bytes: 9 }]);
    await readIssued;
    const saved = D.save("t.csv");
    await ran;
    assert.equal(await saved, true);
  } finally {
    restore();
  }
  assert.equal(await stored("t.csv"), "old");
  assert.equal(D.textOf("t.csv"), "the run's");
  assert.equal(tab("t.csv")?.dirty, true, "the dot: the store does not have what the tab shows");
});

test('a Save pressed while "Reload from the run" reads its edited tab: once the write answers the tab is unsaved (the store has the Save\'s text)', async () => {
  await opened("out.log", "old");
  edit("out.log");
  await store.write("out.log", enc("the run's"));
  const restore = slow();
  try {
    const reloaded = reloadFromStore("out.log");
    await readIssued;
    const saved = D.save("out.log");
    await reloaded;
    assert.equal(await saved, true);
  } finally {
    restore();
  }
  assert.equal(await stored("out.log"), "edited old");
  assert.equal(D.textOf("out.log"), "the run's");
  assert.equal(tab("out.log")?.dirty, true);
});

test("Save rule: a Save pressed while a reload of the edited tab waits on its store read writes nothing; the reload wins", {
  todo: "holds once S2 puts the reload (files.ts reloadFromStore) in a turn: today the Save's turn runs during the read and writes",
}, async () => {
  await opened("out.log", "old");
  edit("out.log");
  await store.write("out.log", enc("the run's"));
  const restore = slow();
  let saved: Promise<boolean>;
  try {
    const reloaded = reloadFromStore("out.log");
    await readIssued; // the reload's read is issued before the Save's write
    saved = D.save("out.log");
    await reloaded;
    await saved;
  } finally {
    restore();
  }
  assert.equal(await saved, false);
  assert.equal(await stored("out.log"), "the run's");
  assert.equal(tab("out.log")?.dirty, false);
});
