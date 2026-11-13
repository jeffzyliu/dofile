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
  // The editor is at EDITOR_BASE, /app/ today, so a relative URL is the editor's ("?test", "./", "start-files.json") and an
  // absolute one the site's ("/", "/commands/"): page.goto("?test=manual") opens the editor.
  use: { baseURL: `http://localhost:${port}${EDITOR_BASE}`, trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: { command: `npx vite preview --port ${port} --strictPort`, port, reuseExistingServer: true },
  projects: [
    { name: "chromium", use: devices["Desktop Chrome"] },
    { name: "firefox", use: devices["Desktop Firefox"] },
    // navigationTimeout on the two WebKit projects: on Linux, WebKit now and then cancels a fresh page's first navigation
    // to a page served with Cross-Origin-Opener-Policy (WebKit bug 325840, Playwright issue 42957), and page.goto then
    // waited out the whole test timeout. A navigation that works takes about a second; this bounds reload, goBack and
    // waitForURL too, not the engine-ready waits. The test still fails: the cap only makes a hang cost a minute, not ten.
    { name: "webkit", use: { ...devices["Desktop Safari"], navigationTimeout: 60_000 } },
    // emulation: viewport and touch, not a real phone keyboard
    { name: "iphone", use: { ...devices["iPhone 15"], navigationTimeout: 60_000 } },
  ],
});
