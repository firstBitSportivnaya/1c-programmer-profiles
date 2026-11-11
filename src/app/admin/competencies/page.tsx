import { redirect } from "next/navigation";
import { competencyTypeChip, competencyTypeLabel } from "@/components/CompetencyFields";
import { ListFilter } from "@/components/ListFilter";
import { MaterialImportForm } from "@/components/MaterialImportForm";
import { isAdmin } from "@/lib/auth";
import { matchesText, NAME_SORTS, pickedSort, queryNeedle, sortRows } from "@/lib/list-query";
import { listCompetencies } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SECTIONS = [
  { type: "professional", title: "Компетенции" },
  { type: "universal", title: "Личные" },
  { type: "duty", title: "Обязанности" },
] as const;

export default async function CompetenciesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sort?: string }>;
}) {
  if (!(await isAdmin())) redirect("/admin/login");
  const { q = "", sort } = await searchParams;
  const order = pickedSort(sort, ["name", "name-desc"]);
  const needle = queryNeedle(q);
  const items = listCompetencies();
  const nameById = new Map(items.map((item) => [item.id, item.name]));
  const matched = sortRows(
    items.filter((item) => matchesText(needle, item.name)),
    order,
    (item) => item.name,
  );
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="page-kicker">
          <span className="pulse-dot" />
          <h1 className="page-title">Компетенции</h1>
        </div>
        <a href="/admin/competencies/new" className="btn-primary">
          Новая компетенция
        </a>
      </div>
      <MaterialImportForm />
      <ListFilter action="/admin/competencies" q={q} sort={order} sorts={NAME_SORTS} />
      {needle && matched.length === 0 ? <p className="muted">Ничего не найдено</p> : null}
      {SECTIONS.map((section) => {
        const rows = matched.filter((item) => item.type === section.type);
        if (needle && rows.length === 0) return null;
        return (
          <section key={section.type} className="space-y-2" aria-labelledby={`competency-group-${section.type}`}>
            <h2 id={`competency-group-${section.type}`} className="section-title mb-0">
              {section.title}
            </h2>
            {rows.length === 0 ? (
              <p className="muted">Нет записей</p>
            ) : (
              <ul className="panel">
                {rows.map((item) => (
                  <li key={item.id} className="list-row">
                    <div>
                      <a href={`/admin/competencies/${encodeURIComponent(item.id)}`} className="link-accent font-medium">
                        {item.name}
                      </a>
                      {item.parentId ? (
                        <div className="mt-1 muted caption">родитель: {nameById.get(item.parentId) ?? item.parentId}</div>
                      ) : null}
                    </div>
                    <span className={competencyTypeChip(item.type)}>{competencyTypeLabel(item.type)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
