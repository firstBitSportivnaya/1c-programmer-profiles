import { redirect } from "next/navigation";
import { AssignmentImportForm } from "@/components/AssignmentImportForm";
import { ListFilter } from "@/components/ListFilter";
import { getSessionEmployee } from "@/lib/auth";
import { canEditAssignmentCatalog } from "@/lib/invariants";
import { LEVEL_SORTS, matchesText, pickedSort, queryNeedle, sortRows } from "@/lib/list-query";
import { listCompetencies, listIdpAssignments } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AssignmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ competency?: string; q?: string; sort?: string }>;
}) {
  const actor = await getSessionEmployee();
  if (!actor) redirect("/login");
  if (!canEditAssignmentCatalog(actor)) redirect("/idps");
  const { competency = "", q = "", sort } = await searchParams;
  const order = pickedSort(sort, ["name", "name-desc", "level", "level-desc"]);
  const needle = queryNeedle(q);
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
  const visible = sortRows(
    items.filter((item) => (selected ? item.competencyId === selected : true) && matchesText(needle, item.name)),
    order,
    (item) => item.name,
    (item) => item.level,
  );

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
          <ListFilter
            action="/assignments"
            q={q}
            sort={order}
            sorts={LEVEL_SORTS}
            competency={{ value: selected, options: competencies }}
          />
          {visible.length === 0 ? (
            <p className="muted">Ничего не найдено</p>
          ) : (
            <ul className="panel">
              {visible.map((row) => (
                <li key={row.id} className="list-row">
                  <div>
                    <a href={`/assignments/${encodeURIComponent(row.id)}`} className="link-accent font-medium">
                      {row.name}
                    </a>
                    <div className="mt-1 muted caption">
                      {row.competencyName}
                      {row.level != null ? ` · ур. ${row.level}` : ""}
                    </div>
                  </div>
                  {row.archived ? <span className="chip">скрыто</span> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
