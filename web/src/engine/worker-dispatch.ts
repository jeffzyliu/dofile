// The worker's dispatch: the table of op handlers (worker.ts fills it; its type, from Ops, makes a missing or mistyped
// handler fail tsc) and dispatcher(), the onmessage built from it. It posts nothing itself: worker.ts hands it `post`.

import type { FromWorker, Op, Ops, ToWorker } from "./types.ts";

/** How the worker answers one op. */
export interface OpEntry<K extends Op> {
  /** Its answer. The arguments and the result are the op's own in Ops. */
  handle: (args: Ops[K]["args"], id: number) => Ops[K]["result"] | Promise<Ops[K]["result"]>;
  /** true: one at a time, in the order the ops came. false: answered at once, beside the queue. */
  queued: boolean;
  /** Called as the message arrives, before the queue reaches it. */
  arrived?: () => void;
  /** Called right after the answer is posted (a throw is logged; the answer stands). @param failed - the handler threw `error` */
  answered?: (failed: boolean, error?: unknown) => void;
}
/** Every op has an entry; nothing else has one. */
export type OpTable = { [K in Op]: OpEntry<K> };

/** What the page is told of an error: the worker answers {id, error: message, name, type?}. */
export type PageError = { message: string; name: string; type?: string };

export interface DispatchHooks {
  post(message: FromWorker, transfer: Transferable[]): void;
  /** How an error reads on the page. */
  errorOf(e: unknown): PageError;
  /** Called right after each result is posted (not after an error). A throw is logged; the answer stands. */
  afterResult?(): void;
}

// Emscripten's file system errors carry only a number: errnoCodes (Pyodide's ERRNO_CODES) names it.
export function errorForPage(e: any, errnoCodes?: Record<string, number>): PageError {
  if (e?.errno != null) {
    const code = Object.keys(errnoCodes ?? {}).find((k) => errnoCodes![k] === e.errno);
    return { message: `file system error ${code ?? e.errno}`, name: "ErrnoError" };
  }
  const message = e?.message ?? (typeof e === "object" ? JSON.stringify(e) : e);
  const name = e?.name ?? "Error";
  return { message: String(message), name, ...(name === "PythonError" && { type: e?.type }) };
}

/** The handler as the dispatch calls it: the message's op picks the entry, so its args fit. */
type Loose = Omit<OpEntry<Op>, "handle"> & { handle: (args: unknown, id: number) => unknown };

/** The worker's onmessage over `table`. An op with no entry is answered in the queue with an error. */
export function dispatcher(table: OpTable, { post, errorOf, afterResult }: DispatchHooks) {
  let queue = Promise.resolve();
  const answer = async ({ id, op, args }: ToWorker, entry: Loose | undefined) => {
    let failed = false,
      error: unknown;
    try {
      if (!entry) throw new Error(`unknown op ${op}`);
      const result = await entry.handle(args ?? {}, id);
      post({ id, result } as FromWorker, result instanceof Uint8Array ? [result.buffer] : []); // a file: moved, not copied
    } catch (e) {
      failed = true;
      error = e;
      const { message, name, type } = errorOf(e);
      post({ id, error: message, name, type }, []);
    }
    // A hook that throws never reaches the catch above (one answer per id) and never rejects the queue: it is reported.
    for (const hook of [failed ? undefined : afterResult, () => entry?.answered?.(failed, error)]) {
      try {
        hook?.();
      } catch (e) {
        console.error("dispatch hook threw", e);
      }
    }
  };
  return (data: ToWorker) => {
    const entry = Object.hasOwn(table, data.op) ? (table[data.op] as Loose) : undefined;
    entry?.arrived?.();
    if (entry && !entry.queued) void answer(data, entry);
    else queue = queue.then(() => answer(data, entry));
  };
}
