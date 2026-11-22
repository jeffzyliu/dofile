import { resolve } from "node:path";

/** A build's output folder, as Vite resolved it (`build.outDir`, or `--outDir`). */
export const outDirOf = (config: { root: string; build: { outDir: string } }) =>
  resolve(config.root, config.build.outDir);
