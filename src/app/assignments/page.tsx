import { redirect } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { archiveAssignmentAction, saveAssignmentAction } from "@/app/idp-actions";
import { getSessionEmployee } from "@/lib/auth";
import { canEditAssignmentCatalog } from "@/lib/invariants";
import { assignmentCompetencies, getCompetency, listIdpAssignments } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AssignmentsPage() {
  const actor = await getSessionEmployee();
  if (!actor) redirect("/login");
  if (!canEditAssignmentCatalog(actor)) redirect("/idps");
  const competencies = assignmentCompetencies();
  const items = listIdpAssignments();

  return (
    <div className="space-y-6">
      <div className="page-kicker">
        <span className="pulse-dot" />
        <h1 className="page-title">Задания ИПР</h1>
      </div>
      <ActionForm action={saveAssignmentAction} className="panel panel-pad grid gap-3 text-sm md:grid-cols-2">
        <label className="lbl">
          Компетенция
          <select className="field" name="competencyId" required>
            {competencies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="lbl">
          Название
          <input className="field" name="name" required />
        </label>
        <label className="lbl">
          Узнать
          <textarea className="field" name="learnText" rows={4} required />
        </label>
        <label className="lbl">
          Проверить
          <textarea className="field" name="verifyText" rows={4} required />
        </label>
        <button className="btn-primary w-fit" type="submit">
          Добавить
        </button>
      </ActionForm>
      <ul className="space-y-2 text-sm">
        {items.map((row) => {
          const competency = getCompetency(row.competencyId);
          return (
            <li key={row.id} className="panel panel-pad space-y-3">
              <div className="flex flex-wrap items-center gap-2 font-medium">
                {row.name}
                <span className="chip">{competency?.name ?? row.competencyId}</span>
                {row.archived === 1 ? <span className="chip">скрыто</span> : null}
              </div>
              {row.archived === 0 ? (
                <ActionForm action={saveAssignmentAction} className="grid gap-2 md:grid-cols-2">
                  <input type="hidden" name="id" value={row.id} />
                  <input type="hidden" name="competencyId" value={row.competencyId} />
                  <label className="lbl md:col-span-2">
                    Название
                    <input className="field" name="name" defaultValue={row.name} />
                  </label>
                  <label className="lbl">
                    Узнать
                    <textarea className="field" name="learnText" rows={3} defaultValue={row.learnText} />
                  </label>
                  <label className="lbl">
                    Проверить
                    <textarea className="field" name="verifyText" rows={3} defaultValue={row.verifyText} />
                  </label>
                  <button className="btn w-fit" type="submit">
                    Сохранить
                  </button>
                </ActionForm>
              ) : null}
              <ActionForm action={archiveAssignmentAction}>
                <input type="hidden" name="id" value={row.id} />
                <button className={row.archived === 1 ? "btn" : "btn-quiet"} type="submit">
                  {row.archived === 1 ? "Вернуть" : "Скрыть"}
                </button>
              </ActionForm>
            </li>
          );
        })}
        {items.length === 0 ? <li className="muted">Заданий ещё нет</li> : null}
      </ul>
    </div>
  );
}
