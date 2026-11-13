// Test counts, printed on demand: docs/test-map.md keeps no numbers (it describes scope).
//   npm run test-counts          both
//   npm run test-counts unit     the unit tests only (needs the wheel, `npm run wheel`, and the snapshot for the full numbers: without `npm run snapshot` the snapshot-native file counts 1 and engine.test.ts 2 fewer; runs them: Node has no list mode, and a file may make tests in a loop)
//   npm run test-counts e2e      the e2e tests only (`playwright test --list`: no server, no build)
// E2E skips are decided while a test runs, so the list cannot count them: `npx playwright test` ends with "N skipped".
import { spawn, spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

const what = process.argv[2] ?? "both";
if (!["both", "unit", "e2e"].includes(what)) throw new Error(`usage: test-counts [unit|e2e], not "${what}"`);

const table = (rows: [string, number][], unit: string): void => {
  const width = Math.max(...rows.map(([name]) => name.length));
  for (const [name, n] of rows) console.log(`  ${name.padEnd(width)}  ${n}`);
  console.log(`  ${"total".padEnd(width)}  ${rows.reduce((sum, [, n]) => sum + n, 0)} ${unit}`);
};

/** One `node --test` per file, all at once; the count is the TAP summary's `# tests`. */
const unit = async (): Promise<void> => {
  const files = readdirSync("test")
    .filter((f) => f.endsWith(".test.ts"))
    .sort();
  const rows = await Promise.all(
    files.map(
      (file) =>
        new Promise<[string, number]>((resolve, reject) => {
          let out = "";
          const child = spawn(process.execPath, ["--test", "--test-reporter=tap", `test/${file}`]);
          child.stdout.on("data", (chunk) => {
            out += chunk;
          });
          child.on("close", () => {
            const n = /^# tests (\d+)$/m.exec(out)?.[1];
            const failed = Number(/^# fail (\d+)$/m.exec(out)?.[1] ?? 1);
            if (n === undefined || failed > 0)
              reject(
                new Error(
                  `${file} failed, so its count is not a count (npm test shows why; the engine tests need \`npm run wheel\` first)`,
                ),
              );
            else resolve([file, Number(n)]);
          });
        }),
    ),
  );
  console.log("Unit tests (web/test/, as the runner counts them; a skipped test counts):");
  table(rows, "tests");
};

type Spec = { file: string; tests: { projectName: string }[] };
type Suite = { specs?: Spec[]; suites?: Suite[] };

const e2e = (): void => {
  const run = spawnSync("npx", ["playwright", "test", "--list", "--reporter=json"], {
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });
  if (run.status !== 0) throw new Error(`playwright --list failed:\n${run.stderr}`);
  const perFile = new Map<string, number>();
  const perProject = new Map<string, number>();
  const walk = (suite: Suite): void => {
    for (const spec of suite.specs ?? []) {
      perFile.set(spec.file, (perFile.get(spec.file) ?? 0) + 1);
      for (const t of spec.tests) perProject.set(t.projectName, (perProject.get(t.projectName) ?? 0) + 1);
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of (JSON.parse(run.stdout) as { suites: Suite[] }).suites) walk(suite);
  console.log("E2E tests (web/e2e/, each runs in every project):");
  table([...perFile].sort(), "tests");
  console.log("E2E cases per project (skipped ones included; see the header for how to count those):");
  table([...perProject], "cases");
};

if (what !== "e2e") await unit();
if (what === "both") console.log();
if (what !== "unit") e2e();
