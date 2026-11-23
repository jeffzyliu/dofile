/** A queue that runs each task after the tasks enqueued before it have settled (a failed one settles too, and the
 *  queue goes on). `enqueue` resolves or rejects as its task does. */
export function sequentialPromiseQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return async function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = tail.then(task);
    tail = run.catch(() => {});
    return run;
  };
}
