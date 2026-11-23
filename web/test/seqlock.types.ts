// What the seqlock's types refuse (src/engine/seqlock.ts), checked by `npm run check`: an asynchronous write section, a
// write that returns a value, and an asynchronous or thenable read result.

import type { SeqRead } from "../src/engine/seqlock.ts";
import { readSeq, seqRegion, writeSeq } from "../src/engine/seqlock.ts";

const region = seqRegion(new SharedArrayBuffer(32), 4);

writeSeq(region, (writer) => writer.setWord(0, 1));
writeSeq(region, (writer) => {
  writer.setWord(0, 1);
});
// @ts-expect-error an async write section
writeSeq(region, async (writer) => writer.setWord(0, 1));
// @ts-expect-error a write that returns a value
writeSeq(region, () => 1);

export const inferred: SeqRead<number> = readSeq(region, (reader) => reader.readWord(0), 0);
// @ts-expect-error an async read
readSeq(region, async (reader) => reader.readWord(0), 0);
// biome-ignore lint/suspicious/noThenProperty: the thenable the type must refuse
const thenable = { then: () => {} };
// @ts-expect-error a thenable read result
readSeq(region, () => thenable, 0);
