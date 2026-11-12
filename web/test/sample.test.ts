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
const { connectFiles, refresh } = await import("../src/app/files.ts");
const { editorCommands } = await import("../src/app/editor/commands.ts");
const sample = await import("../src/app/sample.ts");

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const names = async () =>
  (await store.list())
    .filter((f) => !f.dir)
    .map((f) => f.path)
    .sort();

const reloads: [string, string][] = [];
(editorCommands as Record<string, unknown>).open = () => {};
(editorCommands as Record<string, unknown>).reload = (p: string, t: string) => void reloads.push([p, t]);
connectFiles(store, { persisted: async () => true, persist: async () => true } as never);
store.blocked = false;

async function empty() {
  for (const f of await store.list()) if (!f.path.includes("/")) await store.remove(f.path);
  await refresh();
  memory.clear();
  S.tabs.value = [];
  S.activeTab.value = null;
  S.dialog.value = null;
  S.layout.value = "desktop";
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
