type HeaderSource = { get(name: string): string | null };

function first(headers: HeaderSource, name: string) {
  return headers.get(name)?.split(",")[0]?.trim() ?? "";
}

/** `Secure` только когда локальный прокси сказал, что снаружи HTTPS. */
export function requestIsHttps(headers: HeaderSource) {
  return first(headers, "x-forwarded-proto").toLowerCase() === "https";
}

/** `http://host` и `https://host` — разные источники, даже при одном имени. */
function publicOrigin(scheme: "http" | "https", host: string) {
  const url = new URL(`${scheme}://${host}`);
  return url.origin.toLowerCase();
}

/**
 * Чужой Origin отклоняется. Своего нет — пускаем: браузер на POST Origin присылает.
 * Схема берётся снаружи (`x-forwarded-proto`), хост — из `Host` или `x-forwarded-host`.
 * За IIS публичный адрес приходит в `x-forwarded-host` и совпадает с Origin формы.
 */
export function foreignSessionOrigin(headers: HeaderSource) {
  const origin = headers.get("origin");
  if (!origin) return false;
  let presented = "";
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return true;
    presented = url.origin.toLowerCase();
  } catch {
    return true;
  }
  const scheme = requestIsHttps(headers) ? "https" : "http";
  const allowed = new Set<string>();
  for (const host of [headers.get("host") ?? "", first(headers, "x-forwarded-host")]) {
    const trimmed = host.trim();
    if (!trimmed) continue;
    try {
      allowed.add(publicOrigin(scheme, trimmed));
    } catch {
      // Кривой заголовок хоста не расширяет список.
    }
  }
  return !allowed.has(presented);
}

/**
 * Абсолютный адрес только если переданный хост совпал с `Host`.
 * Иначе относительный путь: браузер остаётся на том хосте, который открыл, и чужой
 * `x-forwarded-host` в Location не попадает. За IIS правило `{HTTP_HOST}` из-за этого живо.
 */
export function sessionLocation(headers: HeaderSource, path: string) {
  const forwarded = first(headers, "x-forwarded-host");
  const host = headers.get("host")?.trim().toLowerCase() ?? "";
  if (forwarded && host && forwarded.toLowerCase() === host) {
    const proto = requestIsHttps(headers) ? "https" : "http";
    return `${proto}://${forwarded}${path}`;
  }
  return path;
}

export function cookieValue(cookieHeader: string | null, name: string) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}
