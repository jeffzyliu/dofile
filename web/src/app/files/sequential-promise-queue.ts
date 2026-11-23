/** Runs each enqueued task after the tasks enqueued before it have settled (a failed one settles too, and the queue
 *  goes on). */
export class SequentialPromiseQueue {
  #tail: Promise<unknown> = Promise.resolve();

  /** Resolves or rejects as `task` does. */
  async enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.#tail.then(task);
    this.#tail = run.catch(() => {});
    return run;
  }
}
