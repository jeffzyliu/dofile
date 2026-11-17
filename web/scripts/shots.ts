// The screenshot run's two commands (docs/web-audit-plan.md, N7; kept out of `npm run e2e` and of CI):
//   npm run shots:baseline -- <commit> [--dir <folder>] [playwright args]   build the commit, take its screenshots
//   npm run shots [-- --dir <folder>] [--app <web folder>] [playwright args]  build this tree, compare with the baseline
// The baseline builds the commit in a worktree of its own (<repo>/.claude/worktrees/shots-baseline, reused by the next
// baseline, removed by `node scripts/shots.ts clean`), on this run's E2E_PORT: the e2e setup refuses a server that serves
// another build. The screenshots always run from this checkout's spec, against the build's preview server.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, rmSync } from "node:fs";
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
const worktree = resolve(root, ".claude/worktrees/shots-baseline");
const port = process.env.E2E_PORT ?? "4173";
const BUILD = `SNAPSHOT_QUALITY=5 E2E_PORT=${port} npm run snapshot && DOFILE_URLS=local E2E_PORT=${port} npm run build`;

const [command, ...rest] = process.argv.slice(2);
const take = (flag: string) => {
  const i = rest.indexOf(flag);
  return i < 0 ? undefined : rest.splice(i, 2)[1];
};
const dir = resolve(web, take("--dir") ?? ".shots/baseline");

function screenshots(app: string, update: boolean) {
  run(
    "npx",
    ["playwright", "test", "-c", "screenshots.config.ts", ...(update ? ["--update-snapshots=all"] : []), ...rest],
    web,
    {
      SHOTS_APP: app,
      SHOTS_DIR: dir,
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
} else throw new Error("usage: node scripts/shots.ts baseline <commit> | compare | clean");
