import { redirect } from "next/navigation";
import { AssignmentImportForm } from "@/components/AssignmentImportForm";
import { getSessionEmployee } from "@/lib/auth";
import { canEditAssignmentCatalog } from "@/lib/invariants";
import { listCompetencies, listIdpAssignments } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AssignmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ competency?: string }>;
}) {
  const actor = await getSessionEmployee();
  if (!actor) redirect("/login");
  if (!canEditAssignmentCatalog(actor)) redirect("/idps");
  const { competency = "" } = await searchParams;
  const names = new Map(listCompetencies().map((item) => [item.id, item.name]));
  const items = listIdpAssignments().map((row) => ({
    id: row.id,
    name: row.name,
    competencyId: row.competencyId,
    competencyName: names.get(row.competencyId) ?? row.competencyId,
    level: row.level,
    archived: row.archived === 1,
  }));
  const competencies = [...new Map(items.map((item) => [item.competencyId, item.competencyName])).entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const selected = competencies.some((item) => item.id === competency) ? competency : "";
  const visible = selected ? items.filter((item) => item.competencyId === selected) : items;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="page-kicker">
          <span className="pulse-dot" />
          <h1 className="page-title">Задания ИПР</h1>
        </div>
        <a href="/assignments/new" className="btn-primary">
          Новое задание
        </a>
      </div>
      {actor.isAdmin ? <AssignmentImportForm /> : null}
      {items.length === 0 ? (
        <ul className="panel">
          <li className="list-row muted">Заданий ещё нет</li>
        </ul>
      ) : (
        <div className="space-y-4">
          <form action="/assignments" className="flex flex-wrap items-end gap-3">
            <label className="lbl">
              Компетенция
              <select className="field" name="competency" aria-label="Фильтр компетенции" defaultValue={selected}>
                <option value="">все</option>
                {competencies.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn" type="submit">
              Показать
            </button>
          </form>
          {visible.length === 0 ? <p className="muted text-sm">Ничего не найдено.</p> : null}
          <ul className="panel">
            {visible.map((row) => (
              <li key={row.id} className="list-row">
                <div>
                  <a href={`/assignments/${encodeURIComponent(row.id)}`} className="link-accent font-medium">
                    {row.name}
                  </a>
                  <div className="mt-1 text-xs muted">
                    {row.competencyName}
                    {row.level != null ? ` · ур. ${row.level}` : ""}
                  </div>
                </div>
                {row.archived ? <span className="chip">скрыто</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
