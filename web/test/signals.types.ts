// Compile-time only (npm run check): the writable signals state.ts exports are the views' own state. A signal with an
// owner is exported as ReadonlySignal, so a view that assigns it fails to compile; a new writable export fails here
// until it is named below, on purpose.
import type { S as AllState } from "./state-all.ts";

type S = typeof AllState;

type Same<A, B> = (<X>() => X extends A ? 1 : 2) extends <X>() => X extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;
type OnlyValue<T> = { [K in keyof T as K extends "value" ? K : never]: T[K] };
type Writable<T> = Same<OnlyValue<T>, { -readonly [K in keyof OnlyValue<T>]: OnlyValue<T>[K] }>;
type Flags = { [K in keyof S]: "value" extends keyof S[K] ? Writable<S[K]> : false };
type WritableSignals = { [K in keyof Flags]: Flags[K] extends true ? K : never }[keyof Flags];

export type OnlyTheViewsOwnSignalsAreWritable = Expect<
  Same<WritableSignals, "split" | "outputTab" | "pickedVar" | "theme" | "wrap" | "layout">
>;
