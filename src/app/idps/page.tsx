import { redirect } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { createIdpAction } from "@/app/idp-actions";
import { getSessionEmployee } from "@/lib/auth";
import { canManageEmployee } from "@/lib/invariants";
import {
  getActiveIdp,
  getEmployee,
  getJob,
  jobsWithProfiles,
  listEmployeesVisibleTo,
  listIdpItems,
  listIdpsVisibleTo,
} from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IDP_STATUS: Record<string, string> = {
  active: "активен",
  completed: "выполнен",
  cancelled: "отменён",
};

export default async function IdpsPage() {
  const actor = await getSessionEmployee();
  if (!actor) redirect("/login");
  const plans = listIdpsVisibleTo(actor);
  const people = listEmployeesVisibleTo(actor);
  const targets = jobsWithProfiles().map((job) => ({ id: job.id, name: job.name }));
  const creatable = people.filter((row) => canManageEmployee(actor, row.id) && !getActiveIdp(row.id));

  return (
    <div className="space-y-8">
      <div className="page-kicker">
        <span className="pulse-dot" />
        <h1 className="page-title">ИПР</h1>
      </div>
      {creatable.length > 0 && targets.length > 0 ? (
        <ActionForm action={createIdpAction} className="panel panel-pad flex flex-wrap items-end gap-3 text-sm">
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
          <label className="lbl">
            Начало
            <input className="field" type="date" name="periodStart" required />
          </label>
          <label className="lbl">
            Конец
            <input className="field" type="date" name="periodEnd" required />
          </label>
          <button className="btn-primary" type="submit">
            Создать
          </button>
        </ActionForm>
      ) : null}
      <ul className="panel">
        {plans.map((idp) => {
          const owner = getEmployee(idp.employeeId);
          const creator = getEmployee(idp.createdById);
          const source = getJob(idp.sourceJobId);
          const target = getJob(idp.targetJobId);
          const items = listIdpItems(idp.id);
          const accepted = items.filter((item) => item.acceptedAt != null).length;
          return (
            <li key={idp.id} className="list-row">
              <div>
                <a href={`/idps/${idp.id}`} className="link-accent font-medium">
                  {source?.name ?? idp.sourceJobId} → {target?.name ?? idp.targetJobId}
                </a>
                <div className="mt-1 text-xs muted">
                  {owner?.name ?? idp.employeeId}
                  {creator ? ` · создал ${creator.name}` : ""}
                  {idp.periodStart && idp.periodEnd ? ` · ${idp.periodStart} — ${idp.periodEnd}` : ""}
                  {idp.status === "active" ? ` · принято ${accepted} из ${items.length}` : ""}
                </div>
              </div>
              <span className="chip">{IDP_STATUS[idp.status] ?? idp.status}</span>
            </li>
          );
        })}
        {plans.length === 0 ? <li className="list-row muted">ИПР ещё нет</li> : null}
      </ul>
    </div>
  );
}
