// sequentialPromiseQueue (src/app/files/sequential-promise-queue.ts): order, one at a time, failures.

import assert from "node:assert/strict";
import { test } from "node:test";
import { sequentialPromiseQueue } from "../src/app/files/sequential-promise-queue.ts";

test("tasks run one at a time in the order enqueued; each call resolves with its task's value", async () => {
  const enqueue = sequentialPromiseQueue();
  const seen: string[] = [];
  let release = () => {};
  const first = enqueue(
    () =>
      new Promise<string>((ok) => {
        seen.push("first starts");
        release = () => ok("a");
      }),
  );
  const second = enqueue(async () => {
    seen.push("second starts");
    return "b";
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(seen, ["first starts"], "the second waits while the first is on");
  release();
  assert.deepEqual(await Promise.all([first, second]), ["a", "b"]);
  assert.deepEqual(seen, ["first starts", "second starts"]);
});

test("a task that fails rejects its own call and the queue goes on", async () => {
  const enqueue = sequentialPromiseQueue();
  const failed = enqueue(async () => {
    throw new Error("boom");
  });
  const next = enqueue(async () => "after");
  await assert.rejects(failed, /boom/);
  assert.equal(await next, "after");
});

test("two queues do not wait for each other", async () => {
  const one = sequentialPromiseQueue();
  const two = sequentialPromiseQueue();
  void one(() => new Promise(() => {})); // never settles
  assert.equal(await two(async () => "free"), "free");
});
