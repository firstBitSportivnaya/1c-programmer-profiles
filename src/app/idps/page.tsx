import { redirect } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { DateField } from "@/components/DateField";
import { createIdpAction } from "@/app/idp-actions";
import { getSessionEmployee } from "@/lib/auth";
import { canManageEmployee } from "@/lib/invariants";
import {
  activeIdpEmployeeIds,
  jobsWithProfiles,
  listEmployees,
  listEmployeesVisibleTo,
  listIdpAcceptance,
  listIdpsVisibleTo,
  listJobs,
} from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IDP_STATUS: Record<string, string> = {
  active: "активен",
  completed: "выполнен",
  cancelled: "отменён",
};

function statusChipClass(status: string) {
  if (status === "cancelled") return "chip chip-cloud";
  if (status === "active" || status === "completed") return "chip chip-backend";
  return "chip";
}

export default async function IdpsPage({
  searchParams,
}: {
  searchParams: Promise<{ employee?: string | string[] }>;
}) {
  const actor = await getSessionEmployee();
  if (!actor) redirect("/login");
  const { employee = "" } = await searchParams;
  const requested = (Array.isArray(employee) ? employee[0] : employee).trim();
  const plans = listIdpsVisibleTo(actor);
  const people = listEmployeesVisibleTo(actor);
  const targets = jobsWithProfiles().map((job) => ({ id: job.id, name: job.name }));
  const busy = activeIdpEmployeeIds();
  const creatable = people.filter((row) => canManageEmployee(actor, row.id) && !busy.has(row.id));
  const employeesById = new Map(listEmployees().map((row) => [row.id, row]));
  const jobsById = new Map(listJobs().map((row) => [row.id, row]));
  const counts = new Map<string, { total: number; accepted: number }>();
  for (const row of listIdpAcceptance(plans.map((idp) => idp.id))) {
    const current = counts.get(row.idpId) ?? { total: 0, accepted: 0 };
    current.total += 1;
    if (row.acceptedAt != null) current.accepted += 1;
    counts.set(row.idpId, current);
  }
  const owners = [
    ...new Map(plans.map((idp) => [idp.employeeId, employeesById.get(idp.employeeId)?.name ?? idp.employeeId])).entries(),
  ]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const known = owners.some((row) => row.id === requested);
  const shown = requested === "" ? plans : known ? plans.filter((idp) => idp.employeeId === requested) : [];

  return (
    <div className="space-y-8">
      <div className="page-kicker">
        <span className="pulse-dot" />
        <h1 className="page-title">ИПР</h1>
      </div>
      {creatable.length > 0 && targets.length > 0 ? (
        <ActionForm action={createIdpAction} className="panel panel-pad flex flex-wrap items-end gap-3">
          <h2 className="section-title w-full mb-0">Новый ИПР</h2>
          <label className="lbl">
            Сотрудник
            <select className="field" name="employeeId" required>
              {creatable.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
          <label className="lbl">
            Цель
            <select className="field" name="targetJobId" required>
              {targets.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.name}
                </option>
              ))}
            </select>
          </label>
          <DateField label="Начало" name="periodStart" required />
          <DateField label="Конец" name="periodEnd" required />
          <button className="btn-primary" type="submit">
            Создать
          </button>
        </ActionForm>
      ) : null}
      {plans.length > 0 ? (
        <form action="/idps" className="flex flex-wrap items-end gap-3">
          <label className="lbl">
            Сотрудник
            <select className="field" name="employee" aria-label="Фильтр сотрудника" defaultValue={known ? requested : ""}>
              <option value="">все</option>
              {owners.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
          <button className="btn" type="submit">
            Показать
          </button>
        </form>
      ) : null}
      <ul className="panel">
        {shown.map((idp) => {
          const owner = employeesById.get(idp.employeeId);
          const creator = employeesById.get(idp.createdById);
          const source = jobsById.get(idp.sourceJobId);
          const target = jobsById.get(idp.targetJobId);
          const progress = counts.get(idp.id) ?? { total: 0, accepted: 0 };
          return (
            <li key={idp.id} className="list-row">
              <div>
                <a href={`/idps/${idp.id}`} className="link-accent font-medium">
                  {source?.name ?? idp.sourceJobId} → {target?.name ?? idp.targetJobId}
                </a>
                <div className="mt-1 muted caption">
                  {owner?.name ?? idp.employeeId}
                  {creator ? ` · создал ${creator.name}` : ""}
                  {idp.periodStart && idp.periodEnd ? ` · ${idp.periodStart} — ${idp.periodEnd}` : ""}
                  {idp.status === "active" ? ` · принято ${progress.accepted} из ${progress.total}` : ""}
                </div>
              </div>
              <span className={statusChipClass(idp.status)}>{IDP_STATUS[idp.status] ?? idp.status}</span>
            </li>
          );
        })}
        {shown.length === 0 ? (
          <li className="list-row muted">{plans.length === 0 ? "ИПР ещё нет" : "Ничего не найдено."}</li>
        ) : null}
      </ul>
    </div>
  );
}
