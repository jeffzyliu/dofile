// Reads a .dta file's variables for the .dta tab (DtaView.tsx) and keeps the answer in view.ts `dtaInfo`.

import { call } from "../engine.ts";
import { dtaInfo } from "./view.ts";

const asking = new Map<string, string>(); // path -> key of the describe_file in flight

/** Ask describe_file for `path` as it is now (`key`: size and time), unless `dtaInfo` has it or the same question is
 *  already on its way: the tab is unmounted and mounted again while the first answer is awaited. A failed call (no
 *  engine, a reset) is forgotten, so the next ask goes through. */
export function readDta(path: string, key: string) {
  if (dtaInfo.peek()[path]?.key === key) return;
  call("describe_file", { path })
    .then(
      (result) => {
        dtaInfo.value = { ...dtaInfo.value, [path]: { key, result } };
      },
      () => {},
    );
}
