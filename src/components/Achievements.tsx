import { AchievementIcon } from "@/components/skill-icons";
import { employeeAchievements } from "@/lib/achievements";

/**
 * Выданные достижения сотрудника (ADR 0010). Видит только сам сотрудник.
 * Заголовок, пояснение и блок подтверждённых компетенций ставит страница `/me/achievements`.
 */
export function Achievements({ employeeId }: { employeeId: string }) {
  const list = employeeAchievements(employeeId);
  if (list.length === 0) {
    return (
      <p className="muted" data-testid="achievements-empty">
        Пока ни одного достижения: примите строку ИПР — руководитель подтверждает задание в плане, и достижение
        появится здесь.
      </p>
    );
  }
  return (
    <ul className="panel" data-testid="achievements-list">
      {list.map((row) => (
        <li key={row.id} className="list-row">
          <span className="achievement-row__main">
            <AchievementIcon icon={row.icon} className="achievement-row__glyph" />
            {row.href ? (
              <a className="link-accent" href={row.href}>
                {row.title}
              </a>
            ) : (
              <span>{row.title}</span>
            )}
          </span>
          <span className="muted">{row.description}</span>
        </li>
      ))}
    </ul>
  );
}
