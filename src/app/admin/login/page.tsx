import { LoginForm } from "@/components/LoginForm";
import { isAdmin } from "@/lib/auth";
import { redirect } from "next/navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await isAdmin()) redirect("/");
  return (
    <div className="mx-auto max-w-sm">
      <div className="page-kicker">
        <span className="pulse-dot" />
        <h1 className="page-title">Вход администратора</h1>
      </div>
      <div className="panel panel-pad mt-4">
        <LoginForm />
      </div>
    </div>
  );
}
