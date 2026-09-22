"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/action-result";

export function ActionForm({
  action,
  children,
  className,
}: {
  action: (state: ActionResult, formData: FormData) => Promise<ActionResult>;
  children: React.ReactNode;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className={className}>
      {state?.error ? (
        <p className="form-error md:col-span-2" role="alert">
          {state.error}
        </p>
      ) : null}
      {pending ? (
        <p className="muted text-sm md:col-span-2" aria-live="polite">
          Сохраняем…
        </p>
      ) : null}
      {children}
    </form>
  );
}
