// A lazy snapshot's graphics part: the shared buffer's layout and its page writers and worker readers, and the
// worker's decisions about the part, without their side effects (worker.ts acts on them).

// The shared buffer the page hands the part over in (BootArgs.graphics.sab): an Int32 header [state, length, tries, 0]
// of PART_HEADER bytes, then the compressed part (landed) or the reason it failed, as UTF-8 (failed). The page writes
// it (client.ts), the worker reads it (worker.ts); `length` is the byte count after the header.

/** The part's state in the header. */
export const PART_PENDING = 0,
  PART_LANDED = 1,
  PART_FAILED = 2;

/** The header's Int32 indexes: the state, the byte count after the header, and `tries`: the page's fetches of the
 *  part, which a retry counts, so that a graph that asked takes the next failure as final. */
export const HDR_STATE = 0,
  HDR_LENGTH = 1,
  HDR_TRIES = 2;

/** Where the part (or the reason) starts in the buffer; the header's size in bytes. */
export const PART_HEADER = 16;

export const partHeader = (sab: SharedArrayBuffer) => new Int32Array(sab, 0, PART_HEADER / 4);

/** Page: the part has arrived. */
export function landPart(sab: SharedArrayBuffer, bytes: Uint8Array): void {
  new Uint8Array(sab, PART_HEADER).set(bytes);
  const hdr = partHeader(sab);
  Atomics.store(hdr, HDR_LENGTH, bytes.length);
  Atomics.store(hdr, HDR_STATE, PART_LANDED);
  Atomics.notify(hdr, HDR_STATE);
}

/** Page: the fetch failed; the reason is cut to the room there is. */
export function failPart(sab: SharedArrayBuffer, why: string): void {
  const text = new TextEncoder().encode(why).subarray(0, sab.byteLength - PART_HEADER);
  const hdr = partHeader(sab);
  new Uint8Array(sab, PART_HEADER).set(text);
  Atomics.store(hdr, HDR_LENGTH, text.length);
  Atomics.store(hdr, HDR_STATE, PART_FAILED);
  Atomics.notify(hdr, HDR_STATE);
}

/** Page: a fetch starts again. */
export function retryPart(sab: SharedArrayBuffer): void {
  const hdr = partHeader(sab);
  Atomics.store(hdr, HDR_LENGTH, 0);
  Atomics.add(hdr, HDR_TRIES, 1);
  Atomics.store(hdr, HDR_STATE, PART_PENDING);
  Atomics.notify(hdr, HDR_STATE);
}

/** Worker: the page's fetches of the part so far. Read before the state: a retry between the two loads then shows as
 *  new tries, not as a failure already the new try's. */
export const partTries = (hdr: Int32Array) => Atomics.load(hdr, HDR_TRIES);

export const partState = (hdr: Int32Array) => Atomics.load(hdr, HDR_STATE);

/** Worker: a copy of the bytes (landed) or the reason (failed); TextDecoder and Blob refuse a shared view. */
export const partData = (sab: SharedArrayBuffer, hdr: Int32Array) =>
  new Uint8Array(sab, PART_HEADER, hdr[HDR_LENGTH]).slice();

/** Worker: block up to `ms` while the state is still `state`. */
export const waitPartChange = (hdr: Int32Array, state: number, ms: number) => Atomics.wait(hdr, HDR_STATE, state, ms);

/** The part as a waiting graph reads it. `tries`: the page's fetches of it, read before `state`. */
export type PartRead = { state: number; tries: number; shared: boolean };

/** What a waiting graph does next. The part is read through `read()`, only when needed (a copy of up to 33 MB).
 *  "wait-failed" and "wait-pending": wait on the header for a change from that state, then answer "pending". */
export type WaitStep =
  | "break"
  | "write"
  | "decode-more"
  | "decode"
  | "say-fetching"
  | "fetch"
  | "ask-again"
  | "give-up"
  | "wait-failed"
  | "wait-pending";

/**
 * @param askedAt - the tries when this run asked the page for another fetch, or null
 * @param fetchSaid - without a shared buffer: "pending" was answered before this graph's own fetch
 */
export function waitStep(
  w: { interrupted: boolean; decoded: boolean; decoding: boolean; askedAt: number | null; fetchSaid: boolean },
  read: () => PartRead,
): WaitStep {
  if (w.interrupted) return "break";
  if (w.decoded) return "write";
  if (w.decoding) return "decode-more";
  const { state, tries, shared } = read();
  if (state === PART_LANDED) return "decode";
  if (!shared) return w.fetchSaid ? "fetch" : "say-fetching";
  if (state === PART_FAILED) {
    // once per run; the failure of the fetch it asked for is final
    if (w.askedAt === null) return "ask-again";
    if (tries !== w.askedAt) return "give-up";
    return "wait-failed";
  }
  return "wait-pending";
}

/**
 * Whether the browser's own decoder unpacks the part: not a copy it failed on (brotli-wasm then says if it is damaged),
 * but the fresh copy fetched after that.
 * @param mode - mount's `brotli`: "wasm" forces brotli-wasm
 * @param failedOn - the copy the native decoder failed on, or null
 * @param copy - the copy there is now
 */
export function useNative(mode: string | undefined, hasNative: boolean, failedOn: number | null, copy: number) {
  return hasNative && mode !== "wasm" && failedOn !== copy;
}
