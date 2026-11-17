import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { LOCAL_EDITOR_URL } from "./scripts/urls.ts";

// The screenshot run (docs/web-audit-plan.md, N7): kept out of `npm run e2e` and of CI (its own config, its own folder
// `screenshots/`, `npm run shots`). It serves a build of the editor (SHOTS_APP: the web/ folder of the checkout that was
// built, this one by default; the baseline command points it at its worktree) and compares each state with the
// baseline folder (SHOTS_DIR, `.shots/baseline` by default; git ignores `.shots/`). scripts/shots.ts sets both.
const app = resolve(process.env.SHOTS_APP ?? ".");
const baseline = resolve(process.env.SHOTS_DIR ?? ".shots/baseline");
const editorPort = Number(new URL(LOCAL_EDITOR_URL).port);

export default defineConfig({
  testDir: "screenshots",
  globalSetup: "./screenshots/global-setup.ts", // the server on the port must serve SHOTS_APP's build
  timeout: 600_000, // the engine walk starts an engine
  workers: 1, // one browser at a time: the engine's memory and the pixels do not depend on a neighbour
  retries: 0, // a state that differs once is a finding, not a flake to retry away
  reporter: "list",
  outputDir: resolve(baseline, "..", "results"), // the actual, expected and diff images of a failed comparison
  snapshotPathTemplate: `${baseline}/{projectName}/{arg}{ext}`,
  // Threshold 0 (rule 10: a move changes no pixel; the default 0.2 let a 2-3 level change of --accent pass all 50 shots).
  // maxDiffPixels 30: the unchanged tree against two baselines, 5 runs, differed by at most 14 pixels in a state (1-10
  // typically, in 19 of the 25 states: no one element, so nothing is masked), and 30 is twice that. A changed colour, size or glyph moves hundreds or thousands.
  expect: {
    toHaveScreenshot: { animations: "disabled", caret: "hide", scale: "css", threshold: 0, maxDiffPixels: 30 },
  },
  use: { baseURL: LOCAL_EDITOR_URL, reducedMotion: "reduce" },
  webServer: {
    command: `npx vite preview --port ${editorPort} --strictPort`,
    cwd: app,
    port: editorPort,
    reuseExistingServer: false, // never another build's server
  },
  projects: [
    { name: "chromium", use: devices["Desktop Chrome"] },
    { name: "iphone", use: { ...devices["iPhone 15"], navigationTimeout: 60_000 } },
  ],
});
