"use client";

import { useActionState } from "react";
import { loginAction } from "@/app/actions";

export function LoginForm() {
  const [state, action] = useActionState(loginAction, null);
  return (
    <form action={action} className="space-y-3">
      <label className="lbl">
        Пароль
        <input className="field" type="password" name="password" required />
      </label>
      {state && !state.ok ? <p className="text-sm" style={{ color: "var(--security-stroke)" }}>{state.error}</p> : null}
      <button className="btn-primary w-full" type="submit">
        Войти
      </button>
    </form>
  );
}
