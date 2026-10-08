/** Окружение тестового сервера. Значения только для e2e: отдельная база в tmp/, свои секреты. */
export const E2E_PORT = 3100;
export const E2E_DB_PATH = "tmp/e2e.sqlite";
export const E2E_ADMIN_PASSWORD = "e2e-admin-password";
export const E2E_SESSION_SECRET = "e2e-session-secret-0123456789abcdef";
/** Первый админ, которого создаёт `session.spec.ts`. Спецификации после неё входят этой учёткой. */
export const E2E_ADMIN = { login: "e2e.admin", name: "Админ E2E", password: "e2e-account-password" };
