import { redirect } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { EmployeeImportForm } from "@/components/EmployeeImportForm";
import { ListFilter } from "@/components/ListFilter";
import { saveEmployeeAction } from "@/app/people-actions";
import { getSessionEmployee } from "@/lib/auth";
import { matchesText, NAME_SORTS, pickedSort, queryNeedle, sortRows } from "@/lib/list-query";
import { listDirectReports, listEmployees, listJobs } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sort?: string }>;
}) {
  const actor = await getSessionEmployee();
  if (!actor) redirect("/login");
  const { q = "", sort } = await searchParams;
  const order = pickedSort(sort, ["name", "name-desc"]);
  const rows = actor.isAdmin ? listEmployees() : listDirectReports(actor.id);
  const jobs = listJobs();
  const jobName = new Map(jobs.map((job) => [job.id, job.name]));
  const needle = queryNeedle(q);
  const shown = sortRows(
    rows.filter((row) => matchesText(needle, row.name, jobName.get(row.jobId) ?? row.jobId)),
    order,
    (row) => row.name,
  );
  const people = listEmployees().filter((row) => row.isActive === 1);
  return (
    <div className="space-y-8">
      <div className="page-kicker">
        <span className="pulse-dot" />
        <h1 className="page-title">Сотрудники</h1>
      </div>
      <ListFilter
        action="/people"
        q={q}
        sort={order}
        sorts={NAME_SORTS.map((item) => ({
          ...item,
          label: item.value === "name" ? "Имя А→Я" : "Имя Я→А",
        }))}
      />
      {shown.length === 0 ? (
        <p className="muted">{needle ? "Ничего не найдено" : "Нет записей"}</p>
      ) : (
        <ul className="panel">
          {shown.map((row) => (
            <li key={row.id} className="list-row">
              <div>
                <a href={`/people/${row.id}`} className="link-accent font-medium">
                  {row.name}
                </a>
                <div className="mt-1 muted caption">
                  {jobName.get(row.jobId) ?? row.jobId}
                  {row.isActive !== 1 ? " · не активен" : ""}
                  {row.isAdmin === 1 ? " · админ" : ""}
                </div>
              </div>
              <a href={`/people/${row.id}`} className="nav-link">
                Открыть
              </a>
            </li>
          ))}
        </ul>
      )}
      {actor.isAdmin ? (
        <>
        <ActionForm action={saveEmployeeAction} className="panel panel-pad grid gap-3 md:grid-cols-2">
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
          <label className="lbl">
            Админ
            <select className="field" name="isAdmin" defaultValue="">
              <option value="">нет</option>
              <option value="1">да</option>
            </select>
          </label>
          <button className="btn-primary md:col-span-2 w-fit" type="submit">
            Создать
          </button>
        </ActionForm>
        <EmployeeImportForm />
        </>
      ) : null}
    </div>
  );
}
