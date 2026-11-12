import { defineConfig, devices } from "@playwright/test";
import { EDITOR_BASE } from "./scripts/urls.ts";

// The site in three engines and an iPhone profile, served by `vite preview` (all of dist/; the isolation headers on the
// editor's path).
// E2E_PORT serves the build on another port, so two worktrees can run the tests at the same time.
const port = Number(process.env.E2E_PORT) || 4173;

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts", // the server on the port must serve this folder's build
  timeout: 600_000, // a whole test; the engine-ready waits inside it are 300 s each, and some tests start the engine twice
  reporter: "list",
  // The editor is at EDITOR_BASE (/app/), so a relative URL is the editor's ("?test", "./", "start-files.json") and an
  // absolute one the site's ("/", "/commands/"): page.goto("?test=manual") opens the editor.
  use: { baseURL: `http://localhost:${port}${EDITOR_BASE}`, trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: { command: `npx vite preview --port ${port} --strictPort`, port, reuseExistingServer: true },
  projects: [
    { name: "chromium", use: devices["Desktop Chrome"] },
    { name: "firefox", use: devices["Desktop Firefox"] },
    { name: "webkit", use: devices["Desktop Safari"] },
    { name: "iphone", use: devices["iPhone 15"] }, // emulation: viewport and touch, not a real phone keyboard
  ],
});
