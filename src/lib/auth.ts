import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const COOKIE = "pp_admin";
const PLACEHOLDERS = new Set(["", "dev-only-change-me", "change-me-to-a-long-random-string"]);

function readEnv(name: "ADMIN_PASSWORD" | "SESSION_SECRET"): string | null {
  const value = process.env[name]?.trim() ?? "";
  if (PLACEHOLDERS.has(value)) return null;
  return value;
}

function secret(): string | null {
  return readEnv("SESSION_SECRET");
}

function expectedPassword(): string | null {
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

export function verifyPassword(password: string) {
  const expected = expectedPassword();
  if (!expected) return false;
  const left = Buffer.from(password.normalize("NFKC"));
  const right = Buffer.from(expected.normalize("NFKC"));
  if (left.length !== right.length) {
    timingSafeEqual(Buffer.alloc(32), Buffer.alloc(32));
    return false;
  }
  return timingSafeEqual(left, right);
}

export async function isAdmin() {
  const key = secret();
  if (!key) return false;
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;
  if (!raw) return false;
  const [token, mac] = raw.split(".");
  if (!token || !mac) return false;
  return safeEqual(mac, sign(token, key));
}

export async function setAdminCookie() {
  const key = secret();
  if (!key) {
    throw new Error("SESSION_SECRET не задан в .env.local");
  }
  const token = randomBytes(16).toString("hex");
  const jar = await cookies();
  jar.set(COOKIE, `${token}.${sign(token, key)}`, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
    secure: false,
  });
}

export async function clearAdminCookie() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function requireAdmin() {
  if (!(await isAdmin())) {
    throw new Error("Нужна сессия администратора");
  }
}
