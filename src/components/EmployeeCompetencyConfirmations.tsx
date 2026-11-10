import { ActionForm } from "@/components/ActionForm";
import {
  confirmCompetencyAction,
  revokeCompetencyConfirmationAction,
} from "@/app/people-actions";
import { formatUnixDate } from "@/lib/dates";
import { listCompetencyConfirmations, listSkillCompetencies } from "@/lib/queries";

/**
 * Ручные подтверждения компетенций в карточке сотрудника (ADR 0011): действующие строки с датой,
 * автором и основанием, форма подтверждения навыка и отзыв с причиной. Отозванные строки в списке
 * не видны — они остаются в базе. Формы показываются только тем, кто может менять карточку:
 * админу и прямому руководителю; сам сотрудник и гость видят список без действий.
 */
export function EmployeeCompetencyConfirmations({
  employeeId,
  canManage,
}: {
  employeeId: string;
  canManage: boolean;
}) {
  const list = listCompetencyConfirmations(employeeId);
  const skills = listSkillCompetencies();
  return (
    <section className="space-y-4" data-testid="employee-confirmations">
      <h2 className="section-title">Компетенции</h2>
      {/* Дерево — часть группы «Компетенции»: заметная строка-ссылка, чтобы не искать действие
          в плоском списке навыков. Подтверждение ставится прямо в узле дерева. */}
      <a
        className="panel panel-pad employee-skills-link"
        href={`/people/${employeeId}/skills`}
        data-testid="employee-skills-link"
      >
        <span className="employee-skills-link__main">
          <span className="employee-skills-link__title">Дерево навыков</span>
          <span className="muted">Профиль должности, цель ИПР и подтверждение — в узлах</span>
        </span>
        <span className="employee-skills-link__arrow" aria-hidden="true">
          →
        </span>
      </a>
      {list.length === 0 ? (
        <p className="muted" data-testid="employee-confirmations-empty">
          Ручных подтверждений нет: компетенцию подтверждает руководитель или админ, либо её подтверждает
          приёмка строки ИПР.
        </p>
      ) : (
        <ul className="panel" data-testid="employee-confirmations-list">
          {list.map((row) => (
            <li
              key={row.competencyId}
              className="list-row"
              data-testid={`employee-confirmation-${row.competencyId}`}
            >
              <span>{row.competencyName}</span>
              <span className="muted">
                {formatUnixDate(row.confirmedAt)} · {row.confirmedByName}
              </span>
              <span className="muted">{row.note}</span>
              {canManage ? (
                <ActionForm
                  action={revokeCompetencyConfirmationAction}
                  className="flex flex-wrap items-end gap-3"
                >
                  <input type="hidden" name="employeeId" value={employeeId} />
                  <input type="hidden" name="competencyId" value={row.competencyId} />
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
        <ActionForm
          action={confirmCompetencyAction}
          className="panel panel-pad flex flex-wrap items-end gap-3"
        >
          <input type="hidden" name="employeeId" value={employeeId} />
          <label className="lbl">
            Навык
            <select className="field" name="competencyId" defaultValue="">
              <option value="">не выбрано</option>
              {skills.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
          <label className="lbl">
            Основание
            <input className="field" name="note" maxLength={1000} />
          </label>
          <button className="btn-primary" type="submit">
            Подтвердить
          </button>
        </ActionForm>
      ) : null}
    </section>
  );
}
