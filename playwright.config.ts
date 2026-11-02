import { defineConfig } from "@playwright/test";
import {
  E2E_ADMIN_PASSWORD,
  E2E_BOOTSTRAP_DB_PATH,
  E2E_PORT,
  E2E_SESSION_SECRET,
  E2E_WORKERS,
  baseUrl,
  workerDbPath,
  workerPort,
} from "./e2e/env";

// Локально Chromium из Playwright не скачивается через корпоративный прокси, поэтому на Windows берётся Edge.
const channel = process.env.CI
  ? undefined
  : (process.env.E2E_BROWSER_CHANNEL ?? (process.platform === "win32" ? "msedge" : undefined));

/**
 * Один тестовый сервер: своя база (её seed заполняет заново) поверх общей production-сборки.
 * `next start` не компилирует маршруты и не трогает `.next`, поэтому параллельные серверы не мешают друг другу.
 * `withAdmin` заводит админа до старта — иначе его создавал бы первый файл спецификаций и задавал порядок.
 */
function server(port: number, dbPath: string, withAdmin: boolean) {
  const command = [
    `npx tsx e2e/prepare-db.ts ${dbPath}`,
    "npm run db:seed",
    ...(withAdmin ? ["npx tsx e2e/seed-admin.ts"] : []),
    `npx next start --hostname 127.0.0.1 --port ${port}`,
  ].join(" && ");
  return {
    command,
    url: baseUrl(port),
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      DB_PATH: dbPath,
      ADMIN_PASSWORD: E2E_ADMIN_PASSWORD,
      SESSION_SECRET: E2E_SESSION_SECRET,
      NEXT_TELEMETRY_DISABLED: "1",
    },
  };
}

const workerServers = Array.from({ length: E2E_WORKERS }, (_, index) =>
  server(workerPort(index), workerDbPath(index), true),
);
// База без админа: `session.spec.ts` проверяет на ней создание первого админа.
const bootstrapServer = server(E2E_PORT, E2E_BOOTSTRAP_DB_PATH, false);

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  workers: E2E_WORKERS,
  retries: process.env.CI ? 1 : 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    // Адрес по умолчанию — чистый сервер без админа. Файлы с `e2e/fixtures.ts` берут порт своего воркера.
    baseURL: baseUrl(E2E_PORT),
    channel,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    // Одна база без админа и один сервер: файл идёт сам по себе и не задаёт порядок остальным.
    { name: "bootstrap", testMatch: "session.spec.ts", metadata: { e2eServer: "bootstrap" } },
    { name: "main", testIgnore: "session.spec.ts", metadata: { e2eServer: "worker" } },
  ],
  webServer: [bootstrapServer, ...workerServers],
});
