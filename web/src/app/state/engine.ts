// The engine's state: what the page knows of the engine and of its graphics part. Its writers are app/engine.ts's, through
// `engineWriter` and `graphicsWriter`; everything else reads.

import type { ReadonlySignal } from "@preact/signals-core";
import { signal } from "@preact/signals-core";
import type { GraphicsProgress } from "../../engine/types.ts";
import type { EngineState } from "../types.ts";

export const engineWriter = {
  engine: signal<EngineState>({ s: "checking-lock" }),
};
export const engine: ReadonlySignal<EngineState> = engineWriter.engine;
export const isolated: ReadonlySignal<boolean> = signal(Boolean(globalThis.crossOriginIsolated)); // set once at load
/** Progress of the graphics part: not an engine state, so it does not go through the machine. */
export const graphicsWriter = {
  part: signal<GraphicsProgress | null>(null), // the transport's onGraphics (engine.ts)
};
/** A lazy snapshot's graphics part; null with none. */
export const graphicsPart: ReadonlySignal<GraphicsProgress | null> = graphicsWriter.part;

// The download size for the prompt, in bytes as a host sends them. The build writes it into the page
// (<meta name="dofile-engine-bytes">, vite.config.ts), so it is there before any download. null: not a built page.
function metaEngineBytes(doc: Document | undefined = globalThis.document): number | null {
  const bytes = Number(doc?.querySelector('meta[name="dofile-engine-bytes"]')?.getAttribute("content"));
  return bytes > 0 ? bytes : null;
}
export const engineBytes = metaEngineBytes();
