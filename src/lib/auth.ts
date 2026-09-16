import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { employees } from "@/db/schema";
import { migrate } from "@/db/migrate";

const COOKIE = "pp_session";
export const SESSION_COOKIE = COOKIE;
const PLACEHOLDERS = new Set(["", "dev-only-change-me", "change-me-to-a-long-random-string"]);

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

function sign(token: string, key: string) {
  return createHmac("sha256", key).update(token).digest("hex");
}

function safeEqual(a: string, b: string) {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  if (aa.length !== bb.length) {
    timingSafeEqual(aa, aa);
    return false;
  }
  return timingSafeEqual(aa, bb);
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
  migrate();
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

export async function getSessionEmployee(): Promise<SessionEmployee | null> {
  const key = secret();
  if (!key) return null;
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;
  if (!raw) return null;
  const [employeeId, token, mac] = raw.split(".");
  if (!employeeId || !token || !mac) return null;
  if (!safeEqual(mac, sign(`${employeeId}.${token}`, key))) return null;
  migrate();
  const row = getDb().select().from(employees).where(eq(employees.id, employeeId)).get();
  if (!row || row.isActive !== 1) return null;
  return toSession(row);
}

export async function isAdmin() {
  const employee = await getSessionEmployee();
  return Boolean(employee?.isAdmin);
}

export function buildSessionCookie(employeeId: string) {
  const key = secret();
  if (!key) {
    throw new Error("SESSION_SECRET не задан в .env.local");
  }
  const token = randomBytes(16).toString("hex");
  return {
    name: COOKIE,
    value: `${employeeId}.${token}.${sign(`${employeeId}.${token}`, key)}`,
    httpOnly: true as const,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 12,
    secure: false,
  };
}

export async function setSessionCookie(employeeId: string) {
  const cookie = buildSessionCookie(employeeId);
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
  jar.delete(COOKIE);
  jar.delete("pp_admin");
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
