// The worker's decisions about a lazy snapshot's graphics part, without its side effects (worker.ts acts on them).

/** The part's state in the shared buffer's header (BootArgs.graphics). */
export const PART_PENDING = 0,
  PART_LANDED = 1,
  PART_FAILED = 2;

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
