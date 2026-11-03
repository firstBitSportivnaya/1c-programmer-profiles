import { AchievementIcon } from "@/components/skill-icons";
import { employeeAchievements } from "@/lib/achievements";

/**
 * Достижения: следствия текущих приёмок, своей таблицы нет (ADR 0006). Видит только сам сотрудник.
 * Заголовок и пояснение ставит страница `/me/achievements` — здесь только список или пустое состояние.
 */
export function Achievements({ employeeId }: { employeeId: string }) {
  const list = employeeAchievements(employeeId);
  if (list.length === 0) {
    return (
      <p className="muted" data-testid="achievements-empty">
        Пока ни одной ачивки: примите строку ИПР — руководитель подтверждает задание в плане, и достижение появится
        здесь.
      </p>
    );
  }
  return (
    <ul className="panel" data-testid="achievements-list">
      {list.map((row) => (
        <li key={row.key} className="list-row">
          <span className="achievement-row__main">
            <AchievementIcon achievementKey={row.key} className="achievement-row__glyph" />
            {row.href ? (
              // Имя компетенции рядом — отдельным текстом, поэтому в доступное имя ссылки его добавляем сами:
              // иначе несколько ссылок «Компетенция подтверждена» звучат для диктора одинаково.
              <a
                className="link-accent"
                href={row.href}
                aria-label={row.detail ? `${row.title}: ${row.detail}` : undefined}
              >
                {row.title}
              </a>
            ) : (
              <span>{row.title}</span>
            )}
          </span>
          {row.detail ? <span className="muted">{row.detail}</span> : null}
        </li>
      ))}
    </ul>
  );
}
