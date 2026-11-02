import { redirect } from "next/navigation";
import { competencyTypeChip, competencyTypeLabel } from "@/components/CompetencyFields";
import { MaterialImportForm } from "@/components/MaterialImportForm";
import { isAdmin } from "@/lib/auth";
import { listCompetencies } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SECTIONS = [
  { type: "professional", title: "Компетенции" },
  { type: "universal", title: "Личные" },
  { type: "duty", title: "Обязанности" },
] as const;

export default async function CompetenciesPage() {
  if (!(await isAdmin())) redirect("/admin/login");
  const items = listCompetencies();
  const nameById = new Map(items.map((item) => [item.id, item.name]));
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
      {SECTIONS.map((section) => {
        const rows = items.filter((item) => item.type === section.type);
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
                        <div className="mt-1 muted">родитель: {nameById.get(item.parentId) ?? item.parentId}</div>
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
