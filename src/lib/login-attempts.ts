/** Сколько неверных паролей одного логина держит окно, прежде чем вход закроется. */
export const LOGIN_ATTEMPT_LIMIT = 5;
export const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_LOCKED_MESSAGE = "Вход временно закрыт. Повторите через 15 минут.";
/** Пароль первого админа из окружения — один на процесс, не логин учётки. */
export const ENV_ADMIN_ATTEMPT_KEY = "env-admin";

const MAX_TRACKED_LOGINS = 10_000;
const MAX_KEY_LENGTH = 80;

type AttemptBucket = { failures: number; windowStart: number };

const globalAttempts = globalThis as typeof globalThis & {
  __ppLoginAttempts?: Map<string, AttemptBucket>;
};

function buckets() {
  if (!globalAttempts.__ppLoginAttempts) globalAttempts.__ppLoginAttempts = new Map();
  return globalAttempts.__ppLoginAttempts;
}

function bucketKey(key: string) {
  return key.slice(0, MAX_KEY_LENGTH);
}

/** Чужие логины не копятся в памяти процесса до рестарта. */
function prune(now: number) {
  const map = buckets();
  if (map.size < MAX_TRACKED_LOGINS) return;
  for (const [key, bucket] of map) {
    if (!open(bucket, now)) map.delete(key);
  }
  if (map.size < MAX_TRACKED_LOGINS) return;
  const oldest = [...map.entries()].sort((left, right) => left[1].windowStart - right[1].windowStart);
  for (const [key] of oldest.slice(0, map.size - MAX_TRACKED_LOGINS + 1)) map.delete(key);
}

function open(bucket: AttemptBucket, now: number) {
  return now - bucket.windowStart < LOGIN_ATTEMPT_WINDOW_MS;
}

export function loginBlocked(key: string) {
  const bucket = buckets().get(bucketKey(key));
  if (!bucket) return false;
  if (!open(bucket, Date.now())) {
    buckets().delete(bucketKey(key));
    return false;
  }
  return bucket.failures >= LOGIN_ATTEMPT_LIMIT;
}

export function recordLoginFailure(key: string) {
  const now = Date.now();
  const id = bucketKey(key);
  prune(now);
  const bucket = buckets().get(id);
  if (!bucket || !open(bucket, now)) {
    buckets().set(id, { failures: 1, windowStart: now });
    return;
  }
  bucket.failures += 1;
}

export function clearLoginAttempts(key: string) {
  buckets().delete(bucketKey(key));
}
