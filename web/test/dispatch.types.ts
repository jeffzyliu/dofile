// Compile-time only (npm run check): the worker's dispatch table (worker.ts) has one entry for each op of Ops, and each
// handler's arguments and result are its op's own. Each @ts-expect-error below fails the check if the type let it pass.

import type { Op } from "../src/engine/types.ts";

import type { table } from "../src/engine/worker.ts";
import type { OpTable } from "../src/engine/worker-dispatch.ts";

type Same<A, B> = (<X>() => X extends A ? 1 : 2) extends <X>() => X extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

export type TheWorkerAnswersEveryOpThroughTheTable = Expect<Same<typeof table, OpTable>>;
export type TheTableHasEveryOpAndNothingElse = Expect<Same<keyof OpTable, Op>>;

declare const full: OpTable;
const { sync: _sync, ...noSync } = full;
// @ts-expect-error an op without an entry
export const missing: OpTable = noSync;
// @ts-expect-error a result that is not the op's (startup answers a Startup)
export const wrongResult: OpTable = { ...full, startup: { queued: true, handle: () => 1 } };
export const wrongArgs: OpTable = {
  ...full,
  // @ts-expect-error arguments that are not the op's (read takes {path: string})
  read: { queued: true, handle: (_: { path: number }) => new Uint8Array() },
};
// @ts-expect-error an op that Ops does not have
export const extra: OpTable = { ...full, nope: { queued: true, handle: () => {} } };
