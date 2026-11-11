import { randomBytes, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { employees } from "@/db/schema";
import { ensureSchema } from "@/lib/queries";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, decodeSession, encodeSession } from "@/lib/session-cookie";
import { requestIsHttps } from "@/lib/session-request";

export { SESSION_COOKIE };
const LEGACY_ADMIN_COOKIE = "pp_admin";
const PLACEHOLDERS = new Set(["", "dev-only-change-me", "change-me-to-a-long-random-string"]);

function cookieAttrs(secure: boolean) {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    path: "/",
    secure,
  };
}

function readEnv(name: "ADMIN_PASSWORD" | "SESSION_SECRET"): string | null {
  const value = process.env[name]?.trim() ?? "";
  if (PLACEHOLDERS.has(value)) return null;
  return value;
}

function secret(): string | null {
  return readEnv("SESSION_SECRET");
}

export function envAdminPassword(): string | null {
  return readEnv("ADMIN_PASSWORD");
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

export function verifyEnvAdminPassword(password: string) {
  const expected = envAdminPassword();
  if (!expected) return false;
  const left = Buffer.from(password.normalize("NFKC"));
  const right = Buffer.from(expected.normalize("NFKC"));
  if (left.length !== right.length) {
    timingSafeEqual(Buffer.alloc(32), Buffer.alloc(32));
    return false;
  }
  return timingSafeEqual(left, right);
}

export function hasCatalogAdmin(): boolean {
  ensureSchema();
  return Boolean(getDb().select().from(employees).where(eq(employees.isAdmin, 1)).get());
}

export type SessionEmployee = {
  id: string;
  login: string;
  name: string;
  jobId: string;
  managerId: string | null;
  isAdmin: boolean;
  isActive: boolean;
};

function toSession(row: typeof employees.$inferSelect): SessionEmployee {
  return {
    id: row.id,
    login: row.login,
    name: row.name,
    jobId: row.jobId,
    managerId: row.managerId,
    isAdmin: row.isAdmin === 1,
    isActive: row.isActive === 1,
  };
}

export const getSessionEmployee = cache(async function getSessionEmployee(): Promise<SessionEmployee | null> {
  const key = secret();
  if (!key) return null;
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const claims = decodeSession(raw, key, nowSec());
  if (!claims) return null;
  ensureSchema();
  const row = getDb().select().from(employees).where(eq(employees.id, claims.employeeId)).get();
  if (!row || row.isActive !== 1 || row.sessionVersion !== claims.version) return null;
  return toSession(row);
});

/** Выход с ещё действующей cookie увеличивает версию: копия в другом браузере перестаёт подходить. */
export function revokeSessionCookie(raw: string | null) {
  const key = secret();
  if (!key || !raw) return;
  const claims = decodeSession(raw, key, nowSec());
  if (!claims) return;
  ensureSchema();
  const row = getDb().select().from(employees).where(eq(employees.id, claims.employeeId)).get();
  if (!row || row.sessionVersion !== claims.version) return;
  bumpSessionVersion(claims.employeeId);
}

export function bumpSessionVersion(employeeId: string) {
  ensureSchema();
  getDb()
    .update(employees)
    .set({ sessionVersion: sql`${employees.sessionVersion} + 1` })
    .where(eq(employees.id, employeeId))
    .run();
}

export async function isAdmin() {
  const employee = await getSessionEmployee();
  return Boolean(employee?.isAdmin);
}

export function buildSessionCookie(employeeId: string, secure: boolean) {
  const key = secret();
  if (!key) {
    throw new Error("SESSION_SECRET не задан в .env.local");
  }
  ensureSchema();
  const row = getDb().select().from(employees).where(eq(employees.id, employeeId)).get();
  if (!row) throw new Error("Сотрудник не найден");
  const token = randomBytes(16).toString("hex");
  return {
    name: SESSION_COOKIE,
    value: encodeSession(
      { employeeId, version: row.sessionVersion, issuedAt: nowSec(), token },
      key,
    ),
    ...cookieAttrs(secure),
    maxAge: SESSION_TTL_SECONDS,
  };
}

/** Same name/path/HttpOnly/SameSite as login, otherwise the browser keeps pp_session. */
export function expiredSessionCookies(secure: boolean) {
  const gone = { ...cookieAttrs(secure), value: "", maxAge: 0, expires: new Date(0) };
  return [
    { name: SESSION_COOKIE, ...gone },
    { name: LEGACY_ADMIN_COOKIE, ...gone },
  ];
}

async function httpsRequest() {
  return requestIsHttps(await headers());
}

export async function setSessionCookie(employeeId: string) {
  const cookie = buildSessionCookie(employeeId, await httpsRequest());
  const jar = await cookies();
  jar.set(cookie.name, cookie.value, {
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    path: cookie.path,
    maxAge: cookie.maxAge,
    secure: cookie.secure,
  });
}

export async function clearAdminCookie() {
  const jar = await cookies();
  for (const cookie of expiredSessionCookies(await httpsRequest())) {
    jar.set(cookie.name, cookie.value, {
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite,
      path: cookie.path,
      maxAge: cookie.maxAge,
      expires: cookie.expires,
      secure: cookie.secure,
    });
  }
}

export async function requireEmployee() {
  const employee = await getSessionEmployee();
  if (!employee) {
    throw new Error("Нужна сессия сотрудника");
  }
  return employee;
}

export async function requireAdmin() {
  const employee = await requireEmployee();
  if (!employee.isAdmin) {
    throw new Error("Нужна сессия администратора");
  }
  return employee;
}
