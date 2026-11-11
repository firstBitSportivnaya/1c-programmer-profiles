import { randomBytes } from "node:crypto";
import { getDb, now } from "@/db";
import { employees } from "@/db/schema";
import { hasCatalogAdmin, verifyEnvAdminPassword } from "@/lib/auth";
import {
  ENV_ADMIN_ATTEMPT_KEY,
  LOGIN_LOCKED_MESSAGE,
  clearLoginAttempts,
  loginBlocked,
  recordLoginFailure,
} from "@/lib/login-attempts";
import { hashPassword, verifyPresentedPassword } from "@/lib/password";
import { getEmployeeByLogin, getJob } from "@/lib/queries";

export type SessionAuthResult = { employeeId: string } | { error: string };

function newId(prefix: string) {
  return `${prefix}-${randomBytes(4).toString("hex")}`;
}

export function loginWithPassword(loginRaw: string, password: string): SessionAuthResult {
  const login = loginRaw.trim().toLowerCase();
  const row = login ? getEmployeeByLogin(login) : undefined;
  const passwordOk = verifyPresentedPassword(password, row?.passwordHash ?? null);
  if (loginBlocked(login)) return { error: LOGIN_LOCKED_MESSAGE };
  if (!row || row.isActive !== 1 || !passwordOk) {
    recordLoginFailure(login);
    if (loginBlocked(login)) return { error: LOGIN_LOCKED_MESSAGE };
    return { error: "Неверный логин или пароль" };
  }
  clearLoginAttempts(login);
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
  const locked = loginBlocked(ENV_ADMIN_ATTEMPT_KEY);
  const envOk = verifyEnvAdminPassword(input.envPassword);
  if (locked) return { error: LOGIN_LOCKED_MESSAGE };
  if (!envOk) {
    recordLoginFailure(ENV_ADMIN_ATTEMPT_KEY);
    if (loginBlocked(ENV_ADMIN_ATTEMPT_KEY)) return { error: LOGIN_LOCKED_MESSAGE };
    return { error: "Неверный пароль из окружения" };
  }
  clearLoginAttempts(ENV_ADMIN_ATTEMPT_KEY);
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
