// A lazy snapshot's graphics part: the shared region's layout, its page writers and its reader (on seqlock.ts), and the
// worker's decisions about the part, without their side effects (worker.ts acts on them).

import type { SeqRead, SeqReader, SeqRegion } from "./seqlock.ts";
import { readSeq, seqRegion, writeSeq } from "./seqlock.ts";

// The shared buffer the page hands the part over in (BootArgs.graphics.sab): an Int32 header [state, length, copy,
// counter] of PART_HEADER bytes, then the compressed part (landed) or the reason it failed, as UTF-8 (failed). The page
// writes it (client.ts), the worker reads it (worker.ts), each through the SeqRegion it wraps the buffer in.

/** The part's state in the header. */
export const PART_PENDING = 0,
  PART_LANDED = 1,
  PART_FAILED = 2;

/** The header's Int32 indexes: the state, the byte count after the header, `copy`: the page's fetches of the part after
 *  the first, which a retry counts, so that a graph that asked takes the next failure as final; then the seqlock's
 *  counter. */
export const HDR_STATE = 0,
  HDR_LENGTH = 1,
  HDR_COPY = 2,
  HDR_SEQ = 3;

/** Where the part (or the reason) starts in the buffer; the header's size in bytes. */
export const PART_HEADER = 16;

/** Each thread wraps the buffer it holds once, and reads and writes the part only through the region. */
export const partRegion = (sab: SharedArrayBuffer) => seqRegion(sab, HDR_SEQ + 1);

declare const partReasonTag: unique symbol;
/** Why a fetch failed: never "", which is waitGraphics's answer for "written". Only partReason makes one. */
export type PartReason = string & { readonly [partReasonTag]: true };

export function partReason(text: string): PartReason {
  return (text || "the graphics files could not be downloaded (no reason was given)") as PartReason;
}

/** One whole snapshot of the part. `bytes`: a copy (up to 33 MB), null unless asked for. */
export type PartRead =
  | { state: "pending"; copy: number }
  | { state: "landed"; copy: number; bytes: Uint8Array<ArrayBuffer> | null }
  | { state: "failed"; copy: number; reason: PartReason };

/** Page: the part has arrived. */
export function landPart(part: SeqRegion, bytes: Uint8Array): void {
  writeSeq(part, (writer) => {
    writer.setBytes(bytes);
    writer.setWord(HDR_LENGTH, bytes.length);
    writer.setWord(HDR_STATE, PART_LANDED);
  });
}

/** Page: the fetch failed; the reason is cut to the room there is. */
export function failPart(part: SeqRegion, reason: PartReason): void {
  writeSeq(part, (writer) => {
    const text = new TextEncoder().encode(reason).subarray(0, writer.room);
    writer.setBytes(text);
    writer.setWord(HDR_LENGTH, text.length);
    writer.setWord(HDR_STATE, PART_FAILED);
  });
}

/** Page: a fetch starts again, of one more copy. */
export function retryPart(part: SeqRegion): void {
  // the page is the region's one writer, so no write of its own is under way here
  const now = readPart(part, 0);
  if (!("value" in now)) throw new Error("the graphics part's region is being written by another thread");
  writeSeq(part, (writer) => {
    writer.setWord(HDR_LENGTH, 0);
    writer.setWord(HDR_COPY, now.value.copy + 1);
    writer.setWord(HDR_STATE, PART_PENDING);
  });
}

/** readPart's callback: the copy number, the state and the bytes or the reason, from one reader. */
export function partSnapshot(reader: SeqReader, { withBytes = false } = {}): PartRead {
  const copy = reader.readWord(HDR_COPY);
  const length = reader.readWord(HDR_LENGTH);
  switch (reader.readWord(HDR_STATE)) {
    case PART_LANDED:
      return { state: "landed", copy, bytes: withBytes ? reader.readBytes(length) : null };
    case PART_FAILED:
      return { state: "failed", copy, reason: partReason(new TextDecoder().decode(reader.readBytes(length))) };
    default:
      return { state: "pending", copy };
  }
}

/**
 * The part as one snapshot: busy when the page's writes left none within `waitMs` (0: no wait).
 * @param options - `withBytes`: copy a landed part's bytes
 */
export function readPart(part: SeqRegion, waitMs: number, options: { withBytes?: boolean } = {}): SeqRead<PartRead> {
  return readSeq(part, (reader) => partSnapshot(reader, options), waitMs);
}

/** What a waiting graph does next. "wait": wait on the region's counter from the read's count, then answer "pending".
 *  A give-up carries the read's reason, the graph's answer. */
export type WaitStep =
  | "break"
  | "write"
  | "decode-more"
  | "decode"
  | "say-fetching"
  | "fetch"
  | "ask-again"
  | "wait"
  | { giveUp: PartReason };

/**
 * The part is read through `read()`, only when needed (a copy of up to 33 MB).
 * @param askedAt - the copy when this run asked the page for another fetch, or null
 * @param fetchSaid - without a shared buffer: "pending" was answered before this graph's own fetch
 * @param shared - the part comes in a shared buffer (else this worker fetches it)
 */
export function waitStep(
  w: {
    interrupted: boolean;
    decoded: boolean;
    decoding: boolean;
    askedAt: number | null;
    fetchSaid: boolean;
    shared: boolean;
  },
  read: () => SeqRead<PartRead>,
): WaitStep {
  if (w.interrupted) return "break";
  if (w.decoded) return "write";
  if (w.decoding) return "decode-more";
  const now = read();
  if (!("value" in now)) return "wait";
  const part = now.value;
  if (part.state === "landed") return "decode";
  if (!w.shared) return w.fetchSaid ? "fetch" : "say-fetching";
  if (part.state === "failed") {
    // once per run; the failure of the fetch it asked for is final
    if (w.askedAt === null) return "ask-again";
    if (part.copy !== w.askedAt) return { giveUp: part.reason };
  }
  return "wait";
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
