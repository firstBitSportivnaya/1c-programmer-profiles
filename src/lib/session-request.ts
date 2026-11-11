type HeaderSource = { get(name: string): string | null };

function first(headers: HeaderSource, name: string) {
  return headers.get(name)?.split(",")[0]?.trim() ?? "";
}

/** `Secure` только когда локальный прокси сказал, что снаружи HTTPS. */
export function requestIsHttps(headers: HeaderSource) {
  return first(headers, "x-forwarded-proto").toLowerCase() === "https";
}

/**
 * Чужой Origin отклоняется. Своего нет — пускаем: браузер на POST Origin присылает.
 * За IIS публичный хост приходит в `x-forwarded-host` и совпадает с Origin формы.
 */
export function foreignSessionOrigin(headers: HeaderSource) {
  const origin = headers.get("origin");
  if (!origin) return false;
  let originHost = "";
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return true;
  }
  const allowed = new Set<string>();
  const host = headers.get("host")?.trim().toLowerCase() ?? "";
  if (host) allowed.add(host);
  const forwarded = first(headers, "x-forwarded-host").toLowerCase();
  if (forwarded) allowed.add(forwarded);
  return !allowed.has(originHost);
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
