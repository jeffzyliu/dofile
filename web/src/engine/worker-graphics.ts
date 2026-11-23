// The worker's side of a lazy snapshot's graphics part (docs/lazy-matplotlib.md): one record of what the worker knows
// about the part, and what acts on it. worker.ts makes one (graphicsWorker) and calls it from its table's handlers; the
// decisions are lazy-part.ts's pure functions (waitStep, nativeGate, idleStep).
//
// matplotlib is not in the heap but in one more file (files.graphics). With a SharedArrayBuffer the page fetches it
// (client.ts), because a worker busy in Python cannot advance a fetch of its own, and hands it over in the buffer given
// with boot (its layout: lazy-part.ts). A graph that finds it failed posts {graphics: "again"} and waits for the page's
// next fetch. Without one (no cross-origin isolation) it is a start file instead: boot fetches, unpacks and writes it
// (worker-boot.ts), and only its import is left for the idle steps.
// Only a graph waits for the part (waitGraphics). Nothing happens before `startup` is answered, so a return visit is no
// slower. Then the browser's own decoder unpacks it off this thread (nativeSoon); the brotli-wasm unpack, the write and
// the import of what a first graph needs run in one-task steps once the engine has been idle IDLE_MS (runIdleStep), so
// a run sent meanwhile waits for one step at most.

import type { LandedPart, PartRead, PartWork } from "./lazy-part.ts";
import { IDLE_MS, idleStep, nativeGate, partRegion, readPart, useNative, waitStep } from "./lazy-part.ts";
import type { SeqRead, SeqRegion } from "./seqlock.ts";
import { waitSeq } from "./seqlock.ts";
import type { SnapshotPy } from "./snapshot.ts";
import { hasNativeBrotli, unpackNative, unpackSteps, writeGraphics } from "./snapshot.ts";
import type { FromWorker, SnapshotFile } from "./types.ts";
import type { Browser, GraphicsArgs, PartSource } from "./worker-boot.ts";
import { since } from "./worker-boot.ts";

const UNPACK_STEP = 256 << 10; // input bytes: ~1.1 MB out, ~0.12 s at the 9 MB/s brotli-wasm did on an iPhone

/** The unpack, one state. Each phase but none and warmed names the copy whose bytes it came from (boot's write, without
 *  a shared buffer: copy 0, the first fetch). */
type Unpack =
  | { phase: "none" }
  | { phase: "native"; copy: number } // the browser's decoder unpacks it; a graph's unpack takes over (unpacking)
  | { phase: "unpacking"; copy: number; steps: Generator<number, Uint8Array, void>; t0: number; longest: number }
  | { phase: "unpacked"; copy: number; raw: Uint8Array; secs: number; decoder: "wasm" | "native"; longest: number }
  | { phase: "written"; copy: number }
  | { phase: "warming"; copy: number; at: number; t0: number; longest: number } // at: warm_graphics's next step
  | { phase: "warmed" };

/** What the part's work reads but does not own: the worker's, as they are when it is called. */
export type GraphicsEnv = {
  py: () => SnapshotPy;
  browser: () => Browser;
  interrupt: () => Int32Array | null;
  errorOf: (e: unknown) => { message: string };
  post: (message: FromWorker) => void;
};

/** The worker's record of the graphics part, and the calls its table's handlers make. */
export function graphicsWorker(env: GraphicsEnv) {
  const rec = {
    // given at start: mount's, then boot's (null: the build has no lazy part)
    source: { snapshotURL: "", built: 0, brotliWasm: null, brotliMode: undefined } as PartSource,
    part: null as { file: SnapshotFile; region: SeqRegion | null } | null, // region null: boot wrote it
    started: false, // `startup` was answered
    // the idle clock
    runsInFlight: 0, // runs sent and not ended (counted before the queue)
    idleSince: 0,
    timer: 0 as ReturnType<typeof setTimeout> | 0,
    // the unpack
    unpack: { phase: "none" } as Unpack,
    nativeRunning: false, // the browser's decoder is unpacking a copy, which the unpack may have left since
    // copies and damage
    nativeFailedOn: null as number | null, // the copy the browser's decoder failed on
    // the copy it was found on; said once, by a graph
    damage: null as { copy: number; why: string; said: boolean } | null,
    // this run
    run: { askedOn: null as number | null, writtenAt: 0 }, // askedOn: the copy when it asked for a fetch again
  };

  const work = (): PartWork => ({
    started: rec.started,
    phase: rec.unpack.phase,
    nativeRunning: rec.nativeRunning,
    damagedOn: rec.damage?.copy ?? null,
    useNative: (copy) => useNative(rec.source.brotliMode, hasNativeBrotli(), rec.nativeFailedOn, copy),
    file: rec.part!.file,
  });

  const written = () => ["written", "warming", "warmed"].includes(rec.unpack.phase);

  // The part now: one snapshot of the shared region (busy while the page writes it, for up to waitMs). withBytes: a
  // copy of the bytes (up to 33 MB) when landed. Read only while the part is not written, so there is a region
  // (without one, boot wrote it).
  function readGraphics(waitMs: number, withBytes: boolean): SeqRead<PartRead> {
    return readPart(rec.part!.region!, waitMs, { withBytes });
  }

  // The part will not unpack or write: it is dropped (the page deletes it from the Cache and fetches it again). The
  // damage is tied to the copy the step had: the graph that finds it, or else the next one that reads that copy, says
  // why, and it keeps that copy (not a fresh one) from being unpacked again.
  function dropDamaged(e: unknown): string {
    const why = `the graphics files arrived damaged (${env.errorOf(e).message}); they are fetched again for the next graph`;
    // every phase a step unpacks or writes in names its copy
    rec.damage = { copy: "copy" in rec.unpack ? rec.unpack.copy : -1, why, said: false };
    if (rec.unpack.phase === "unpacking" || rec.unpack.phase === "unpacked") rec.unpack = { phase: "none" };
    env.post({ graphics: "damaged", copy: rec.damage.copy });
    console.warn(`[dofile] ${why}`);
    return why;
  }

  // One step of the brotli-wasm unpack (UNPACK_STEP of input); the first is given the landed part. A waiting graph and
  // the idle steps share one unpack.
  function unpackStep(from?: LandedPart) {
    if (rec.unpack.phase !== "unpacking") {
      rec.unpack = {
        phase: "unpacking",
        copy: from!.copy,
        steps: unpackSteps(rec.source.brotliWasm!, from!.bytes!, rec.part!.file, UNPACK_STEP),
        t0: performance.now(),
        longest: 0,
      };
    }
    const u = rec.unpack;
    const t = performance.now();
    const r = u.steps.next();
    u.longest = Math.max(u.longest, since(t));
    if (r.done) {
      rec.unpack = {
        phase: "unpacked",
        copy: u.copy,
        raw: r.value,
        secs: since(u.t0),
        decoder: "wasm",
        longest: u.longest,
      };
    }
  }

  function writeUnpacked(where: string) {
    const d = rec.unpack as Extract<Unpack, { phase: "unpacked" }>;
    const tWrite = performance.now();
    const n = writeGraphics(env.py(), d.raw);
    rec.unpack = { phase: "written", copy: d.copy };
    console.info(
      `[dofile] graphics part: written ${where} (unpack (${d.decoder}) ${d.secs.toFixed(2)}s, longest step ${d.longest.toFixed(2)}s; write ${n} files ${since(tWrite).toFixed(2)}s)`,
    );
  }

  /**
   * Called by Python (browser.py, _LazyGraphics.ensure) while a graph waits, so synchronous.
   * @param ms - the longest wait before answering "pending"
   * @returns "" once the files are written (unpacked here if the idle steps have not done it); "break" for a Break
   * (Python takes it as the engine's Break; the unpack goes on later); "pending"; or why the graphs cannot be had
   */
  function waitGraphics(ms: number): string {
    if (written()) return "";
    const interrupt = env.interrupt();
    for (;;) {
      let read = { seq: 0, busy: true } as SeqRead<PartRead>; // set by waitStep's read
      try {
        const step = waitStep(
          {
            interrupted: Boolean(interrupt && Atomics.load(interrupt, 0) !== 0),
            unpacked: rec.unpack.phase === "unpacked",
            unpacking: rec.unpack.phase === "unpacking",
            askedOn: rec.run.askedOn,
            damage: rec.damage,
          },
          () => (read = readGraphics(ms, true)),
        );
        if (typeof step === "object") return step.giveUp;
        switch (step) {
          case "break":
            Atomics.store(interrupt!, 0, 0);
            return "break";
          case "write":
            writeUnpacked("in a run");
            rec.run.writtenAt = performance.now();
            return "";
          case "unpack-more":
            unpackStep();
            continue;
          case "unpack":
            // waitStep unpacks only a landed read
            if ("value" in read && read.value.state === "landed") unpackStep(read.value);
            continue;
          case "say": // the damage on the read's copy (waitStep says it only then)
            rec.damage!.said = true;
            return rec.damage!.why;
          case "ask-again":
            // waitStep asks only after a read that gave the part
            if ("value" in read) {
              rec.run.askedOn = read.value.copy;
              env.post({ graphics: "again", copy: read.value.copy });
            }
            waitSeq(rec.part!.region!, read.seq, ms);
            return "pending";
          case "wait":
            // on the counter, not the state: a whole retry may end in the state it began from
            waitSeq(rec.part!.region!, read.seq, ms);
            return "pending";
        }
      } catch (e) {
        const why = dropDamaged(e);
        rec.damage!.said = true; // this graph says it; the next one waits for the page's fresh fetch
        return why;
      }
    }
  }

  // The browser's own decoder (off this thread) unpacks the part as soon as it is here. A graph that comes meanwhile
  // cannot use the result: it is blocked in Python, so this thread's event loop never delivers the promise. That graph
  // unpacks with brotli-wasm itself (unpacking takes over from native), and the result, kept only while the unpack is
  // still native for its copy, is dropped. The decoder still runs then: nothing starts a second one until it ends.
  // Does nothing where there is no native decoder (Chromium).
  function nativeSoon() {
    // busy or not landed: the op graphics after the page's write calls this again
    if (!rec.part || !nativeGate(work(), () => readGraphics(0, false))) return;
    setTimeout(startNative, 0); // a task of its own: never inside the answer to `startup`
  }

  function startNative() {
    // the copy and its bytes from one snapshot: a failure is charged to the copy it unpacked
    const landed = rec.part && nativeGate(work(), () => readGraphics(0, true));
    if (!landed) return;
    const { copy } = landed;
    rec.unpack = { phase: "native", copy };
    rec.nativeRunning = true;
    const still = () => rec.unpack.phase === "native" && rec.unpack.copy === copy;
    const t0 = performance.now();
    unpackNative(landed.bytes!, rec.part!.file.raw)
      .then(
        (raw) => {
          // else a graph that came meanwhile unpacked the part itself (see nativeSoon), and may have found it damaged
          // secs: to the unpack's end; the write waits for IDLE_MS more
          if (still()) {
            rec.unpack = { phase: "unpacked", copy, raw, secs: since(t0), decoder: "native", longest: 0 };
          }
        },
        (e) => {
          console.warn(`[dofile] graphics part: native brotli failed (${e?.message ?? e}); using brotli-wasm`);
          rec.nativeFailedOn = copy; // the next step starts the brotli-wasm unpack, which says if it is damaged
          if (still()) rec.unpack = { phase: "none" };
        },
      )
      .finally(() => {
        rec.nativeRunning = false;
        idleSoon(0);
      });
  }

  // The one door to the part's work while idle: after `startup`, IDLE_MS after the last run.
  function idleSoon(delay = Math.max(0, rec.idleSince + IDLE_MS - performance.now())) {
    if (!rec.started || !rec.part || rec.timer || rec.nativeRunning || rec.unpack.phase === "warmed") return;
    rec.timer = setTimeout(runIdleStep, delay);
  }

  // One step: an unpack step (or the browser's decoder, off this thread), the write, or one import step
  function runIdleStep() {
    rec.timer = 0;
    const t = performance.now();
    let read = { seq: 0, busy: true } as SeqRead<PartRead>; // set by idleStep's read
    try {
      const step = idleStep(
        { ...work(), runsInFlight: rec.runsInFlight, idleFor: t - rec.idleSince },
        () => (read = readGraphics(0, true)),
      );
      switch (step) {
        case "run": // the run's end calls idleSoon
        case "none": // busy or not landed: the op graphics after the page's write calls idleSoon
          return;
        case "later":
          return idleSoon();
        case "write":
          writeUnpacked("while idle");
          env.browser().graphics_written();
          break;
        case "unpack-more":
          unpackStep();
          break;
        case "native":
          // normally under way already (nativeSoon); its end calls idleSoon
          return startNative();
        case "unpack":
          if ("value" in read && read.value.state === "landed") unpackStep(read.value);
          break;
        case "warm":
          warmStep(t);
          break;
      }
    } catch (e) {
      dropDamaged(e);
      return;
    }
    idleSoon(0);
  }

  // After the write, the import of what a first graph needs: the three heavy modules one at a time, then 20 a step
  function warmStep(t: number) {
    const u = rec.unpack as Extract<Unpack, { phase: "written" | "warming" }>;
    const w =
      u.phase === "warming" ? u : { phase: "warming" as const, copy: u.copy, at: 0, t0: performance.now(), longest: 0 };
    rec.unpack = w;
    try {
      w.at = env.browser().warm_graphics(w.at, w.at < 3 ? 1 : 20);
    } catch (e) {
      // not damage: the files are written; a real import error shows in the graph that needs the module
      console.warn(`[dofile] graphics part: warm-up stopped (${env.errorOf(e).message})`);
      rec.unpack = { phase: "warmed" };
      return;
    }
    w.longest = Math.max(w.longest, since(t));
    if (w.at < 0) {
      console.info(
        `[dofile] graphics part: warmed (imported) in ${since(w.t0).toFixed(2)}s, longest step ${w.longest.toFixed(2)}s`,
      );
      rec.unpack = { phase: "warmed" };
    }
  }

  return {
    /** mount: where the part is and how it is unpacked */
    mounted(source: PartSource) {
      rec.source = source;
    },
    /** boot: `startEngine`'s hooks for the part */
    bootHooks() {
      return {
        part: rec.source,
        partWritten(graphics: GraphicsArgs) {
          // no shared buffer: boot wrote it; the idle steps import it
          rec.part = { file: graphics.file, region: null };
          rec.unpack = { phase: "written", copy: 0 };
        },
        lazyGraphics(engine: Browser, graphics: GraphicsArgs, sab: SharedArrayBuffer) {
          // the buffer is wrapped at once and not kept
          rec.part = { file: graphics.file, region: partRegion(sab) };
          engine.lazy_graphics(waitGraphics);
        },
      };
    },
    /** `startup` answered: the part's work may begin */
    startupAnswered() {
      rec.started = true;
      rec.idleSince = performance.now();
      nativeSoon();
      idleSoon();
    },
    /** a run arrived: counted at once, not when the queue reaches it, so the idle steps stop for it (runIdleStep) */
    runArrived() {
      rec.runsInFlight++;
    },
    /** a run starts (after `boot`) */
    runStarts() {
      rec.run.askedOn = null;
    },
    /** a run ended, answered or not */
    runEnded() {
      if (rec.run.writtenAt) {
        console.info(
          `[dofile] graphics part: in the run, after the write: import and draw ${since(rec.run.writtenAt).toFixed(2)}s`,
        );
        rec.run.writtenAt = 0;
      }
      rec.runsInFlight--; // counted as it arrived
      rec.idleSince = performance.now();
      nativeSoon();
      idleSoon();
    },
    /** the op `graphics`: the page's write of the part ended */
    pageWrote() {
      nativeSoon();
      idleSoon();
    },
  };
}
