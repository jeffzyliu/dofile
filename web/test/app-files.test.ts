// The files controller (src/app/files.ts): the storage banner, what a run rewrites, Download all.

import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { sleep } from "./harness.ts";
import { afterRun, banners, downloadAll, heard, keep, later, S, setUp, store, useWiring, writable } from "./wiring.ts";

useWiring();

// keepFiles answers at once with persisted(), and again when persist() is answered; the page's signal gets each answer.
test("a false persisted() reaches the `persisted` signal, and persist()'s answer follows it", async () => {
  const asked = later<boolean>();
  const storage = { persisted: async () => false, persist: () => asked };
  await keep(storage);
  assert.equal(S.persisted.value, false);
  storage.persisted = async () => true;
  asked.ok(true);
  await sleep(5);
  assert.equal(S.persisted.value, true);
});

test("the storage banner: once per visit, when persisted() is false and the files change", async () => {
  setUp();
  store.blocked = false;
  writable(S.persisted).value = true;
  store.onChange!();
  assert.deepEqual(banners(), []);
  writable(S.persisted).value = false;
  store.onChange!();
  assert.deepEqual(banners(), [{ b: "storage" }]);
  S.dismiss({ b: "storage" });
  store.onChange!();
  await afterRun([{ name: "out.csv", status: "created", bytes: 1 }]);
  assert.deepEqual(banners(), [], "once per visit");
  setUp(); // a new visit
  await afterRun([{ name: "out.csv", status: "created", bytes: 1 }]);
  assert.deepEqual(banners(), [{ b: "storage" }], "a run's files count too");
});

test("a run that rewrites an open file: the editor follows it (ranOver); the banner when it keeps the tab's text: edits, or a version that is not text; nothing for the same text", async () => {
  setUp();
  store.blocked = false;
  const { editorCommands } = await import("../src/app/editor/commands.ts");
  const calls: string[] = [];
  const kept = { reload: editorCommands.reload, ranOver: editorCommands.ranOver };
  // the editor's answers, as Editor.tsx gives them: the same text again, a clean tab shown, edits (or not text) kept
  const answers: Record<string, "same" | "shown" | "kept"> = {
    "t.csv": "shown",
    "out.log": "kept",
    "same.log": "same",
    "bin.csv": "kept",
  };
  editorCommands.reload = (path, text) => calls.push(`reload ${path} ${text}`);
  editorCommands.ranOver = (path, text) => {
    calls.push(`ranOver ${path} ${text}`);
    return answers[path];
  };
  const read = store.read;
  store.read = async (path) => (path === "bin.csv" ? new Uint8Array([0x9e, 0xff, 0x00]) : read(path));
  try {
    writable(S.tabs).value = [
      { path: "t.csv", kind: "text", dirty: false },
      { path: "out.log", kind: "text", dirty: true },
      { path: "same.log", kind: "text", dirty: true },
      { path: "bin.csv", kind: "text", dirty: false },
      { path: "d.dta", kind: "dta", dirty: false },
    ];
    for (const p of ["t.csv", "out.log", "same.log", "d.dta", "other.csv"]) store.texts.set(p, `new ${p}`);
    await afterRun([
      { name: "t.csv", status: "modified", bytes: 9 },
      { name: "out.log", status: "modified", bytes: 9 },
      { name: "same.log", status: "modified", bytes: 9 },
      { name: "bin.csv", status: "modified", bytes: 3 },
      { name: "d.dta", status: "modified", bytes: 9 },
      { name: "other.csv", status: "created", bytes: 9 },
      { name: "gone.do", status: "removed", bytes: 0 },
    ]);
    assert.deepEqual(calls.sort(), [
      "ranOver bin.csv null", // not text: null, not left alone
      "ranOver out.log new out.log",
      "ranOver same.log new same.log",
      "ranOver t.csv new t.csv",
    ]);
    assert.deepEqual(
      banners()
        .map((b) => b.path)
        .sort(),
      ["bin.csv", "out.log"],
      "a banner where the editor kept its text; none for the same text or a clean tab shown",
    );
    // a store that cannot be read: nothing is known of the run's version, so nothing is done
    calls.length = 0;
    store.read = async () => {
      throw new Error("the store failed");
    };
    await afterRun([{ name: "t.csv", status: "modified", bytes: 9 }]);
    assert.deepEqual(calls, []);
  } finally {
    Object.assign(editorCommands, kept);
    store.read = read;
    writable(S.tabs).value = [];
  }
});

test("Download all with nothing to download (no files, or folders only) makes no zip, says nothing and resolves false", async () => {
  setUp();
  store.blocked = false;
  await heard();
  writable(S.announce).value = "";
  let zips = 0;
  store.zip = async () => {
    zips++;
    return new Blob([]);
  };
  assert.equal(await downloadAll(), false);
  store.list = async () => [{ path: "data", dir: true, size: 0, mtime: 1 }];
  await afterRun([]); // lists the store again
  assert.equal(S.hasFiles.value, false, "a folder is not a file");
  assert.equal(await downloadAll(), false);
  assert.equal(zips, 0, "no empty zip");
  assert.equal(await heard(), "", "nothing said");
  assert.deepEqual(banners(), [], "nothing shown");
  store.list = async () => [
    { path: "data", dir: true, size: 0, mtime: 1 },
    { path: "data/a.dta", dir: false, size: 1, mtime: 1 },
  ];
  await afterRun([]);
  assert.equal(S.hasFiles.value, true);
});

test("Download all: a store that cannot make the zip adds one banner (a second failure replaces it) and says so once; a download that works removes it", async () => {
  setUp({ files: ["a.do"] });
  await heard();
  writable(S.toast).value = null;
  const warn = mock.method(console, "warn", () => {});
  store.zip = async () => {
    throw new Error("the database is closed");
  };
  const doc = globalThis.document;
  try {
    assert.equal(await downloadAll(), false);
    assert.deepEqual(banners(), [{ b: "download-failed" }]);
    assert.equal(S.toast.value, null, "no toast: the failure offers Try again, so it is a banner (SPEC 3.10)");
    assert.equal(await heard(), "Your files couldn't be downloaded");
    assert.match(String(warn.mock.calls[0].arguments[0]), /the database is closed/);
    assert.equal(await downloadAll(), false); // "Try again", failing again
    assert.deepEqual(banners(), [{ b: "download-failed" }], "replaced, not stacked");
    // a download that works: the zip goes to the browser and the banner goes
    let clicked = 0;
    globalThis.document = {
      createElement: () => ({
        click: () => {
          clicked++;
        },
        remove() {},
      }),
      body: { append() {} },
    } as unknown as Document;
    store.zip = async () => new File(["zip"], "dofile.zip");
    assert.equal(await downloadAll(), true);
    assert.equal(clicked, 1);
    assert.deepEqual(banners(), []);
  } finally {
    globalThis.document = doc;
    warn.mock.restore();
  }
});
