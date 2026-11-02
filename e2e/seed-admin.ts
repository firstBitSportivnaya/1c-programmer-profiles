/**
 * Заводит админа в базу воркера до старта сервера. Вход в тестах тогда не тратит шаги интерфейса,
 * а создание первого админа через форму остаётся проверкой `session.spec.ts` на отдельной базе.
 */
import { getDb, now } from "../src/db";
import { employees } from "../src/db/schema";
import { hashPassword } from "../src/lib/password";
import { E2E_ADMIN } from "./env";

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
