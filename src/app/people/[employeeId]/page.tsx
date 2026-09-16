import { notFound, redirect } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { EmployeeIdpSummary } from "@/components/IdpBlock";
import { assignJobAction, deactivateEmployeeAction, saveEmployeeAction } from "@/app/people-actions";
import { getSessionEmployee } from "@/lib/auth";
import { canManageEmployee, canViewEmployee } from "@/lib/invariants";
import { getEmployee, getJob, listEmployees, listJobs } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function PersonPage({ params }: { params: Promise<{ employeeId: string }> }) {
  const actor = await getSessionEmployee();
  if (!actor) redirect("/login");
  const { employeeId } = await params;
  const row = getEmployee(employeeId);
  if (!row) notFound();
  if (!canViewEmployee(actor, employeeId)) notFound();
  const job = getJob(row.jobId);
  const jobs = listJobs();
  const people = listEmployees().filter((e) => e.isActive === 1 && e.id !== row.id);
  const manage = canManageEmployee(actor, row.id);

  return (
    <article className="space-y-6">
      <div className="page-kicker">
        <span className="pulse-dot" />
        <h1 className="page-title">{row.name}</h1>
      </div>
      <dl className="panel panel-pad grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
        <dt className="muted">Логин</dt>
        <dd>{row.login}</dd>
        <dt className="muted">Должность</dt>
        <dd>
          {job ? (
            <a className="link-accent" href={`/jobs/${job.id}`}>
              {job.name}
            </a>
          ) : (
            row.jobId
          )}
        </dd>
        <dt className="muted">Активен</dt>
        <dd>{row.isActive === 1 ? "да" : "нет"}</dd>
      </dl>

      {manage && row.isActive === 1 ? (
        <ActionForm action={assignJobAction} className="panel panel-pad flex flex-wrap items-end gap-3 text-sm">
          <input type="hidden" name="employeeId" value={row.id} />
          <label className="lbl">
            Назначить должность
            <select className="field" name="jobId" defaultValue={row.jobId}>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.name}
                </option>
              ))}
            </select>
          </label>
          <button className="btn-primary" type="submit">
            Сохранить
          </button>
        </ActionForm>
      ) : null}

      {actor.isAdmin ? (
        <section className="panel panel-pad space-y-4">
          <h2 className="section-title">Правка</h2>
          <ActionForm action={saveEmployeeAction} className="grid grid-cols-2 gap-3 text-sm">
            <input type="hidden" name="id" value={row.id} />
            <label className="lbl">
              Логин
              <input className="field" name="login" defaultValue={row.login} />
            </label>
            <label className="lbl">
              Имя
              <input className="field" name="name" defaultValue={row.name} />
            </label>
            <label className="lbl">
              Должность
              <select className="field" name="jobId" defaultValue={row.jobId}>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="lbl">
              Руководитель
              <select className="field" name="managerId" defaultValue={row.managerId ?? ""}>
                <option value="">нет</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="lbl">
              Новый пароль
              <input className="field" type="password" name="password" />
            </label>
            <label className="lbl flex items-center gap-2">
              <input type="checkbox" name="isAdmin" value="1" defaultChecked={row.isAdmin === 1} />
              Админ
            </label>
            <button className="btn-primary w-fit" type="submit">
              Сохранить
            </button>
          </ActionForm>
          {row.isActive === 1 ? (
            <ActionForm action={deactivateEmployeeAction}>
              <input type="hidden" name="employeeId" value={row.id} />
              <button className="btn-danger" type="submit">
                Деактивировать
              </button>
            </ActionForm>
          ) : null}
        </section>
      ) : null}

      <EmployeeIdpSummary employeeId={row.id} />
    </article>
  );
}
