// The page's test hook (`?test`), typed from the object src/main.tsx builds.
import type { DofileHook } from "../src/main.tsx";

declare global {
  interface Window {
    __dofile: DofileHook;
  }
}

export type { DofileHook };
