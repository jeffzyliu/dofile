// SequentialPromiseQueue (src/app/files/sequential-promise-queue.ts): order, one at a time, failures.

import assert from "node:assert/strict";
import { test } from "node:test";

import { SequentialPromiseQueue } from "../src/app/files/sequential-promise-queue.ts";

test("tasks run one at a time in the order enqueued; each call resolves with its task's value", async () => {
  const queue = new SequentialPromiseQueue();
  const seen: string[] = [];
  let release = () => {};
  const first = queue.enqueue(
    () =>
      new Promise<string>((ok) => {
        seen.push("first starts");
        release = () => ok("a");
      }),
  );
  const second = queue.enqueue(async () => {
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
  const queue = new SequentialPromiseQueue();
  const failed = queue.enqueue(async () => {
    throw new Error("boom");
  });
  const next = queue.enqueue(async () => "after");
  await assert.rejects(failed, /boom/);
  assert.equal(await next, "after");
});

test("two queues do not wait for each other", async () => {
  const one = new SequentialPromiseQueue();
  const two = new SequentialPromiseQueue();
  void one.enqueue(() => new Promise(() => {})); // never settles
  assert.equal(await two.enqueue(async () => "free"), "free");
});
