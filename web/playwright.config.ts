import { defineConfig, devices } from "@playwright/test";
import { LOCAL_EDITOR_URL, LOCAL_SITE_URL } from "./scripts/urls.ts";

// The site in three engines and an iPhone profile, served by two `vite preview`s as the two Workers are: the landing and
// commands pages (dist/site) on one origin, the editor (dist/app, every path isolated) on the next port. The origins are
// scripts/urls.ts's LOCAL_SITE_URL and LOCAL_EDITOR_URL, which `npm run e2e` builds the pages' links with (DOFILE_URLS=local).
// E2E_PORT serves the build on another pair of ports, so two worktrees can run the tests at the same time.
const sitePort = Number(new URL(LOCAL_SITE_URL).port);
const editorPort = Number(new URL(LOCAL_EDITOR_URL).port);

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts", // the server on the port must serve this folder's build
  timeout: 600_000, // a whole test; the engine-ready waits inside it are 300 s each, and some tests start the engine twice
  reporter: "list",
  // The editor is the baseURL, so a relative URL is the editor's ("?test", "start-files.json"): page.goto("?test=manual") opens
  // it. The landing and commands pages are another origin: the tests spell it (LOCAL_SITE_URL, `${LOCAL_SITE_URL}commands/`).
  use: { baseURL: LOCAL_EDITOR_URL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: [
    {
      command: `npx vite preview --mode site --port ${sitePort} --strictPort`,
      port: sitePort,
      reuseExistingServer: true,
    },
    { command: `npx vite preview --port ${editorPort} --strictPort`, port: editorPort, reuseExistingServer: true },
  ],
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
