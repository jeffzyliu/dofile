// The command line the scripts share: `arg("--shards", 4)` reads the value after a flag, `hasFlag("--ios")` a bare flag.
export const args = process.argv.slice(2);
export const arg = <T>(name: string, fallback: T): string | T =>
  args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
export const hasFlag = (name: string) => args.includes(name);
