import { ActionForm } from "@/components/ActionForm";
import { AchievementIcon } from "@/components/skill-icons";
import { grantAchievementAction, revokeAchievementAction } from "@/app/people-actions";
import { employeeAchievements } from "@/lib/achievements";
import { listAchievements } from "@/lib/queries";

/**
 * Достижения сотрудника в его карточке (ADR 0010): действующие выдачи, форма ручной выдачи
 * из каталога без скрытых записей и отзыв с причиной. Отозванные строки в списке не видны —
 * они остаются в базе. Формы показываются только тем, кто может менять карточку: админу
 * и прямому руководителю; сам сотрудник видит список без действий.
 */
export function EmployeeAchievements({ employeeId, canManage }: { employeeId: string; canManage: boolean }) {
  const list = employeeAchievements(employeeId);
  const catalog = listAchievements().filter((row) => row.archived === 0);
  return (
    <section className="space-y-4" data-testid="employee-achievements">
      <h2 className="section-title">Достижения</h2>
      {list.length === 0 ? (
        <p className="muted" data-testid="employee-achievements-empty">
          Достижений нет: их выдаёт руководитель или админ, либо они появляются по условиям каталога.
        </p>
      ) : (
        <ul className="panel" data-testid="employee-achievements-list">
          {list.map((row) => (
            <li key={row.id} className="list-row achievement-row" data-testid={`employee-achievement-${row.id}`}>
              <span className="achievement-row__main">
                <AchievementIcon icon={row.icon} className="achievement-row__glyph" />
                <span>{row.title}</span>
              </span>
              <span className="muted">{row.description}</span>
              {canManage ? (
                <ActionForm action={revokeAchievementAction} className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="employeeId" value={employeeId} />
                  <input type="hidden" name="achievementId" value={row.id} />
                  <label className="lbl">
                    Причина
                    <input className="field" name="reason" />
                  </label>
                  <button className="btn-danger" type="submit">
                    Отозвать
                  </button>
                </ActionForm>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canManage ? (
        <ActionForm action={grantAchievementAction} className="panel panel-pad flex flex-wrap items-end gap-3">
          <input type="hidden" name="employeeId" value={employeeId} />
          <label className="lbl">
            Выдать достижение
            <select className="field" name="achievementId" defaultValue="">
              <option value="">не выбрано</option>
              {catalog.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.title}
                </option>
              ))}
            </select>
          </label>
          <button className="btn-primary" type="submit">
            Выдать
          </button>
        </ActionForm>
      ) : null}
    </section>
  );
}
