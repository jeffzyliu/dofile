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
    const text = new TextEncoder().encode(reason).subarray(0, writer.roomBytes);
    writer.setBytes(text);
    writer.setWord(HDR_LENGTH, text.length);
    writer.setWord(HDR_STATE, PART_FAILED);
  });
}

/** Page: a fetch starts again, of one more copy. */
export function retryPart(part: SeqRegion): void {
  const { copy } = readOwnPart(part);
  writeSeq(part, (writer) => {
    writer.setWord(HDR_LENGTH, 0);
    writer.setWord(HDR_COPY, copy + 1);
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

/** Page: the part now. The page is the region's one writer and writes it synchronously, so its read never meets a
 *  write of its own. */
export function readOwnPart(part: SeqRegion): PartRead {
  const now = readPart(part, 0);
  if (!("value" in now)) throw new Error("the graphics part's region is being written by another thread");
  return now.value;
}

/** What a waiting graph does next. "wait": wait on the region's counter from the read's count, then answer "pending".
 *  A give-up carries the read's reason, the graph's answer. */
export type WaitStep =
  | "break"
  | "write"
  | "unpack-more"
  | "unpack"
  | "say"
  | "ask-again"
  | "wait"
  | { giveUp: PartReason };

/**
 * The part is read through `read()`, only when needed (a copy of up to 33 MB).
 * @param askedOn - the copy when this run asked the page for another fetch, or null
 * @param damage - the copy damage was found on, and whether a graph has said it: "say" once, for a read of that copy; a
 * landed copy whose damage was said waits for the page's fetch (it is not unpacked again)
 */
export function waitStep(
  w: {
    interrupted: boolean;
    unpacked: boolean;
    unpacking: boolean;
    askedOn: number | null;
    damage: { copy: number; said: boolean } | null;
  },
  read: () => SeqRead<PartRead>,
): WaitStep {
  if (w.interrupted) return "break";
  if (w.unpacked) return "write";
  if (w.unpacking) return "unpack-more";
  const now = read();
  if (!("value" in now)) return "wait";
  const part = now.value;
  const damaged = w.damage?.copy === part.copy;
  if (damaged && !w.damage?.said) return "say";
  if (part.state === "landed") return damaged ? "wait" : "unpack";
  if (part.state === "failed") {
    // once per run; the failure of the fetch it asked for is final
    if (w.askedOn === null) return "ask-again";
    if (part.copy !== w.askedOn) return { giveUp: part.reason };
  }
  return "wait";
}

/** The unpack's phase (worker-graphics.ts keeps it with the copy it came from): none; native (the browser's decoder
 *  unpacks a copy off this thread); unpacking (brotli-wasm steps); unpacked, not yet written; written; warming (its
 *  modules imported a few at a time); warmed. */
export type UnpackPhase = "none" | "native" | "unpacking" | "unpacked" | "written" | "warming" | "warmed";

/** What the native gate and the idle step know besides the part. `useNative`: useNative for a copy, with mount's mode,
 *  the decoder there is and the copy it failed on bound; `file`: the part's sizes, compressed and unpacked. */
export type PartWork = {
  started: boolean; // `startup` was answered
  phase: UnpackPhase;
  nativeRunning: boolean; // the browser's decoder is unpacking a copy, which the unpack may have left since
  damagedOn: number | null; // the copy damage was found on, said or not
  useNative: (copy: number) => boolean;
  file: { size: number; raw: number };
};

/** The part as it landed, from a read. */
export type LandedPart = Extract<PartRead, { state: "landed" }>;

// The browser's decoder takes a landed copy it may unpack whose bytes are brotli-sized (else the wasm step says what is
// wrong). A read made without the bytes, to decide whether to copy up to 33 MB, passes on its copy alone.
function nativeFits(w: PartWork, now: SeqRead<PartRead>): now is { seq: number; value: LandedPart } {
  if (!("value" in now) || now.value.state !== "landed" || !w.useNative(now.value.copy)) return false;
  const { bytes } = now.value;
  return bytes === null || (bytes.length === w.file.size && bytes.length !== w.file.raw);
}

/**
 * The native gate: the part the browser's decoder starts on, or null. Started, nothing unpacked or under way, the
 * decoder not running (one 33 MB decode at a time), then a read that fits, of a copy without damage (the part is read
 * only past the flags).
 */
export function nativeGate(w: PartWork, read: () => SeqRead<PartRead>): LandedPart | null {
  if (!w.started || w.phase !== "none" || w.nativeRunning) return null;
  const now = read();
  return nativeFits(w, now) && now.value.copy !== w.damagedOn ? now.value : null;
}

/** How long the engine is idle before the part's next idle step.
 *  IDLE_MS 250 vs 1000: a graph sent 0.5-1.1 s after ready was 0.2-0.5 s faster; a run meeting a step waits as long. */
export const IDLE_MS = 250;

/** What an idle step does. "run": nothing, a run is in flight (its end comes back); "later": not idle for IDLE_MS yet;
 *  "native": the native gate (the read fits; the gate checks the flags again); "unpack": the first unpack step of the
 *  read's bytes; "none": nothing (busy, not landed, or damage on the read's copy: the op `graphics` after the page's
 *  write comes back). */
export type IdleStep = "run" | "later" | "write" | "unpack-more" | "warm" | "native" | "unpack" | "none";

/**
 * One idle step. The part is read through `read()` only when nothing is unpacked or under way.
 * @param idleFor - ms since the last run ended or `startup` was answered
 */
export function idleStep(
  w: PartWork & { runsInFlight: number; idleFor: number },
  read: () => SeqRead<PartRead>,
): IdleStep {
  if (w.runsInFlight > 0) return "run";
  if (w.idleFor < IDLE_MS) return "later";
  switch (w.phase) {
    case "unpacked":
      return "write";
    case "unpacking":
      return "unpack-more";
    case "written":
    case "warming":
      return "warm";
    case "native": // the decoder's end comes back
    case "warmed":
      return "none";
  }
  const now = read();
  if (!("value" in now) || now.value.state !== "landed" || now.value.copy === w.damagedOn) return "none";
  return nativeFits(w, now) ? "native" : "unpack";
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
