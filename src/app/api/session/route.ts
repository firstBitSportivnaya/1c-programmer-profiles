import { NextResponse } from "next/server";
import { buildSessionCookie, expiredSessionCookies, revokeSessionCookie, SESSION_COOKIE } from "@/lib/auth";
import { bootstrapFirstAdmin, loginWithPassword } from "@/lib/session-login";
import { cookieValue, foreignSessionOrigin, requestIsHttps, sessionLocation } from "@/lib/session-request";

export const runtime = "nodejs";

function redirectTo(req: Request, path: string) {
  return new NextResponse(null, {
    status: 303,
    headers: { Location: sessionLocation(req.headers, path) },
  });
}

function applyCookie(
  res: NextResponse,
  cookie: {
    name: string;
    value: string;
    httpOnly: boolean;
    sameSite: "lax";
    path: string;
    maxAge: number;
    secure: boolean;
    expires?: Date;
  },
) {
  res.cookies.set(cookie.name, cookie.value, {
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    path: cookie.path,
    maxAge: cookie.maxAge,
    secure: cookie.secure,
    ...(cookie.expires ? { expires: cookie.expires } : {}),
  });
}

export async function POST(req: Request) {
  if (foreignSessionOrigin(req.headers)) {
    return new NextResponse("Чужой сайт", { status: 403 });
  }

  const form = await req.formData();
  const intent = String(form.get("intent") ?? "login");
  const secure = requestIsHttps(req.headers);

  if (intent === "logout") {
    revokeSessionCookie(cookieValue(req.headers.get("cookie"), SESSION_COOKIE));
    const res = redirectTo(req, "/");
    for (const cookie of expiredSessionCookies(secure)) applyCookie(res, cookie);
    return res;
  }

  try {
    const result =
      intent === "bootstrap"
        ? bootstrapFirstAdmin({
            envPassword: String(form.get("envPassword") ?? ""),
            login: String(form.get("login") ?? ""),
            name: String(form.get("name") ?? ""),
            jobId: String(form.get("jobId") ?? ""),
            password: String(form.get("accountPassword") ?? ""),
          })
        : loginWithPassword(String(form.get("login") ?? ""), String(form.get("password") ?? ""));

    if ("error" in result) {
      return redirectTo(req, `/login?error=${encodeURIComponent(result.error)}`);
    }

    const cookie = buildSessionCookie(result.employeeId, secure);
    const res = redirectTo(req, "/me");
    applyCookie(res, cookie);
    return res;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Неизвестная ошибка";
    return redirectTo(req, `/login?error=${encodeURIComponent(message)}`);
  }
}
