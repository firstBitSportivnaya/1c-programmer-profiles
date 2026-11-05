import { redirect } from "next/navigation";
import { Achievements } from "@/components/Achievements";
import { syncEmployeeAchievements } from "@/lib/achievement-rules";
import { confirmedCompetencies } from "@/lib/achievements";
import { getSessionEmployee } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Достижения сотрудника — единственное место, где виден весь список. Страница только своя:
 * адреса с id сотрудника нет, чужие достижения по ссылке не открыть.
 *
 * Перед показом сверяются автоматические правила (ADR 0010): условие выполнено — выдача появилась,
 * перестало выполняться — строка осталась в базе с датой отзыва и из списка ушла.
 */
export default async function MyAchievementsPage() {
  const employee = await getSessionEmployee();
  if (!employee) redirect("/login");
  syncEmployeeAchievements(employee.id);
  const confirmed = confirmedCompetencies(employee.id);
  return (
    <article className="space-y-6">
      <div className="page-kicker">
        <a href="/me" className="link-accent">
          Кабинет
        </a>
        <h1 className="page-title">Достижения</h1>
      </div>
      <p className="muted">
        Достижение выдаётся каталогом по условию или человеком, очков нет: пропало условие — автоматическое достижение
        уходит из списка, но дата отзыва остаётся в базе.
      </p>
      <Achievements employeeId={employee.id} />
      <section className="space-y-3" data-testid="confirmed-competencies">
        <h2 className="section-title">Подтверждённые компетенции</h2>
        {confirmed.length === 0 ? (
          <p className="muted" data-testid="confirmed-empty">
            Подтверждённых компетенций нет: компетенция подтверждается, когда все строки плана по ней приняты.
          </p>
        ) : (
          <ul className="panel">
            {confirmed.map((row) => (
              <li key={row.competencyId} className="list-row">
                {row.name}
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}
