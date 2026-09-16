import { redirect } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { saveEmployeeAction } from "@/app/people-actions";
import { getSessionEmployee } from "@/lib/auth";
import { getJob, listDirectReports, listEmployees, listJobs } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function PeoplePage() {
  const actor = await getSessionEmployee();
  if (!actor) redirect("/login");
  const rows = actor.isAdmin ? listEmployees() : listDirectReports(actor.id);
  const jobs = listJobs();
  const people = listEmployees().filter((row) => row.isActive === 1);
  return (
    <div className="space-y-8">
      <div className="page-kicker">
        <span className="pulse-dot" />
        <h1 className="page-title">Сотрудники</h1>
      </div>
      <ul className="panel">
        {rows.map((row) => (
          <li key={row.id} className="list-row">
            <div>
              <a href={`/people/${row.id}`} className="link-accent font-medium">
                {row.name}
              </a>
              <div className="mt-1 text-xs muted">
                {getJob(row.jobId)?.name ?? row.jobId}
                {row.isActive !== 1 ? " · не активен" : ""}
                {row.isAdmin === 1 ? " · админ" : ""}
              </div>
            </div>
            <a href={`/people/${row.id}`} className="nav-link">
              Открыть
            </a>
          </li>
        ))}
        {rows.length === 0 ? <li className="list-row muted">Нет записей</li> : null}
      </ul>
      {actor.isAdmin ? (
        <ActionForm action={saveEmployeeAction} className="panel panel-pad grid gap-3 text-sm md:grid-cols-2">
          <h2 className="section-title md:col-span-2 mb-0">Новый сотрудник</h2>
          <label className="lbl">
            Логин
            <input className="field" name="login" required />
          </label>
          <label className="lbl">
            Имя
            <input className="field" name="name" required />
          </label>
          <label className="lbl">
            Пароль
            <input className="field" type="password" name="password" minLength={8} required />
          </label>
          <label className="lbl">
            Должность
            <select className="field" name="jobId">
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.name}
                </option>
              ))}
            </select>
          </label>
          <label className="lbl">
            Руководитель
            <select className="field" name="managerId">
              <option value="">нет</option>
              {people.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
          <label className="lbl flex items-center gap-2">
            <input type="checkbox" name="isAdmin" value="1" />
            Админ справочника
          </label>
          <button className="btn-primary md:col-span-2 w-fit" type="submit">
            Создать
          </button>
        </ActionForm>
      ) : null}
    </div>
  );
}
