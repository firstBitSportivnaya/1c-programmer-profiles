import { redirect } from "next/navigation";
import { CompetencyMarkSummary } from "@/components/CompetencyMarks";
import { EmployeeIdpSummary } from "@/components/IdpBlock";
import { JobFacts, NextJobs } from "@/components/JobOverview";
import { employeeAchievements } from "@/lib/achievements";
import { getSessionEmployee } from "@/lib/auth";
import { getActiveIdp, getEmployee, getJob, jobHref } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `employees.updated_at` хранит секунды Unix; в кабинете показываем дату как ДД.ММ.ГГГГ. */
function dottedDate(unixSeconds: number) {
  const date = new Date(unixSeconds * 1000);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}.${month}.${date.getFullYear()}`;
}

/**
 * Кабинет сотрудника: шапка с должностью и статусом, сведения о должности и росте,
 * сводки пометок и ИПР. Список достижений живёт на своей странице, здесь только действие.
 */
export default async function MePage() {
  const session = await getSessionEmployee();
  if (!session) redirect("/login");
  const employee = getEmployee(session.id);
  if (!employee) redirect("/login");
  const job = getJob(employee.jobId);
  const active = getActiveIdp(employee.id);
  const achievementsCount = employeeAchievements(employee.id).length;
  return (
    <article className="space-y-6">
      <header className="cabinet-head">
        <div className="cabinet-head__who">
          <div className="page-kicker">
            <span className="pulse-dot" aria-hidden="true" />
            <h1 className="page-title">{employee.name}</h1>
          </div>
          <p className="cabinet-head__job">
            {job ? (
              <>
                Текущая должность:{" "}
                <a className="link-accent" href={jobHref(job.id)}>
                  {job.name}
                </a>
              </>
            ) : (
              "Должность не назначена"
            )}
          </p>
          <p>
            <span className={employee.isActive === 1 ? "status-badge status-badge--active" : "status-badge"}>
              {employee.isActive === 1 ? "Активен" : "Неактивен"}
            </span>
          </p>
        </div>
        <dl className="cabinet-meta">
          <dt className="muted">Логин</dt>
          <dd>{employee.login}</dd>
          <dt className="muted">Изменён</dt>
          <dd>{dottedDate(employee.updatedAt)}</dd>
        </dl>
      </header>

      <div className="cabinet">
        <div className="cabinet-main">
          {job ? (
            <section className="cabinet-card">
              <h2 className="section-title">Должность</h2>
              <JobFacts job={job} />
            </section>
          ) : null}
          {job ? (
            <section className="cabinet-card">
              <NextJobs
                jobId={job.id}
                admin={false}
                title="Куда можно расти"
                emptyText="Переходов нет"
                kindAsText
              />
            </section>
          ) : null}
          <div className="cabinet-card">
            <CompetencyMarkSummary employeeId={employee.id} jobId={employee.jobId} />
          </div>
          <div className="cabinet-card">
            <EmployeeIdpSummary employeeId={employee.id} />
          </div>
        </div>

        <nav className="cabinet-actions" aria-label="Разделы кабинета">
          <a className="cabinet-action" href="/me/marks">
            Мои пометки
          </a>
          <a className="cabinet-action" href="/me/skills">
            Дерево навыков
          </a>
          <a className="cabinet-action" href="/me/achievements">
            Достижения ({achievementsCount})
          </a>
          <a className="cabinet-action" href={active ? `/idps/${active.id}` : "/idps"}>
            Мой ИПР
          </a>
        </nav>
      </div>
    </article>
  );
}
