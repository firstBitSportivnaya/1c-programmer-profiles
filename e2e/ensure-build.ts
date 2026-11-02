/**
 * Сборка перед e2e. Тестовые серверы работают `next start`, поэтому `.next` нужен готовым.
 *
 * `npm run verify` собирает проект сам и передаёт `E2E_BUILD_FRESH=1`: тогда сборка не повторяется.
 * Отдельный `npm run test:e2e` собирает всегда, но отказывается работать, если слушает порт 3000:
 * `next dev` и сборка пишут в одну папку `.next`, и dev-сервер после этого не поднимется.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";

/** Слушает ли кто-то порт. Соединение не удерживаем. */
function portIsListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

async function main() {
  if (process.env.E2E_BUILD_FRESH === "1" && fs.existsSync(".next/BUILD_ID")) {
    console.log("Сборка от проверки уже есть, next build пропущен.");
    process.exit(0);
  }
  if (await portIsListening(3000)) {
    console.error("Порт 3000 занят dev-сервером. Остановите его перед e2e: сборка пишет в ту же папку .next.");
    process.exit(1);
  }
  const result = spawnSync("npm", ["run", "build"], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  process.exit(result.status ?? 1);
}

main();
