import { employeeAchievements } from "@/lib/achievements";

/** Достижения в кабинете: следствия текущих приёмок, своей таблицы нет (ADR 0006). Видит только сам сотрудник. */
export function Achievements({ employeeId }: { employeeId: string }) {
  const list = employeeAchievements(employeeId);
  if (list.length === 0) return null;
  return (
    <section className="space-y-3">
      <h2 className="section-title">Достижения</h2>
      <ul className="panel">
        {list.map((row) => (
          <li key={row.key} className="list-row">
            <span>{row.title}</span>
            {row.detail ? <span className="muted text-sm">{row.detail}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
