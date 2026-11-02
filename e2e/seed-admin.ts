/**
 * Заводит админа в базу воркера до старта сервера. Вход в тестах тогда не тратит шаги интерфейса,
 * а создание первого админа через форму остаётся проверкой `session.spec.ts` на отдельной базе.
 * Пароль админа лежит в репозитории, поэтому без явного DB_PATH и с путём в `data/` скрипт не пишет.
 */
import path from "node:path";
import { getDb, now } from "../src/db";
import { employees } from "../src/db/schema";
import { hashPassword } from "../src/lib/password";
import { E2E_ADMIN } from "./env";

const dbPath = process.env.DB_PATH?.trim();
if (!dbPath) {
  console.error("DB_PATH не задан. seed-admin.ts не пишет в data/profiles.sqlite.");
  process.exit(1);
}
const fromData = path.relative(path.resolve("data"), path.resolve(dbPath));
if (fromData === "" || (!fromData.startsWith("..") && !path.isAbsolute(fromData))) {
  console.error("DB_PATH указывает в data/. Админа с паролем из репозитория скрипт туда не пишет.");
  process.exit(1);
}

getDb()
  .insert(employees)
  .values({
    id: "emp-e2e-admin",
    login: E2E_ADMIN.login,
    name: E2E_ADMIN.name,
    passwordHash: hashPassword(E2E_ADMIN.password),
    jobId: "team-lead",
    managerId: null,
    isAdmin: 1,
    isActive: 1,
    updatedAt: now(),
  })
  .run();
