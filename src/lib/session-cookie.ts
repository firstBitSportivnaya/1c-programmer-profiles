import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "pp_session";
/** Сервер отвергает cookie старше этого срока, даже если браузер её хранит. */
export const SESSION_TTL_SECONDS = 60 * 60 * 12;

export type SessionClaims = {
  employeeId: string;
  version: number;
  issuedAt: number;
  token: string;
};

export function signSession(payload: string, key: string) {
  return createHmac("sha256", key).update(payload).digest("hex");
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

/** `employeeId.version.issuedAt.token.mac`. Идентификатор сотрудника без точек. */
export function encodeSession(claims: SessionClaims, key: string) {
  const payload = `${claims.employeeId}.${claims.version}.${claims.issuedAt}.${claims.token}`;
  return `${payload}.${signSession(payload, key)}`;
}

/**
 * Подпись, срок и формат. Версию сверкает уже вызывающий код со строкой сотрудника.
 * Старая cookie из трёх частей сюда не проходит.
 */
export function decodeSession(raw: string, key: string, nowSec: number): SessionClaims | null {
  const parts = raw.split(".");
  if (parts.length !== 5) return null;
  const [employeeId, versionRaw, issuedRaw, token, mac] = parts;
  if (!employeeId || !token || !mac) return null;
  if (!/^\d+$/.test(versionRaw) || !/^\d+$/.test(issuedRaw)) return null;
  const payload = `${employeeId}.${versionRaw}.${issuedRaw}.${token}`;
  if (!safeEqual(mac, signSession(payload, key))) return null;
  const issuedAt = Number(issuedRaw);
  if (!Number.isSafeInteger(issuedAt)) return null;
  if (issuedAt > nowSec + 60) return null;
  if (nowSec - issuedAt > SESSION_TTL_SECONDS) return null;
  return { employeeId, version: Number(versionRaw), issuedAt, token };
}
