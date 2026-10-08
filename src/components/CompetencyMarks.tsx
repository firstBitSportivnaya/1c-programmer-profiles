import { ActionForm } from "@/components/ActionForm";
import { setCompetencyMarkAction } from "@/app/people-actions";
import { listCompetencyMarks, markableCompetencies } from "@/lib/queries";

const SECTIONS = [
  { key: "technical", title: "Технические навыки" },
  { key: "personal", title: "Личные навыки" },
] as const;

/** Личные пометки навыков сотрудника (ADR 0007). Показывать только самому сотруднику в `/me`. */
export function CompetencyMarks({ employeeId, jobId }: { employeeId: string; jobId: string }) {
  const rows = markableCompetencies(employeeId, jobId);
  const marks = listCompetencyMarks(employeeId);
  return (
    <section className="space-y-3">
      <h2 className="section-title">Мои пометки</h2>
      <p className="muted text-sm">Видите только вы. На разрыв, ИПР и должность пометки не влияют.</p>
      {rows.length === 0 ? <p className="muted text-sm">У должности нет профиля с навыками.</p> : null}
      {SECTIONS.map((section) => {
        const items = rows.filter((row) => row.section === section.key);
        if (items.length === 0) return null;
        return (
          <div key={section.key} className="space-y-2">
            <h3 className="section-title mb-0">{section.title}</h3>
            <ul className="panel">
              {items.map((row) => (
                <li key={row.id} className="list-row text-sm">
                  <div>
                    {row.name}
                    {row.onlyInTarget ? <span className="chip ml-2">цель ИПР</span> : null}
                  </div>
                  <ActionForm action={setCompetencyMarkAction} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="competencyId" value={row.id} />
                    <select
                      className="field"
                      name="status"
                      aria-label={`Пометка: ${row.name}`}
                      defaultValue={marks.get(row.id) ?? ""}
                    >
                      <option value="">не отмечено</option>
                      <option value="has">есть</option>
                      <option value="lacks">нет</option>
                      <option value="in_progress">в процессе</option>
                    </select>
                    <button className="btn-quiet" type="submit">
                      Ок
                    </button>
                  </ActionForm>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
