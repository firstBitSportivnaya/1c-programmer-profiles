import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const COOKIE = "pp_admin";

function secret() {
  return process.env.SESSION_SECRET || "dev-only-change-me";
}

function expectedPassword() {
  return process.env.ADMIN_PASSWORD || "change-me";
}

function sign(token: string) {
  return createHmac("sha256", secret()).update(token).digest("hex");
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
  const left = Buffer.from(password.normalize("NFKC"));
  const right = Buffer.from(expectedPassword().normalize("NFKC"));
  if (left.length !== right.length) {
    timingSafeEqual(Buffer.alloc(32), Buffer.alloc(32));
    return false;
  }
  return timingSafeEqual(left, right);
}

export async function isAdmin() {
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;
  if (!raw) return false;
  const [token, mac] = raw.split(".");
  if (!token || !mac) return false;
  return safeEqual(mac, sign(token));
}

export async function setAdminCookie() {
  const token = randomBytes(16).toString("hex");
  const jar = await cookies();
  jar.set(COOKIE, `${token}.${sign(token)}`, {
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
