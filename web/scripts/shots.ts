// The screenshot run's two commands (docs/web-audit-plan.md, N7; kept out of `npm run e2e` and of CI):
//   npm run shots:baseline -- <commit> [--dir <folder>] [playwright args]   build the commit, take its screenshots
//   npm run shots [-- --dir <folder>] [--app <web folder>] [playwright args]  build this tree, compare with the baseline
// The baseline builds the commit in a worktree of its own for this E2E_PORT (<this checkout>/.claude/worktrees/
// shots-baseline-<port>, reused by the next baseline on that port, removed by `node scripts/shots.ts clean`), on that
// port: the e2e setup refuses a server that serves another build. Its screenshots go to .shots/<port>/baseline, so two
// callers (two checkouts, or two ports in one) never share a worktree or a folder. The screenshots always run from this
// checkout's spec, against the build's preview server. `npm run shots` then prints the near-misses (.shots/<port>/near-misses.txt).
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const web = resolve(import.meta.dirname, "..");
const out = (cmd: string, args: string[], cwd = web) => {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};
const run = (cmd: string, args: string[], cwd: string, env: Record<string, string> = {}) => {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (status ${r.status})`);
};
const sh = (command: string, cwd: string, env: Record<string, string> = {}) => run("sh", ["-c", command], cwd, env);

const root = out("git", ["rev-parse", "--show-toplevel"]);
const port = process.env.E2E_PORT ?? "4173";
const worktree = resolve(root, `.claude/worktrees/shots-baseline-${port}`);
const BUILD = `SNAPSHOT_QUALITY=5 E2E_PORT=${port} npm run snapshot && DOFILE_URLS=local E2E_PORT=${port} npm run build`;

const [command, ...rest] = process.argv.slice(2);
const take = (flag: string) => {
  const i = rest.indexOf(flag);
  return i < 0 ? undefined : rest.splice(i, 2)[1];
};
const dir = resolve(web, take("--dir") ?? `.shots/${port}/baseline`);
const diffs = resolve(dir, "..", "diffs.jsonl"); // one line for each shot of the compare (spec: SHOTS_DIFFS)
const nearMisses = resolve(dir, "..", "near-misses.txt");

/** The states whose diff is 1 to its allowance: they passed, and a small real change is among them. */
function report() {
  if (!existsSync(diffs)) return;
  const rows = readFileSync(diffs, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { project: string; name: string; diff: number; allow: number });
  const near = rows.filter((r) => r.diff >= 1 && r.diff <= r.allow);
  const text = near.length
    ? `near-misses (passed with 1 to the allowance pixels changed; check each is noise, not a change):\n${near.map((r) => `  ${r.project}/${r.name}: ${r.diff} of ${r.allow} pixels`).join("\n")}\n`
    : `no near-misses (${rows.length} shots, none passed with a pixel changed)\n`;
  writeFileSync(nearMisses, text);
  console.log(`${text}(also in ${nearMisses}; every shot's count in ${diffs})`);
}

function screenshots(app: string, update: boolean) {
  rmSync(diffs, { force: true });
  try {
    playwright(app, update);
  } finally {
    if (!update) report();
  }
}

function playwright(app: string, update: boolean) {
  run(
    "npx",
    ["playwright", "test", "-c", "screenshots.config.ts", ...(update ? ["--update-snapshots=all"] : []), ...rest],
    web,
    {
      SHOTS_APP: app,
      SHOTS_DIR: dir,
      SHOTS_DIFFS: diffs,
      E2E_PORT: port,
    },
  );
}

if (command === "baseline") {
  const commit = rest.shift();
  if (!commit) throw new Error("usage: npm run shots:baseline -- <commit> [--dir <folder>]");
  const sha = out("git", ["rev-parse", "--verify", `${commit}^{commit}`]);
  try {
    if (existsSync(worktree)) out("git", ["checkout", "--detach", sha], worktree);
    else out("git", ["worktree", "add", "--detach", worktree, sha]);
    const wtWeb = resolve(worktree, "web");
    // npm ci again only when the commit's lockfile is not the one node_modules was installed from
    const stamp = resolve(wtWeb, "node_modules/.shots-lock");
    const lock = resolve(wtWeb, "package-lock.json");
    if (!existsSync(stamp) || readFileSync(stamp, "utf8") !== readFileSync(lock, "utf8")) {
      sh("npm ci", wtWeb);
      copyFileSync(lock, stamp);
    }
    sh(BUILD, wtWeb); // the wheel goes to the worktree's own root dist/
    rmSync(dir, { recursive: true, force: true });
    screenshots(wtWeb, true);
  } catch (e) {
    console.error(
      `the baseline failed: the worktree ${worktree} may be half made; \`node scripts/shots.ts clean\` removes it`,
    );
    throw e;
  }
  console.log(`baseline of ${sha} in ${dir}`);
} else if (command === "compare") {
  let app = take("--app");
  if (app) app = resolve(app);
  else {
    sh(BUILD, web);
    app = web;
  }
  screenshots(app, false);
} else if (command === "clean") {
  if (existsSync(worktree)) out("git", ["worktree", "remove", "--force", worktree]);
  out("git", ["worktree", "prune"]); // a worktree folder removed by hand
} else throw new Error("usage: node scripts/shots.ts baseline <commit> | compare | clean (all on E2E_PORT's worktree)");
