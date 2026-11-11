import { redirect } from "next/navigation";
import { CompetencyMarkSummary } from "@/components/CompetencyMarks";
import { EmployeeIdpSummary } from "@/components/IdpBlock";
import { JobFacts, NextJobs } from "@/components/JobOverview";
import { employeeAchievements } from "@/lib/achievements";
import { getSessionEmployee } from "@/lib/auth";
import { formatUnixDate } from "@/lib/dates";
import { getActiveIdp, getEmployee, getJob, jobHref, listDirectReports, listDueItems } from "@/lib/queries";
import { DueList } from "@/components/DueList";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const due = listDueItems(employee.id);
  const ownDue = due.filter((row) => row.employeeId === employee.id);
  const peopleDue = due.filter((row) => row.employeeId !== employee.id);
  const showPeople =
    employee.isAdmin === 1 ||
    listDirectReports(employee.id).some((row) => row.isActive === 1 && row.id !== employee.id);
  const overdueCount = due.filter((row) => row.overdue).length;
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
          <dd>{formatUnixDate(employee.updatedAt)}</dd>
        </dl>
      </header>

      <div className="cabinet">
        {/* Действия идут в разметке первыми: на узком экране они и стоят сразу после шапки,
            и порядок Tab совпадает с тем, что видно. На широком экране их место задаёт сетка. */}
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
            {overdueCount > 0 ? `Мой ИПР (${overdueCount})` : "Мой ИПР"}
          </a>
        </nav>

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
          <section className="cabinet-card" data-testid="due-summary">
            <h2 className="section-title">Сроки</h2>
            {showPeople ? (
              <div className="space-y-2">
                <h3 className="section-title">По людям</h3>
                <DueList rows={peopleDue} empty="Нет сроков по людям." />
              </div>
            ) : null}
            <div className="space-y-2">
              <h3 className="section-title">Мои</h3>
              <DueList rows={ownDue} empty="Своих сроков нет." />
            </div>
          </section>
        </div>
      </div>
    </article>
  );
}
