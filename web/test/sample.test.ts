// The sample project's page logic (src/app/sample.ts) on the page's real store over fake-indexeddb, no DOM: the first
// visit writes it into an empty store and opens analysis.do, and never over a visitor's own files; "Restore the sample"
// is an upload of it (writes what is missing, asks in the clash dialog before it replaces a file that differs, opens
// analysis.do) and touches no other file. Also: the generated
// module is what scripts/make-sample.ts makes from web/sample/, and the files are free of anything but our own words
// (test/site.test.ts has the clean-room greps). test/sample-run.test.ts runs the do-files in the engine.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import "fake-indexeddb/auto";
import { effect } from "@preact/signals-core";
import { moduleText } from "../scripts/make-sample.ts";
import type { ClashAnswer } from "../src/app/files/actions.ts";

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
const { afterRun, connectFiles, keep, own, refresh } = await import("../src/app/files.ts");
const { editorCommands } = await import("../src/app/editor/commands.ts");
const A = await import("../src/app/files/actions.ts");
const { answerClash, clashNow } = A;
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

/** Answer the clash dialogs of a restore, in order; returns what each one showed. */
function answering(answers: ClashAnswer[]) {
  const seen: { dialog: unknown; words: unknown }[] = [];
  const stop = effect(() => {
    const d = S.dialog.value;
    if (d?.d !== "clash") return;
    seen.push({ dialog: d, words: clashNow()?.words });
    queueMicrotask(() => {
      S.dialog.value = null;
      answerClash(answers.shift() ?? "stop");
    });
  });
  return { seen, stop };
}

test("Restore the sample: missing files are written with no question, other files are left alone, analysis.do opens", async () => {
  await store.write("mine.do", enc("display 1"));
  await sample.restoreSample();
  assert.equal(S.dialog.value, null);
  assert.deepEqual(await names(), [...ALL, "mine.do"].sort());
  assert.equal(S.toast.value, "Sample restored");
  assert.equal(dec(await store.read("mine.do")), "display 1");
  assert.equal(S.activeTab.value, "analysis.do");
  S.tabs.value = [];
  S.activeTab.value = null;
  S.showToast("sentinel");
  await sample.restoreSample();
  assert.equal(S.toast.value, "The sample is already here", "nothing to write, nothing asked");
  assert.equal(S.activeTab.value, "analysis.do", "opened even when nothing was written");
});

test("Restore the sample asks about a file that differs, in the clash dialog with the sample's words; Keep mine writes nothing, Replace writes the sample's version; analysis.do opens either way", async () => {
  await sample.seedSample();
  await store.write("helpers.do", enc("* mine"));
  S.tabs.value = [{ path: "helpers.do", kind: "text", dirty: false }];
  S.activeTab.value = "helpers.do";
  const keep = answering([{ replace: false, same: false }]);
  await sample.restoreSample();
  keep.stop();
  assert.deepEqual(keep.seen, [
    { dialog: { d: "clash", path: "helpers.do", index: 1, total: 1 }, words: A.WORDS.sample },
  ]);
  assert.equal(dec(await store.read("helpers.do")), "* mine", "kept");
  assert.deepEqual(reloads, []);
  assert.equal(S.activeTab.value, "analysis.do", "the tab of analysis.do, which the visitor never changed");
  S.activeTab.value = "helpers.do";
  const replace = answering([{ replace: true, same: false }]);
  await sample.restoreSample();
  replace.stop();
  assert.equal(dec(await store.read("helpers.do")), dec(sample.sampleFiles()[1].bytes));
  assert.deepEqual(
    reloads.map((r) => r[0]),
    ["helpers.do"],
    "the open tab shows the restored text",
  );
  assert.equal(S.toast.value, "Sample restored");
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

test("Restore the sample asks about a sample file open with unsaved edits, even when its stored copy is the sample's; Replace shows the sample's text in the tab", async () => {
  await sample.seedSample();
  S.tabs.value = [{ path: "analysis.do", kind: "text", dirty: true }];
  const { seen, stop } = answering([{ replace: true, same: false }]);
  await sample.restoreSample();
  stop();
  assert.deepEqual(
    seen.map((s) => s.dialog),
    [{ d: "clash", path: "analysis.do", index: 1, total: 1 }],
  );
  assert.deepEqual(
    reloads.map((r) => r[0]),
    ["analysis.do"],
  );
  // the editor is given the file's text as it reads a file: the sample's own form, "\n" and no BOM (its Save then keeps it)
  const given = reloads[0][1];
  assert.equal(given, dec(sample.sampleFiles()[0].bytes));
  assert.ok(!given.includes("\r") && !given.startsWith("\uFEFF"));
});

test("Restore the sample over an open tab whose file has \\r\\n and a BOM: the editor is given the sample's text", async () => {
  await sample.seedSample();
  await store.write("helpers.do", enc("\uFEFF* mine\r\n"));
  S.tabs.value = [{ path: "helpers.do", kind: "text", dirty: false }];
  const { stop } = answering([{ replace: true, same: false }]);
  await sample.restoreSample();
  stop();
  assert.equal(reloads[0][1], dec(sample.sampleFiles()[1].bytes));
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
    await keep(notKept); // persisted is false before anything is written
    own(); // the seed starts: it lists the store, then writes
    await store.write("mine.do", enc("display 1")); // the visitor's upload, while the seed is in progress
    assert.equal(storageBanner(), true);
  } finally {
    await new Promise((r) => setTimeout(r, 50));
    connectFiles(store, kept);
    store.blocked = false;
  }
});
