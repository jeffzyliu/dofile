// What the check scripts share to run many cases in child processes: a queue taken by N workers, and one child run under
// a time limit. Each script keeps its own reporting. A child is this script run again with `--child ...` (the script's
// `import.meta.url` is given as `script`).
import { spawn } from "node:child_process";

/** Runs `run` on every item, `shards` at a time, in order; resolves when all are done. */
export async function runShards<T>(items: T[], shards: number, run: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: shards }, async () => {
      for (;;) {
        const item = queue.shift();
        if (item === undefined) break;
        await run(item);
      }
    }),
  );
}

export type ChildExit = { code: number | null; timedOut: boolean };

/** Runs `node script ...childArgs`; killed (SIGKILL) after `limitS` seconds (undefined: no limit; 0 kills at once). Stdio is ignored, except
 *  with `onLine`: stdout lines go to it, and stderr is inherited. */
export const runChild = (
  script: string,
  childArgs: string[],
  { limitS, onLine }: { limitS?: number; onLine?: (line: string) => void } = {},
) =>
  new Promise<ChildExit>((done) => {
    const child = spawn(process.execPath, [script, ...childArgs], {
      stdio: onLine ? ["ignore", "pipe", "inherit"] : "ignore",
    });
    let pending = "";
    let timedOut = false;
    const timer =
      limitS !== undefined
        ? setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
          }, limitS * 1000)
        : null;
    child.stdout?.on("data", (d) => {
      pending += d;
      for (;;) {
        const i = pending.indexOf("\n");
        if (i < 0) break;
        const line = pending.slice(0, i);
        pending = pending.slice(i + 1);
        onLine?.(line);
      }
    });
    child.on("exit", (code) => {
      if (timer) clearTimeout(timer);
      done({ code, timedOut });
    });
  });
