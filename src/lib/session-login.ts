import { randomBytes } from "node:crypto";
import { getDb, now } from "@/db";
import { employees } from "@/db/schema";
import { hasCatalogAdmin, verifyEnvAdminPassword } from "@/lib/auth";
import { hashPassword, verifyPasswordHash } from "@/lib/password";
import { getEmployeeByLogin, getJob } from "@/lib/queries";

export type SessionAuthResult = { employeeId: string } | { error: string };

function newId(prefix: string) {
  return `${prefix}-${randomBytes(4).toString("hex")}`;
}

export function loginWithPassword(loginRaw: string, password: string): SessionAuthResult {
  const login = loginRaw.trim().toLowerCase();
  const row = getEmployeeByLogin(login);
  if (!row || row.isActive !== 1 || !verifyPasswordHash(password, row.passwordHash)) {
    return { error: "Неверный логин или пароль" };
  }
  return { employeeId: row.id };
}

export function bootstrapFirstAdmin(input: {
  envPassword: string;
  login: string;
  name: string;
  jobId: string;
  password: string;
}): SessionAuthResult {
  if (hasCatalogAdmin()) {
    return { error: "Первый админ уже есть — войдите логином учётки" };
  }
  if (!verifyEnvAdminPassword(input.envPassword)) {
    return { error: "Неверный пароль из окружения" };
  }
  const login = input.login.trim().toLowerCase();
  if (!/^[a-z0-9._-]{2,40}$/.test(login)) {
    return { error: "Логин: 2–40 символов, латиница, цифры, точка, дефис" };
  }
  const name = input.name.trim();
  const jobId = input.jobId.trim();
  const password = input.password;
  if (!name || password.length < 8) {
    return { error: "Нужны имя и пароль учётки не короче 8 символов" };
  }
  if (!getJob(jobId)) return { error: "Должность не найдена" };
  if (getEmployeeByLogin(login)) return { error: "Такой логин уже есть" };
  const id = newId("emp");
  getDb()
    .insert(employees)
    .values({
      id,
      login,
      name,
      passwordHash: hashPassword(password),
      jobId,
      managerId: null,
      isAdmin: 1,
      isActive: 1,
      updatedAt: now(),
    })
    .run();
  return { employeeId: id };
}
