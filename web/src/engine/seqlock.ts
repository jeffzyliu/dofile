// A seqlock over a SharedArrayBuffer: one writer thread changes a region while readers copy it, and a reader can tell
// whether a write overlapped its copy. Every view of a region lives here, so a write or a read goes through writeSeq or
// readSeq, which keep the counter's rule. Why the re-check is an Atomics.add: docs/design/lazy-graphics.md, section 3.

declare const regionTag: unique symbol;
/** A shared region: Int32 words, the last of them the counter, then bytes. Opaque: its views stay in this module. */
export type SeqRegion = { readonly [regionTag]: true };

/** What a write may do; it stages, writeSeq applies. Usable only during the callback. */
export type SeqWriter = {
  /** @param at - a word below the counter's index, else a RangeError */
  setWord(at: number, value: number): undefined;
  /** The bytes from the start of the region's bytes; at most `room` of them, else a RangeError. */
  setBytes(source: Uint8Array): undefined;
  /** How many bytes the region has after its words. */
  readonly room: number;
};

/** What a read may do. Usable only during the callback; it hands out numbers and copies, never views. */
export type SeqReader = {
  readWord(at: number): number;
  /** A copy of the first `count` bytes, `count` clamped to the room (a torn length cannot throw or read past it). */
  readBytes(count: number): Uint8Array<ArrayBuffer>;
};

/**
 * A whole snapshot read at count `seq`, or busy: none could be had within the time given. A busy `seq` is the count the
 * last try began at, so a waitSeq on it returns when that try's write ends, at once if it already has.
 */
export type SeqRead<T> = { seq: number; value: T } | { seq: number; busy: true };

type NotThenable<T> = T extends PromiseLike<unknown> ? never : T extends { then: unknown } ? never : T;

type Views = { words: Int32Array<SharedArrayBuffer>; bytes: Uint8Array<SharedArrayBuffer>; counter: number };

const viewsByRegion = new WeakMap<SeqRegion, Views>();

/**
 * Each thread wraps the buffer it holds once.
 * @param wordCount - the Int32 words at the start, the counter last
 */
export function seqRegion(sab: SharedArrayBuffer, wordCount: number): SeqRegion {
  if (!Number.isInteger(wordCount) || wordCount < 1 || wordCount * 4 > sab.byteLength)
    throw new RangeError(`a region of ${sab.byteLength} bytes cannot hold ${wordCount} words`);
  const region = Object.freeze({}) as SeqRegion;
  viewsByRegion.set(region, {
    words: new Int32Array(sab, 0, wordCount),
    bytes: new Uint8Array(sab, wordCount * 4),
    counter: wordCount - 1,
  });
  return region;
}

function viewsOf(region: SeqRegion): Views {
  const views = viewsByRegion.get(region);
  if (!views) throw new TypeError("not a region made by seqRegion");
  return views;
}

const isThenable = (value: unknown) =>
  (typeof value === "object" || typeof value === "function") &&
  value !== null &&
  typeof (value as { then?: unknown }).then === "function";

const closed = () => new TypeError("a SeqWriter or SeqReader is usable only during its callback");

/**
 * The only write. The callback stages its writes synchronously; then the counter goes odd, the writes are applied, the
 * counter goes even, and the waiters are woken. A throw or a thenable from the callback writes nothing.
 */
export function writeSeq(region: SeqRegion, write: (writer: SeqWriter) => undefined): void {
  const { words, bytes, counter } = viewsOf(region);
  const staged = new Map<number, number>();
  let source: Uint8Array | null = null;
  let open = true;
  const writer: SeqWriter = {
    setWord(at, value) {
      if (!open) throw closed();
      if (!Number.isInteger(at) || at < 0 || at >= counter) throw new RangeError(`no word ${at} to set`);
      staged.set(at, value);
      return undefined;
    },
    setBytes(given) {
      if (!open) throw closed();
      if (given.length > bytes.length) throw new RangeError(`${given.length} bytes, room for ${bytes.length}`);
      source = given;
      return undefined;
    },
    room: bytes.length,
  };

  let result: unknown;
  try {
    result = write(writer);
  } finally {
    open = false;
  }
  if (isThenable(result)) throw new TypeError("writeSeq's callback must be synchronous: nothing was written");

  Atomics.add(words, counter, 1);
  try {
    if (source) bytes.set(source);
    for (const [at, value] of staged) Atomics.store(words, at, value);
  } finally {
    Atomics.add(words, counter, 1);
    Atomics.notify(words, counter);
  }
}

/**
 * The only read: a whole snapshot, or busy when none could be had within `waitMs` (0: one attempt, no wait, so the
 * page's main thread may call it). The callback may run more than once, so it must have no side effects.
 */
export function readSeq<T>(region: SeqRegion, read: (reader: SeqReader) => NotThenable<T>, waitMs: number): SeqRead<T> {
  const { words, bytes, counter } = viewsOf(region);
  const deadline = performance.now() + waitMs;
  for (;;) {
    const seq = Atomics.load(words, counter);
    if (seq & 1) {
      // a write is under way; its notify ends the wait
      const left = deadline - performance.now();
      if (left <= 0) return { seq, busy: true };
      Atomics.wait(words, counter, seq, left);
      continue;
    }

    let open = true;
    const reader: SeqReader = {
      readWord(at) {
        if (!open) throw closed();
        if (!Number.isInteger(at) || at < 0 || at >= counter) throw new RangeError(`no word ${at} to read`);
        return words[at];
      },
      readBytes(count) {
        if (!open) throw closed();
        return bytes.slice(0, count > 0 ? Math.min(count, bytes.length) : 0);
      },
    };
    let value: T | undefined;
    let thrown: { error: unknown } | null = null;
    try {
      value = read(reader);
    } catch (error) {
      thrown = { error };
    } finally {
      open = false;
    }

    // A read-modify-write, not a load: a load would not keep the copy's plain reads before it
    const now = Atomics.add(words, counter, 0);
    if (now !== seq) {
      // a write overlapped the copy: thrown away, a throw too (it read torn data)
      if (performance.now() >= deadline) return { seq, busy: true };
      continue;
    }
    if (thrown) throw thrown.error;
    if (isThenable(value)) throw new TypeError("readSeq's callback must be synchronous");
    return { seq, value: value as T };
  }
}

/** Block up to `waitMs` while the counter is still `seq` (a worker only; returns at once if it moved). */
export function waitSeq(region: SeqRegion, seq: number, waitMs: number): void {
  const { words, counter } = viewsOf(region);
  Atomics.wait(words, counter, seq, waitMs);
}
