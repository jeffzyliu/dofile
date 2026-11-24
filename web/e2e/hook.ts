// The page's test hook (`?test`), typed from the object src/app/test-hook.ts builds.
import type { DofileHook } from "../src/app/test-hook.ts";

declare global {
  interface Window {
    __dofile: DofileHook;
  }
}

export type { DofileHook };
