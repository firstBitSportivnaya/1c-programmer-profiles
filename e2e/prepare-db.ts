/**
 * Запускается перед тестовым сервером: удаляет прошлую e2e-базу, seed загружает её заново.
 * Отказывается работать, если слушает порт 3000: обычный `next dev` и тестовый делят папку .next.
 */
import net from "node:net";
import { removeDatabase } from "../scripts/lib/sqlite-tools";
import { E2E_DB_PATH } from "./env";

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
  if (await portIsListening(3000)) {
    console.error("Порт 3000 занят dev-сервером. Остановите его перед e2e: тестовый сервер пишет в ту же папку .next.");
    process.exit(1);
  }
  removeDatabase(E2E_DB_PATH);
}

main();
