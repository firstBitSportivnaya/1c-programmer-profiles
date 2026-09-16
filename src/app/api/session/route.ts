import { NextResponse } from "next/server";
import { SESSION_COOKIE, buildSessionCookie } from "@/lib/auth";
import { bootstrapFirstAdmin, loginWithPassword } from "@/lib/session-login";

export const runtime = "nodejs";

function redirectTo(req: Request, path: string) {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  const base = host ? `${proto}://${host}` : new URL(req.url).origin;
  return NextResponse.redirect(new URL(path, base), 303);
}

export async function POST(req: Request) {
  const form = await req.formData();
  const intent = String(form.get("intent") ?? "login");

  if (intent === "logout") {
    const res = redirectTo(req, "/");
    res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
    res.cookies.set("pp_admin", "", { path: "/", maxAge: 0 });
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

    const cookie = buildSessionCookie(result.employeeId);
    const res = redirectTo(req, "/me");
    res.cookies.set(cookie.name, cookie.value, {
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite,
      path: cookie.path,
      maxAge: cookie.maxAge,
      secure: cookie.secure,
    });
    return res;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Неизвестная ошибка";
    return redirectTo(req, `/login?error=${encodeURIComponent(message)}`);
  }
}
