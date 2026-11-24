// The worker's dispatch (src/engine/worker-dispatch.ts) over a table of stand-in handlers, without Pyodide: what is
// posted for a result and for an error, and the order of the queue. engine.test.ts runs it in the real worker.

import assert from "node:assert/strict";
import { mock, test } from "node:test";

import type { Op, ToWorker } from "../src/engine/types.ts";

import type { OpEntry, OpTable } from "../src/engine/worker-dispatch.ts";
import { dispatcher, errorForPage } from "../src/engine/worker-dispatch.ts";

const OPS: Op[] = [
  "mount",
  "boot",
  "startup",
  "run",
  "graphics",
  "describe",
  "describe_file",
  "matrix",
  "macros",
  "browse",
  "memory",
  "files",
  "read",
  "sync",
];
const ERRNO = { ENOENT: 44, EISDIR: 31 };

/** A stand-in entry: its result need not be the op's. */
type Stand = Partial<Omit<OpEntry<Op>, "handle">> & { handle?: (args: unknown, id: number) => unknown };

/** Every op answers undefined in the queue, but those given. */
function setup(entries: Partial<Record<Op, Stand>> = {}, afterResult?: () => void) {
  const posted: { message: unknown; transfer: Transferable[] }[] = [];
  const events: string[] = [];
  const table = Object.fromEntries(
    OPS.map((op) => [op, { queued: true, handle: () => undefined, ...entries[op] }]),
  ) as unknown as OpTable;
  const dispatch = dispatcher(table, {
    post: (message, transfer) => {
      posted.push({ message, transfer });
      events.push(`post ${JSON.stringify(message)}`);
    },
    errorOf: (e) => errorForPage(e, ERRNO),
    afterResult:
      afterResult ??
      (() => {
        events.push("after result");
      }),
  });
  const send = (id: number, op: string, args?: unknown) => dispatch({ id, op, args } as ToWorker);
  return { posted, events, send, messages: () => posted.map((p) => p.message) };
}
const tick = () => new Promise((ok) => setTimeout(ok, 0));
function later() {
  let open!: (v?: unknown) => void;
  const p = new Promise((ok) => {
    open = ok;
  });
  return { p, open };
}

test("an op with no entry is answered with an error, in the queue, and the queue goes on", async () => {
  const { send, messages } = setup({ macros: { handle: () => ({ globals: {} }) } });
  send(1, "nope");
  send(2, "toString"); // a name every object has is not an op
  send(3, "macros");
  await tick();
  assert.deepEqual(messages(), [
    { id: 1, error: "unknown op nope", name: "Error", type: undefined },
    { id: 2, error: "unknown op toString", name: "Error", type: undefined },
    { id: 3, result: { globals: {} } },
  ]);
});

test("a handler that throws or rejects is answered {id, error, name, type?}, and the next op still runs", async () => {
  const python = Object.assign(new Error("Traceback ... ZeroDivisionError"), {
    name: "PythonError",
    type: "ZeroDivisionError",
  });
  const answered: unknown[] = [];
  const { send, messages, events } = setup({
    matrix: {
      handle: () => {
        throw python;
      },
      answered: (failed, e) => answered.push([failed, e]),
    },
    describe: { handle: () => Promise.reject(Object.assign(new Error("x"), { errno: 44 })) },
    macros: { handle: () => Promise.reject(new RangeError("no memory")) },
    memory: { handle: () => ({ heap_bytes: 1 }) },
  });
  send(1, "matrix", { name: "r(table)" });
  send(2, "describe", {});
  send(3, "macros");
  send(4, "memory");
  await tick();
  assert.deepEqual(messages(), [
    { id: 1, error: "Traceback ... ZeroDivisionError", name: "PythonError", type: "ZeroDivisionError" },
    { id: 2, error: "file system error ENOENT", name: "ErrnoError", type: undefined },
    { id: 3, error: "no memory", name: "RangeError", type: undefined },
    { id: 4, result: { heap_bytes: 1 } },
  ]);
  assert.deepEqual(answered, [[true, python]]);
  assert.equal(events.filter((e) => e === "after result").length, 1, "afterResult follows a result, not an error");
});

test("queued ops are answered one at a time in order; an op outside the queue is answered at once", async () => {
  const run = later();
  const { send, messages, events } = setup({
    run: { handle: () => run.p.then(() => ({ rc: 0 })), arrived: () => events.push("run arrived") },
    graphics: { queued: false },
    sync: { handle: () => undefined },
  });
  send(1, "run", { code: "display 1" });
  send(2, "sync");
  send(3, "graphics");
  assert.deepEqual(events, ["run arrived"], "counted as the message arrives");
  await tick();
  assert.deepEqual(messages(), [{ id: 3, result: undefined }], "graphics is not behind the run");
  run.open();
  await tick();
  assert.deepEqual(messages(), [
    { id: 3, result: undefined },
    { id: 1, result: { rc: 0 } },
    { id: 2, result: undefined },
  ]);
  const i = events.indexOf('post {"id":1,"result":{"rc":0}}');
  assert.equal(events[i + 1], "after result", "a folder error follows the run's answer, before the next op's");
});

test("boot's answer is posted before its answered hook (which settles `booted`), on success and on failure", async () => {
  for (const fails of [false, true]) {
    const { send, events } = setup({
      boot: {
        queued: false,
        handle: async () => {
          if (fails) throw undefined; // a rejection without a reason is still a failure
          return { dofile: "0" };
        },
        answered: (failed) => events.push(`answered ${failed ? "error" : "ok"}`),
      },
    });
    send(7, "boot", {});
    await tick();
    assert.deepEqual(
      events.filter((e) => !e.startsWith("after")),
      [
        fails ? 'post {"id":7,"error":"undefined","name":"Error"}' : 'post {"id":7,"result":{"dofile":"0"}}',
        `answered ${fails ? "error" : "ok"}`,
      ],
    );
  }
});

test("a file's bytes are moved, not copied", async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const { send, posted } = setup({ read: { handle: () => bytes } });
  send(1, "read", { path: "a.do" });
  send(2, "files");
  await tick();
  assert.deepEqual(posted[0].transfer, [bytes.buffer]);
  assert.deepEqual(posted[1].transfer, []);
});

test("a hook that throws after a good result posts no second answer, calls answered once, and the queue goes on", async () => {
  const errors = mock.method(console, "error", () => {});
  try {
    for (const hook of ["afterResult", "answered"]) {
      const answered: unknown[] = [];
      const boom = new Error(`${hook} threw`);
      const { send, messages } = setup(
        {
          matrix: {
            handle: () => ({ ok: 1 }),
            answered: (failed, e) => {
              answered.push([failed, e]);
              if (hook === "answered") throw boom;
            },
          },
          memory: { handle: () => ({ heap_bytes: 1 }) },
        },
        hook === "afterResult"
          ? () => {
              throw boom;
            }
          : undefined,
      );
      send(1, "matrix", {});
      send(2, "memory");
      await tick();
      assert.deepEqual(messages(), [
        { id: 1, result: { ok: 1 } },
        { id: 2, result: { heap_bytes: 1 } },
      ]);
      assert.deepEqual(answered, [[false, undefined]], hook);
    }
    assert.equal(
      errors.mock.callCount(),
      3,
      "a throwing hook is reported, not swallowed: afterResult twice, answered once",
    );
  } finally {
    errors.mock.restore();
  }
});
