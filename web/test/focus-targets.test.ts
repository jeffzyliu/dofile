// The focus registry (ui/focus-targets.ts): what a request or a call does for a target that is there, gone, hidden or
// not yet drawn. The elements are stand-ins with the four members the registry reads.

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ask,
  cancel,
  focusNow,
  focusRequest,
  fromAnywhere,
  fromNothing,
  register,
  shownElement,
  TARGET_NAMES,
  type TargetName,
  takeRequest,
} from "../src/app/ui/focus-targets.ts";

interface Fake {
  isConnected: boolean;
  shown: boolean;
  ownerDocument: { activeElement: unknown; body: unknown };
  getClientRects(): { length: number };
  focus(): void;
}
const doc = { activeElement: null as unknown, body: {} as { ownerDocument?: unknown } };
doc.body.ownerDocument = doc;
const fake = (over: Partial<Fake> = {}): Fake & HTMLElement => {
  const el: Fake = {
    isConnected: true,
    shown: true,
    ownerDocument: doc,
    getClientRects: () => ({ length: el.shown ? 1 : 0 }),
    focus() {
      if (el.shown) doc.activeElement = el;
    },
    ...over,
  };
  return el as Fake & HTMLElement;
};

const undo: (() => void)[] = [];
const reg = (name: TargetName, get: () => HTMLElement | null, key?: string, focus?: (el: HTMLElement) => void) => {
  undo.push(register(name, get, key, focus));
};
afterEach(() => {
  for (const u of undo.splice(0)) u();
  cancel("editor");
  cancel("more-actions");
  cancel("open-file-tab");
  doc.activeElement = doc.body;
});

test("focusNow focuses a registered target and says whether the focus is on it", () => {
  const el = fake();
  reg("editor", () => el);
  assert.equal(focusNow("editor"), true);
  assert.equal(doc.activeElement, el);
});

test("focusNow moves nothing and says false for no entry, a getter that returns null, an element gone and one not shown", () => {
  assert.equal(focusNow("editor"), false);
  reg("editor", () => null);
  assert.equal(focusNow("editor"), false);
  const gone = fake({ isConnected: false });
  reg("more-actions", () => gone);
  assert.equal(focusNow("more-actions"), false);
  const hidden = fake({ shown: false });
  reg("open-file-tab", () => hidden);
  assert.equal(focusNow("open-file-tab"), false);
  assert.equal(doc.activeElement, doc.body);
});

test("of several entries of one name the first shown one takes the focus", () => {
  const hidden = fake({ shown: false });
  const first = fake();
  const second = fake();
  reg("more-actions", () => hidden);
  reg("more-actions", () => first);
  reg("more-actions", () => second);
  assert.equal(focusNow("more-actions"), true);
  assert.equal(doc.activeElement, first);
  assert.equal(shownElement("more-actions"), first);
});

test("an entry follows its getter, and unregistering ends it", () => {
  const a = fake();
  const b = fake();
  let at: HTMLElement = a;
  const off = register("editor", () => at);
  focusNow("editor");
  assert.equal(doc.activeElement, a);
  at = b;
  focusNow("editor");
  assert.equal(doc.activeElement, b);
  off();
  assert.equal(shownElement("editor"), null);
});

test("an entry's own focus function is used", () => {
  const el = fake();
  const used: unknown[] = [];
  reg(
    "editor",
    () => el,
    undefined,
    (e) => {
      used.push(e);
      e.focus();
    },
  );
  focusNow("editor");
  assert.deepEqual(used, [el]);
});

test("a key reaches only the entry with that key", () => {
  const a = fake();
  const b = fake();
  reg("editor", () => a, "a");
  reg("editor", () => b, "b");
  assert.equal(focusNow("editor", "b"), true);
  assert.equal(doc.activeElement, b);
  assert.equal(shownElement("editor", "c"), null);
});

test("a request waits for a target registered later, and ends when taken", () => {
  ask("editor", { from: fromAnywhere });
  assert.equal(focusRequest.value?.name, "editor");
  assert.equal(takeRequest("editor"), false, "no target yet: it ends, taken or not");
  assert.equal(focusRequest.value, null);
  ask("editor", { from: fromAnywhere });
  const el = fake();
  reg("editor", () => el);
  assert.equal(takeRequest("editor"), true);
  assert.equal(doc.activeElement, el);
  assert.equal(focusRequest.value, null);
});

test("a request for another name or another key is not taken by this one", () => {
  const el = fake();
  reg("editor", () => el, "a");
  ask("more-actions", { from: fromAnywhere });
  assert.equal(takeRequest("editor", "a"), false);
  assert.equal(focusRequest.value?.name, "more-actions");
  ask("editor", { key: "b", from: fromAnywhere });
  assert.equal(takeRequest("editor", "a"), false);
  assert.equal(focusRequest.value?.key, "b");
});

test("a newer request replaces the older one, whatever its target; cancel ends only its own", () => {
  ask("editor", { from: fromAnywhere });
  ask("more-actions", { from: fromAnywhere });
  assert.equal(focusRequest.value?.name, "more-actions");
  cancel("editor");
  assert.equal(focusRequest.value?.name, "more-actions");
  cancel("more-actions");
  assert.equal(focusRequest.value, null);
});

test("a request moves the focus only when its from allows it, and ends all the same", () => {
  const el = fake();
  const other = fake();
  reg("editor", () => el);
  doc.activeElement = other;
  ask("editor", { from: fromNothing });
  assert.equal(takeRequest("editor"), false);
  assert.equal(doc.activeElement, other);
  assert.equal(focusRequest.value, null);
  doc.activeElement = doc.body;
  ask("editor", { from: fromNothing });
  assert.equal(takeRequest("editor"), true);
  assert.equal(doc.activeElement, el);
});

test("a request for a target not shown ends with no move", () => {
  const el = fake({ shown: false });
  reg("editor", () => el);
  ask("editor", { from: fromAnywhere });
  assert.equal(takeRequest("editor"), false);
  assert.equal(focusRequest.value, null);
});

// Every name in the registry has a component that registers it, and every name a component uses is in the registry
const SRC = join(fileURLToPath(new URL("..", import.meta.url)), "src/app");
const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? sources(p) : /\.tsx?$/.test(n) ? [p] : [];
  });

test("each target name is registered by a component, and a component registers no other name", () => {
  const text = sources(SRC)
    .filter((p) => !p.endsWith("focus-targets.ts"))
    .map((p) => readFileSync(p, "utf8"))
    .join("\n");
  const used = [...text.matchAll(/\buseFocusTarget\(\s*"([^"]+)"/g)].map((m) => m[1]);
  for (const name of TARGET_NAMES) assert.ok(used.includes(name), `${name} is registered by a component`);
  for (const name of used) assert.ok((TARGET_NAMES as readonly string[]).includes(name), `${name} is a target name`);
});
