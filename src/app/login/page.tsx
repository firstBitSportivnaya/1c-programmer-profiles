import { BootstrapAdminForm, LoginForm } from "@/components/LoginForm";
import { getSessionEmployee, hasCatalogAdmin } from "@/lib/auth";
import { listJobs } from "@/lib/queries";
import { redirect } from "next/navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await getSessionEmployee()) redirect("/me");
  const { error } = await searchParams;
  const needBootstrap = !hasCatalogAdmin();
  return (
    <div className="mx-auto max-w-sm space-y-6">
      <div className="page-kicker">
        <span className="pulse-dot" />
        <h1 className="page-title">Вход</h1>
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="panel panel-pad">
        <LoginForm />
      </div>
      {needBootstrap ? (
        <div className="panel panel-pad">
          <h2 className="section-title">Первый админ</h2>
          <p className="muted mb-3 text-sm">
            Пока нет сотрудника-админа, пароль из окружения создаёт первого. После этого он сессию не выдаёт.
          </p>
          <BootstrapAdminForm jobs={listJobs().map((job) => ({ id: job.id, name: job.name }))} />
        </div>
      ) : (
        <p className="muted text-sm">Админ уже создан — войдите логином и паролем учётки.</p>
      )}
    </div>
  );
}
