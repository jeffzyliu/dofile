// The sample project's page logic (src/app/sample.ts) on the page's real store over fake-indexeddb, no DOM: the first
// visit writes it into an empty store and opens analysis.do, and never over a visitor's own files; "Restore the sample"
// writes what is missing, asks before it replaces a file that differs, and touches no other file. Also: the generated
// module is what scripts/make-sample.ts makes from web/sample/, and the files are free of anything but our own words
// (test/site.test.ts has the clean-room greps). test/sample-run.test.ts runs the do-files in the engine.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import "fake-indexeddb/auto";
import { moduleText } from "../scripts/make-sample.ts";

// localStorage and a page's location, which Node lacks: state.ts reads the first at load, sample.ts the second when called
const memory = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  },
});
const page = (search = "") => Object.assign(globalThis, { location: { search } });

const S = await import("../src/app/state.ts");
const { store } = await import("../src/app/store.ts");
const { afterRun, connectFiles, own, refresh } = await import("../src/app/files.ts");
const { editorCommands } = await import("../src/app/editor/commands.ts");
const sample = await import("../src/app/sample.ts");

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const names = async () =>
  (await store.list())
    .filter((f) => !f.dir)
    .map((f) => f.path)
    .sort();

const kept = { persisted: async () => true, persist: async () => true } as never;
const notKept = { persisted: async () => false, persist: async () => false } as never;
const storageBanner = () => S.banners.value.some((b) => b.b === "storage");

const reloads: [string, string][] = [];
(editorCommands as Record<string, unknown>).open = () => {};
(editorCommands as Record<string, unknown>).reload = (p: string, t: string) => void reloads.push([p, t]);
connectFiles(store, kept);
store.blocked = false;

async function empty() {
  for (const f of await store.list()) if (!f.path.includes("/")) await store.remove(f.path);
  await refresh();
  memory.clear();
  S.tabs.value = [];
  S.activeTab.value = null;
  S.dialog.value = null;
  S.layout.value = "desktop";
  for (const b of S.banners.value) S.dismiss(b);
  reloads.length = 0;
}
beforeEach(async () => {
  await empty();
  page();
});

const ALL = ["analysis.do", "data/wages.dta", "helpers.do"];

test("the generated module is what scripts/make-sample.ts makes from web/sample/", () => {
  const file = fileURLToPath(new URL("../src/app/sample-files.ts", import.meta.url));
  assert.equal(readFileSync(file, "utf8"), moduleText(), "run `npm run sample`");
});

test("a first visit with an empty store writes the sample and opens analysis.do", async () => {
  assert.equal(await sample.seedSample(), true);
  assert.deepEqual(await names(), ALL);
  assert.equal(S.activeTab.value, "analysis.do");
  assert.equal(S.tabs.value.length, 1);
  assert.equal(dec(await store.read("analysis.do")), dec(sample.sampleFiles()[0].bytes));
  assert.equal(await sample.seedSample(), false, "only once: the mark is kept");
});

test("never over a visitor's own files, and a visitor who deleted everything is not given it again", async () => {
  await store.write("mine.do", enc("display 1"));
  assert.equal(await sample.seedSample(), false);
  assert.deepEqual(await names(), ["mine.do"]);
  // the mark is set: after a delete-all the sample does not come back by itself
  await store.remove("mine.do");
  assert.equal(await sample.seedSample(), false);
  assert.deepEqual(await names(), []);
});

test("with ?test in the URL it does nothing, unless ?sample is there too; outside a page it does nothing", async () => {
  page("?test");
  assert.equal(await sample.seedSample(), false);
  assert.deepEqual(await names(), []);
  page("?test&sample");
  assert.equal(await sample.seedSample(), true);
  await empty();
  Object.assign(globalThis, { location: undefined });
  assert.equal(await sample.seedSample(), false);
});

test("a blocked store (another tab has the files) is not written", async () => {
  store.blocked = true;
  try {
    assert.equal(await sample.seedSample(), false);
  } finally {
    store.blocked = false;
  }
  assert.deepEqual(await names(), []);
});

test("Restore the sample: missing files are written with no question, other files are left alone", async () => {
  await store.write("mine.do", enc("display 1"));
  await sample.restoreSample();
  assert.equal(S.dialog.value, null);
  assert.deepEqual(await names(), [...ALL, "mine.do"].sort());
  assert.equal(S.toast.value, "Sample restored");
  assert.equal(dec(await store.read("mine.do")), "display 1");
  await sample.restoreSample();
  assert.equal(S.toast.value, "The sample is already here");
});

test("Restore the sample asks before it replaces a file that differs, and names it; Replace writes the sample's version, then opens analysis.do", async () => {
  await sample.seedSample();
  await store.write("helpers.do", enc("* mine"));
  S.tabs.value = [{ path: "helpers.do", kind: "text", dirty: false }];
  await sample.restoreSample();
  assert.deepEqual(S.dialog.value, { d: "restore-sample", paths: ["helpers.do"] });
  assert.equal(dec(await store.read("helpers.do")), "* mine", "nothing is replaced before the answer");
  S.dialog.value = null; // Cancel
  assert.equal(dec(await store.read("helpers.do")), "* mine");
  await sample.replaceWithSample();
  assert.equal(dec(await store.read("helpers.do")), dec(sample.sampleFiles()[1].bytes));
  assert.deepEqual(
    reloads.map((r) => r[0]),
    ["helpers.do"],
    "the open tab shows the restored text",
  );
  assert.equal(S.activeTab.value, "analysis.do");
});

test("a seed whose write fails sets no mark, never rejects, and is tried again on a later visit to an empty store", async () => {
  const write = store.write;
  (store as { write: unknown }).write = async () => {
    throw new Error("quota");
  };
  try {
    assert.equal(await sample.seedSample(), false);
  } finally {
    (store as { write: unknown }).write = write;
  }
  assert.deepEqual(await names(), []);
  assert.equal(memory.get("dofile.sample"), undefined, "no mark: the sample is not there");
  assert.equal(await sample.seedSample(), true);
  assert.deepEqual(await names(), ALL);
  assert.equal(memory.get("dofile.sample"), "1");
});

test("a seed whose opening of analysis.do throws resolves (no unhandled rejection), with the files written", async () => {
  const open = editorCommands.open;
  (editorCommands as Record<string, unknown>).open = () => {
    throw new Error("no editor");
  };
  try {
    assert.equal(await sample.seedSample(), false);
  } finally {
    (editorCommands as Record<string, unknown>).open = open;
  }
  assert.deepEqual(await names(), ALL);
});

test("Restore the sample asks about a sample file open with unsaved edits, even when its stored copy is the sample's", async () => {
  await sample.seedSample();
  S.tabs.value = [{ path: "analysis.do", kind: "text", dirty: true }];
  await sample.restoreSample();
  assert.deepEqual(S.dialog.value, { d: "restore-sample", paths: ["analysis.do"] });
  assert.deepEqual(reloads, [], "nothing is reloaded before the answer");
  S.dialog.value = null;
  // missing too: still asked, not written silently over the edits
  await store.remove("analysis.do");
  await sample.restoreSample();
  assert.deepEqual(S.dialog.value, { d: "restore-sample", paths: ["analysis.do"] });
  assert.equal((await names()).includes("analysis.do"), false);
  await sample.replaceWithSample();
  assert.deepEqual(
    reloads.map((r) => r[0]),
    ["analysis.do"],
    "Replace shows the sample's text in the tab",
  );
  assert.ok((await names()).includes("analysis.do"));
});

// S 19: where the browser may clear the files, the sample's own writes bring no storage banner; the visitor's first change does
async function seededWithoutStorage() {
  connectFiles(store, notKept);
  own();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 100 && (await names()).length < ALL.length; i++) await new Promise((r) => setTimeout(r, 5));
  await new Promise((r) => setTimeout(r, 20)); // the seed's open and the persisted() answer
  assert.deepEqual(await names(), ALL);
  assert.equal(S.persisted.value, false);
  assert.equal(storageBanner(), false, "the sample's writes bring no banner");
}

for (const [what, change] of [
  ["a Save (a write of the visitor's)", () => store.write("analysis.do", enc("* mine\n"))],
  ["an upload of a new file", () => store.write("mine.do", enc("display 1"))],
  ["a run that writes a file", () => afterRun([{ name: "out.csv", status: "created", bytes: 1 }])],
] as const) {
  test(`after the first visit's sample, ${what} brings the storage banner`, async () => {
    try {
      await seededWithoutStorage();
      await change();
      assert.equal(storageBanner(), true);
    } finally {
      connectFiles(store, kept);
      store.blocked = false;
    }
  });
}

test("a change of the visitor's made while the first visit's sample is being written brings the storage banner", async () => {
  try {
    connectFiles(store, notKept);
    own(); // the seed starts: it lists the store, then writes
    await store.write("mine.do", enc("display 1")); // the visitor's upload, while the seed is in progress
    assert.equal(storageBanner(), true);
  } finally {
    await new Promise((r) => setTimeout(r, 50));
    connectFiles(store, kept);
    store.blocked = false;
  }
});
