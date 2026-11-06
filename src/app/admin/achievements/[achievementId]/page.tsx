import { notFound, redirect } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { AchievementFields } from "@/components/AchievementFields";
import { saveAchievementAction, setAchievementArchivedAction } from "@/app/actions";
import { isAdmin } from "@/lib/auth";
import { getAchievement, listJobs } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Карточка записи каталога (ADR 0010). Ключ показан, но не редактируется: на него ссылаются выдачи.
 * Скрытие вынесено отдельной формой — правка названия или правила не меняет доступность выдачи.
 */
export default async function AchievementPage({ params }: { params: Promise<{ achievementId: string }> }) {
  if (!(await isAdmin())) redirect("/admin/login");
  const { achievementId } = await params;
  const achievement = getAchievement(decodeURIComponent(achievementId));
  if (!achievement) notFound();
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
        <h1 className="page-title">{achievement.title}</h1>
      </div>
      <p className="muted caption">
        {achievement.id}
        {achievement.archived !== 0 ? " · скрыто" : ""}
      </p>
      <ActionForm action={saveAchievementAction} className="panel panel-pad grid gap-3 md:grid-cols-2">
        <AchievementFields achievement={achievement} jobs={jobs} />
        <button className="btn-primary w-fit" type="submit">
          Сохранить
        </button>
      </ActionForm>
      <section aria-label="Скрытие" className="panel panel-pad space-y-3">
        <h2 className="section-title">Скрытие</h2>
        <p className="muted">
          Скрытая запись не предлагается к выдаче. Уже выданные достижения остаются у сотрудников и не отзываются.
        </p>
        <ActionForm action={setAchievementArchivedAction}>
          <input type="hidden" name="id" value={achievement.id} />
          <input type="hidden" name="archived" value={achievement.archived === 0 ? "1" : "0"} />
          <button className={achievement.archived === 0 ? "btn-danger" : "btn"} type="submit">
            {achievement.archived === 0 ? "Скрыть" : "Вернуть в каталог"}
          </button>
        </ActionForm>
      </section>
    </div>
  );
}
