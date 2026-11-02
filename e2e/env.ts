/**
 * Окружение тестовых серверов. Значения только для e2e: свои базы в tmp/, свои секреты.
 *
 * Серверов столько же, сколько воркеров, и у каждого своя база: тесты воркеров не делят данные.
 * Сборка у всех одна — `next start` читает готовый `.next`, его готовит `e2e/ensure-build.ts`.
 * Отдельный сервер (`E2E_PORT`) держит базу без админа — на ней `session.spec.ts` проверяет создание первого.
 */
export const E2E_PORT = 3100;
export const E2E_ADMIN_PASSWORD = "e2e-admin-password";
export const E2E_SESSION_SECRET = "e2e-session-secret-0123456789abcdef";
/** Админ базы воркера: его заводит `e2e/seed-admin.ts` до старта сервера. */
export const E2E_ADMIN = { login: "e2e.admin", name: "Админ E2E", password: "e2e-account-password" };

/** Воркеров в основном проекте: столько же серверов и баз. */
export const E2E_WORKERS = Number(process.env.E2E_WORKERS ?? 4);

/** База сервера `session.spec.ts`: админа здесь нет, его создаёт сам тест. */
export const E2E_BOOTSTRAP_DB_PATH = "tmp/e2e-bootstrap.sqlite";

/** Порт сервера воркера основного проекта: 3101, 3102, … */
export function workerPort(index: number) {
  return E2E_PORT + 1 + index;
}

export function workerDbPath(index: number) {
  return `tmp/e2e-${index + 1}.sqlite`;
}

export function baseUrl(port: number) {
  return `http://127.0.0.1:${port}`;
}

/**
 * Порт сервера, к которому относится тест. У проекта из одного файла порт общий,
 * у основного проекта — по номеру воркера (`parallelIndex` уникален внутри прогона).
 */
export function projectPort(metadata: { e2eServer?: "bootstrap" | "worker" }, parallelIndex: number) {
  return metadata.e2eServer === "bootstrap" ? E2E_PORT : workerPort(parallelIndex);
}
