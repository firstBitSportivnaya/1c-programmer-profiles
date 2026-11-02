/**
 * Сборка перед e2e. Тестовые серверы работают `next start`, поэтому `.next` нужен готовым.
 *
 * `npm run verify` собирает проект сам и передаёт `E2E_BUILD_FRESH=1`: тогда сборка не повторяется.
 * Отдельный `npm run test:e2e` собирает всегда — в `.next` мог остаться dev-сервер, и `next start`
 * на нём не поднимется.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";

if (process.env.E2E_BUILD_FRESH === "1" && fs.existsSync(".next/BUILD_ID")) {
  console.log("Сборка от проверки уже есть, next build пропущен.");
  process.exit(0);
}

const result = spawnSync("npm", ["run", "build"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
