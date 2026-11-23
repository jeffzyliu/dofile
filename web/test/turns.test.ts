// The order of the page's file changes (src/app/files/turns.ts) on the real store module over fake-indexeddb, no view:
// how a turn's body runs, what it is refused, its time limit, the store's own order, and the turns of the file actions.

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import "fake-indexeddb/auto";

const { store } = await import("../src/app/store.ts");
const { connectFiles, refresh } = await import("../src/app/files.ts");
const A = await import("../src/app/files/actions.ts");
const { fileTurn } = await import("../src/app/files/turns.ts");

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const paths = async () => (await store.list()).map((f) => f.path).sort();

connectFiles(store, { persisted: async () => true, persist: async () => true } as never);
store.blocked = false;

beforeEach(async () => {
  for (const f of await store.list()) if (!f.path.includes("/")) await store.remove(f.path);
  await refresh();
});

test("a turn's body: each yield* io.<op> is one store call whose answer the body gets; a store error is thrown at its line, where the body can catch it", async () => {
  await store.write("a.do", enc("1"));
  const seen = await fileTurn(function* (io) {
    const before = (yield* io.list()).map((f) => f.path);
    yield* io.write("b.do", enc("2"));
    let refused = "";
    try {
      yield* io.read("none.do");
    } catch (e) {
      refused = (e as Error).message;
    }
    yield* io.rename("b.do", "c.do");
    return { before, text: dec(yield* io.read("c.do")), refused };
  });
  assert.deepEqual(seen, { before: ["a.do"], text: "2", refused: "no such file: none.do" });
  await assert.rejects(
    fileTurn(function* (io) {
      yield* io.remove("a.do");
      yield* io.rename("none.do", "x.do"); // not caught: the turn rejects with it
    }),
    /no such file/,
  );
  assert.deepEqual(await paths(), ["c.do"], "what the turn did before the error stays done");
});

test("a store method that throws at once, not through its promise, is thrown at the body's line too", async (t) => {
  t.mock.method(store, "list", () => {
    throw new Error("list broke");
  });
  const caught = await fileTurn(function* (io) {
    try {
      yield* io.list();
    } catch (e) {
      return (e as Error).message;
    }
    return "";
  });
  assert.equal(caught, "list broke");
});

test("a turn's body that yields anything but a store operation is refused", async () => {
  const body = function* () {
    yield Promise.resolve();
  };
  // @ts-expect-error a generator that yields a promise is not a turn's body
  await assert.rejects(fileTurn(body), /not a store operation/);
});

test("a turn started inside a turn's body is refused: that call rejects, the outer turn rejects too, and the chain goes on", async () => {
  let inner: Promise<unknown> | undefined;
  const outer = fileTurn(function* (io) {
    yield* io.list();
    inner = fileTurn(function* (io) {
      yield* io.list();
    });
    return "done";
  });
  await assert.rejects(outer, /a turn cannot start inside another turn/);
  assert.ok(inner);
  await assert.rejects(inner, /a turn cannot start inside another turn/);
  assert.deepEqual(
    await fileTurn(function* (io) {
      return yield* io.list();
    }),
    [],
  );
});

test("a store call that does not answer in time rejects its turn (TurnTimeout) and ends its body there; the store may still apply it, and the next turn runs after it", async (t) => {
  const { write } = store;
  let late = () => {};
  store.write = (path, data) =>
    new Promise((ok, no) => {
      late = () => write.call(store, path, data).then(ok, no); // the store gets to it later
    });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let after = false;
  let ended = false;
  const turn = fileTurn(function* (io) {
    try {
      yield* io.write("late.do", enc("late"));
      after = true;
    } finally {
      ended = true;
    }
  });
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); // the turn reaches its write
  t.mock.timers.tick(10 * 60_000);
  try {
    await assert.rejects(turn, { name: "TurnTimeout", message: /did not answer write late\.do.*may still do it/ });
  } finally {
    t.mock.timers.reset();
    store.write = write;
  }
  assert.equal(after, false, "the body is not told the write was done");
  assert.equal(ended, true, "its finally block ran");
  late();
  const text = await fileTurn(function* (io) {
    return dec(yield* io.read("late.do"));
  });
  assert.equal(text, "late", "the late write is applied before the next turn's read");
});

test("the store applies and answers the page's calls in the order they are made (02-F10)", async () => {
  await store.write("a.do", enc("1"));
  const order: string[] = [];
  const note = (name: string, call: Promise<unknown>) =>
    call.then(
      () => order.push(name),
      () => order.push(`${name} refused`),
    );
  await Promise.all([
    note("write a.do", store.write("a.do", enc("2"))),
    note("rename a.do b.do", store.rename("a.do", "b.do")),
    note(
      "read b.do",
      store.read("b.do").then((b) => assert.equal(dec(b), "2")),
    ),
    note("write a.do again", store.write("a.do", enc("3"))),
    note(
      "list",
      store.list().then((l) => assert.deepEqual(l.map((f) => f.path).sort(), ["a.do", "b.do"])),
    ),
    note("remove b.do", store.remove("b.do")),
    note(
      "read a.do",
      store.read("a.do").then((b) => assert.equal(dec(b), "3")),
    ),
  ]);
  assert.deepEqual(order, [
    "write a.do",
    "rename a.do b.do",
    "read b.do",
    "write a.do again",
    "list",
    "remove b.do",
    "read a.do",
  ]);
});

test("Delete all lists the store in its turn: a file a turn made before it is deleted too", async () => {
  await store.write("a.do", enc("1"));
  const made = A.createEntry("file");
  const all = A.deleteAll();
  assert.equal(await made, "untitled.do");
  await all;
  assert.deepEqual(await paths(), []);
});
