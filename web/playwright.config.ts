import { defineConfig, devices } from "@playwright/test";

// The proof-of-concept page in three engines, served by `vite preview` with the cross-origin isolation headers.
export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",   // the server on the port must serve this folder's build
  timeout: 600_000,   // a whole test; the engine-ready waits inside it are 300 s each, and some tests start the engine twice
  reporter: "list",
  use: { baseURL: "http://localhost:4173", trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: { command: "npx vite preview --port 4173 --strictPort", port: 4173, reuseExistingServer: true },
  projects: [
    { name: "chromium", use: devices["Desktop Chrome"] },
    { name: "firefox", use: devices["Desktop Firefox"] },
    { name: "webkit", use: devices["Desktop Safari"] },
    { name: "iphone", use: devices["iPhone 15"] },   // emulation: viewport and touch, not a real phone keyboard
  ],
});
