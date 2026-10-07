import { defineConfig } from "@playwright/test";
import { E2E_ADMIN_PASSWORD, E2E_DB_PATH, E2E_PORT, E2E_SESSION_SECRET } from "./e2e/env";

const baseURL = `http://127.0.0.1:${E2E_PORT}`;
// Локально Chromium из Playwright не скачивается через корпоративный прокси, поэтому на Windows берётся Edge.
const channel = process.env.CI
  ? undefined
  : (process.env.E2E_BROWSER_CHANNEL ?? (process.platform === "win32" ? "msedge" : undefined));

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    channel,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `npx tsx e2e/prepare-db.ts && npm run db:seed && npx next dev --hostname 127.0.0.1 --port ${E2E_PORT}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      DB_PATH: E2E_DB_PATH,
      ADMIN_PASSWORD: E2E_ADMIN_PASSWORD,
      SESSION_SECRET: E2E_SESSION_SECRET,
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
