import { defineConfig, devices } from "@playwright/test";

// The proof-of-concept page in three engines, served by `vite preview` with the cross-origin isolation headers.
export default defineConfig({
  testDir: "e2e",
  timeout: 300_000,
  reporter: "list",
  use: { baseURL: "http://localhost:4173" },
  webServer: { command: "npx vite preview --port 4173 --strictPort", port: 4173, reuseExistingServer: true },
  projects: [
    { name: "chromium", use: devices["Desktop Chrome"] },
    { name: "firefox", use: devices["Desktop Firefox"] },
    { name: "webkit", use: devices["Desktop Safari"] },
    { name: "iphone", use: devices["iPhone 15"] },   // emulation: viewport and touch, not a real phone keyboard
  ],
});
