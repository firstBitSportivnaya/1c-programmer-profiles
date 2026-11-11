import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/** Соль той же длины, что у настоящей учётки: чужой логин тоже проходит scrypt. */
const DUMMY_PASSWORD_HASH =
  "0123456789abcdef0123456789abcdef:9564d5a180593f4f60ac8b2db7e8966b37a1d6fc22b396d69f4f71972c1820f8";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password.normalize("NFKC"), salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPasswordHash(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const actual = scryptSync(password.normalize("NFKC"), salt, 32);
  const expected = Buffer.from(hash, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/** Нет строки сотрудника — считаем фиктивный хэш, чтобы по времени не было видно, есть ли логин. */
export function verifyPresentedPassword(password: string, stored: string | null) {
  return verifyPasswordHash(password, stored ?? DUMMY_PASSWORD_HASH);
}
