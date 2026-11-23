// The order of the page's file changes (docs/design/workspace.md, section 3): one chain of turns. A turn is the store
// calls that no question separates and the tabs' follow-up on them; `Io` is the one door through which the page writes.
//
// How a turn is written. Its body is a plain generator (`function*`), never `async`: it has nothing to await, so it
// cannot wait for a dialog (an open dialog would hold every later Save), a timer, an engine call, or another turn (one
// queued behind itself: the chain would hang). What it can do is ask for a store operation. Each method of `Io` is a
// tiny generator that yields one request; `yield*` hands it to the runner, which makes the store call and resumes the
// body with the answer, or throws the store's error into the body at that line, where a try/catch takes it:
//
//   fileTurn(function* (io) {
//     const taken = (yield* io.list()).map((f) => f.path); // typed: the answer of store.list()
//     if (taken.includes(path)) throw new Error(`${path} already exists`); // the turn rejects with it
//     yield* io.write(path, new Uint8Array(0));
//     close(other); // the follow-up on the tabs: plain code, in the same turn as the write it follows
//     return path; // what fileTurn resolves to
//   });
//
// - Always `yield*`, never `yield`: `yield* io.read(p)` has the type of the answer. A bare `yield` of anything
//   else (a promise, another turn) is a type error, and the runner rejects the turn if one gets through.
// - A helper that makes store calls is a generator too, called with `yield*` (renameNow's readText in
//   files/actions.ts); a helper that makes none is a plain function.
// - What must wait for something outside the store goes after the turn, in the caller. Save is the case: its turn
//   issues the write without waiting for it (`io.issue`) and returns it wrapped; the caller awaits the answer and
//   applies it after the turn, so a slow write holds no rename.
// - Calling `fileTurn` inside a body is refused: that call rejects (the body runs on to its next `yield*`, which the
//   runner refuses), and so does the outer turn. Neither turn could be waited for in the other.
// - Each operation has a time limit. An IndexedDB call cannot be cancelled, so one that runs over may still be applied
//   later: the turn rejects with a TurnTimeout error and its body is ended (`return`: its finally blocks run) without
//   being told the operation failed, since nobody knows. The next turn starts; the store applies calls in the order
//   they were made, so the next turn's calls land after the late one.

import type { Expect, FileStore } from "../../engine/store.ts";
import { store } from "../store.ts";
import type { FileInfo } from "../types.ts";
import { SequentialPromiseQueue } from "./sequential-promise-queue.ts";

declare const opBrand: unique symbol;
/** A store operation a body asks for; only `Io` makes one. */
export interface Op {
  readonly [opBrand]: true;
}
/** A turn's body, or a helper it calls with `yield*`: yields operations, returns `T`. */
export type Turn<T> = Generator<Op, T, unknown>;

/** A write issued and not waited for: the store's answer, for the caller to await after the turn. */
export interface Issued {
  answer: Promise<FileInfo>;
}

/** The store operations a turn may make; each answers as the store's method of that name does. */
export interface Io {
  list(): Turn<FileInfo[]>;
  read(path: string): Turn<Uint8Array<ArrayBuffer>>;
  write(path: string, data: Uint8Array, expect?: Expect): Turn<FileInfo>;
  info(path: string): Turn<FileInfo | null>;
  mkdir(path: string): Turn<void>;
  rename(from: string, to: string): Turn<void>;
  remove(path: string): Turn<void>;
  /** Write `data` to `path` without waiting for it: the store applies it before any later call. */
  issue(path: string, data: Uint8Array): Turn<Issued>;
}

interface Request {
  name: string;
  run: () => Promise<unknown>;
}
const requests = new WeakSet<object>();

function* op<T>(name: string, run: () => Promise<T>): Turn<T> {
  const request: Request = { name, run };
  requests.add(request);
  return (yield request as unknown as Op) as T; // the brand is a type only: the runner gets the request back
}

type Target = Pick<FileStore, "list" | "info" | "read" | "write" | "mkdir" | "rename" | "remove">;
let target: Target = store;

/** The store the turns call: the page's (app/store.ts) until files.ts is connected to one (connectFiles: main.tsx
 *  gives it the page's, a controller test its stand-in). */
export function turnsOn(s: Target): void {
  target = s;
}

// the method is looked up at each call, so a test that replaces one is seen
const io: Io = {
  list: () => op("list", () => target.list()),
  read: (path) => op(`read ${path}`, () => target.read(path)),
  write: (path, data, expect) => op(`write ${path}`, () => target.write(path, data, expect)),
  info: (path) => op(`info ${path}`, () => target.info(path)),
  mkdir: (path) => op(`mkdir ${path}`, () => target.mkdir(path)),
  rename: (from, to) => op(`rename ${from}`, () => target.rename(from, to)),
  remove: (path) => op(`remove ${path}`, () => target.remove(path)),
  issue: (path, data) => op(`issue ${path}`, async () => ({ answer: target.write(path, data) })),
};

const turnQueue = new SequentialPromiseQueue();
let inBody: { nested: boolean } | null = null; // the turn whose body is running now (synchronously)

/** Run `body` once the turns started before it have ended (a rejection ends one too). Resolves as `body` returns, or
 *  rejects with what it throws, a store error it does not catch, or a TurnTimeout. */
export async function fileTurn<T>(body: (io: Io) => Turn<T>): Promise<T> {
  if (inBody) {
    inBody.nested = true;
    throw new Error("a turn cannot start inside another turn");
  }
  return turnQueue.enqueue(() => perform(body));
}

class TurnTimeout extends Error {
  override name = "TurnTimeout";
}

/** The store call, rejected with a TurnTimeout if it has not answered in time. */
function callWithTimeout(request: Request): Promise<unknown> {
  const OP_TIMEOUT = 30_000; // ms: an IndexedDB call that has not answered by then is stuck (a hung disk, a blocked upgrade)
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new TurnTimeout(`the store did not answer ${request.name} within ${OP_TIMEOUT / 1000} s; it may still do it`),
      );
    }, OP_TIMEOUT);
  });
  const answer = (async () => request.run())(); // a store method that throws at once rejects here too, so the timer is still cleared
  return Promise.race([answer, late]).finally(() => clearTimeout(timer));
}

async function perform<T>(body: (io: Io) => Turn<T>): Promise<T> {
  const self = { nested: false };
  const it = body(io);
  /** Resume the body; while its code runs, fileTurn refuses to start a turn. */
  const resume = (move: () => IteratorResult<Op, T>) => {
    inBody = self;
    try {
      return move();
    } finally {
      inBody = null;
    }
  };
  const end = (e: Error) => {
    resume(() => it.return(undefined as T));
    return e;
  };
  let next = resume(() => it.next());
  for (;;) {
    if (self.nested) throw end(new Error("a turn cannot start inside another turn"));
    if (next.done) return next.value;
    const request = next.value as unknown as Request;
    if (!requests.has(request))
      throw end(new Error("a turn yielded something that is not a store operation: yield* io.<op>(...)"));
    let value: unknown;
    try {
      value = await callWithTimeout(request);
    } catch (e) {
      if (e instanceof TurnTimeout) throw end(e);
      next = resume(() => it.throw(e));
      continue;
    }
    next = resume(() => it.next(value));
  }
}
