import { defineConfig, devices } from "@playwright/test";

/**
 * @orbb/web Playwright harness (M0-B).
 *
 * - The `chromium` project is the gate: `pnpm e2e` runs it headless.
 * - `webkit` and `firefox` are listed per the architecture's cross-browser
 *   requirement but are intentionally not part of the M0 gate (browsers may
 *   be absent in CI/sandboxes); they run with `pnpm exec playwright test`.
 * - The web server boots the Next.js dev shell on a fixed port (3100) to
 *   avoid clashing with other local dev servers; it is reused when already
 *   running locally.
 */
// overridable (e.g. when 3100 is taken by another local service)
const PORT = Number(process.env.ORBB_WEB_E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
  ],
  webServer: {
    command: `pnpm exec next dev --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
