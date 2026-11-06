import { redirect } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { AchievementFields } from "@/components/AchievementFields";
import { saveAchievementAction } from "@/app/actions";
import { isAdmin } from "@/lib/auth";
import { listJobs } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function NewAchievementPage() {
  if (!(await isAdmin())) redirect("/admin/login");
  const jobs = listJobs().map((job) => ({ id: job.id, name: job.name }));
  return (
    <div className="space-y-6">
      <p>
        <a href="/admin/achievements" className="link-accent">
          ← Каталог достижений
        </a>
      </p>
      <div className="page-kicker">
        <span className="pulse-dot" />
        <h1 className="page-title">Новое достижение</h1>
      </div>
      <ActionForm
        action={saveAchievementAction}
        successPath="/admin/achievements/{id}"
        className="panel panel-pad grid gap-3 md:grid-cols-2"
      >
        <input type="hidden" name="create" value="1" />
        <AchievementFields jobs={jobs} />
        <button className="btn-primary w-fit" type="submit">
          Создать
        </button>
      </ActionForm>
    </div>
  );
}
