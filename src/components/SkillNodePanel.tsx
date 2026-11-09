"use client";

import { SkillMarkForm } from "@/components/SkillMarkForm";
import { ActionForm } from "@/components/ActionForm";
import { confirmCompetencyAction, revokeCompetencyConfirmationAction } from "@/app/people-actions";
import type { SkillConfirmationView } from "@/lib/skill-tree-snapshot";
import type { SkillTreeNode } from "@/lib/skill-tree";

const ITEM_STATUS: Record<string, string> = {
  not_started: "не начат",
  in_progress: "в работе",
  done: "сделал",
};

const LINK_KIND: Record<string, string> = {
  its: "ИТС",
  training: "Обучение",
  video: "Видео",
};

/**
 * Режим просмотра чужого сотрудника (issue #133, ADR 0007, 0011): блока пометки нет вовсе,
 * зато есть подтверждение — с источником, основанием и, у того, кто может менять карточку,
 * формами подтверждения и отзыва. Права всё равно проверяет серверное действие.
 */
export type SkillConfirmationReview = {
  employeeId: string;
  canManage: boolean;
  /** Действующее подтверждение навыка: приёмка ИПР, ручная запись или оба источника. */
  confirmation: SkillConfirmationView | null;
};

/** Строка действующего подтверждения: приёмка ИПР со ссылкой на план или ручная запись. */
function ConfirmationState({ confirmation }: { confirmation: SkillConfirmationView }) {
  const manual = confirmation.manual;
  return (
    <ul className="skill-card__list" data-testid="skill-panel-confirmation-state">
      {confirmation.planId ? (
        <li>
          Приёмкой ИПР:{" "}
          <a className="link-accent" href={`/idps/${confirmation.planId}`}>
            план
          </a>
        </li>
      ) : null}
      {manual ? (
        <li>
          Вручную: {manual.confirmedOn} · {manual.confirmedByName}
          <span className="skill-card__note"> · {manual.note}</span>
        </li>
      ) : null}
    </ul>
  );
}

/**
 * Название уровня из профиля должности: в справочнике он записан числом 1–3.
 * Уровни не выводятся из грейда, поэтому у неизвестного числа остаётся само число.
 */
export function levelName(level: number): string {
  if (level === 1) return "базовый";
  if (level === 2) return "уверенный";
  if (level === 3) return "эксперт";
  return `уровень ${level}`;
}

/**
 * Требование к навыку словами: что нужно текущей должности и что — цели активного ИПР.
 * Внутренний термин «планка» в интерфейс не выносим (ADR 0001, 0007), личного уровня нет.
 */
export function levelLabel(node: Pick<SkillTreeNode, "currentLevel" | "targetLevel">): string {
  const { currentLevel, targetLevel } = node;
  if (currentLevel == null && targetLevel == null) return "Уровень не задан ни в должности, ни в цели ИПР";
  if (currentLevel == null) return `Цель ИПР: ${levelName(targetLevel!)} уровень`;
  if (targetLevel == null || targetLevel === currentLevel) {
    return `Должность и цель: ${levelName(currentLevel)} уровень`;
  }
  return `Должность: ${levelName(currentLevel)} уровень, цель ИПР — ${levelName(targetLevel)}`;
}

/** То же короче: место в узкой карточке дерева. */
export function levelShort(node: Pick<SkillTreeNode, "currentLevel" | "targetLevel">): string {
  const { currentLevel, targetLevel } = node;
  if (currentLevel == null && targetLevel == null) return "уровень не задан";
  if (currentLevel == null) return `цель: ${levelName(targetLevel!)}`;
  if (targetLevel == null || targetLevel === currentLevel) return `${levelName(currentLevel)} уровень`;
  return `${levelName(currentLevel)} → цель: ${levelName(targetLevel)}`;
}

/**
 * Карточка узла в панели справа: критерий профиля, предпосылка, материалы, личная пометка и строки плана.
 * В режиме просмотра чужого сотрудника вместо пометки стоит подтверждение (ADR 0007, 0011).
 * Размеров шрифта три: заголовок, текст и подпись; иерархия — весом и регистром.
 */
export function SkillNodePanel({
  node,
  context,
  planId,
  prerequisite,
  onOpenPrerequisite,
  review,
  onClose,
}: {
  node: SkillTreeNode;
  context: string;
  planId: string | null;
  /** Ближайшая предпосылка: соседний навык, который открывает этот. */
  prerequisite: { id: string; name: string } | null;
  onOpenPrerequisite: (id: string) => void;
  /** `null` — свой кабинет: панель показывает личную пометку, подтверждения в ней нет. */
  review: SkillConfirmationReview | null;
  onClose: () => void;
}) {
  return (
    <aside className="skill-card" role="dialog" aria-label={`Узел: ${node.name}`} data-testid="skill-node-panel">
      <div className="skill-card__head">
        <div>
          <p className="skill-card__label">{context}</p>
          <h2 className="skill-card__title">{node.name}</h2>
        </div>
        <button type="button" className="skill-card__close" onClick={onClose} aria-label="Закрыть">
          Закрыть
        </button>
      </div>

      <p className="skill-card__text" data-testid="skill-panel-level">
        {levelLabel(node)}
      </p>

      <section>
        <h3 className="skill-card__label">Требуется</h3>
        {prerequisite ? (
          <p className="skill-card__text" data-testid="skill-panel-prerequisite">
            {/* Ссылка ведёт на узел предпосылки: адрес остаётся обычным <a href>, переход перехватывает панель. */}
            <a
              className="link-accent"
              href={`#skill-node-${prerequisite.id}`}
              data-testid="skill-panel-prerequisite-link"
              onClick={(event) => {
                event.preventDefault();
                onOpenPrerequisite(prerequisite.id);
              }}
            >
              {prerequisite.name}
            </a>
          </p>
        ) : (
          <p className="skill-card__note">Предпосылки нет: это начало ветви.</p>
        )}
      </section>

      <section>
        <h3 className="skill-card__label">Критерий</h3>
        {node.criteria ? (
          <p className="skill-card__text" data-testid="skill-panel-criteria">
            {node.criteria}
          </p>
        ) : (
          <p className="skill-card__note">Критерий не заполнен.</p>
        )}
      </section>

      {review ? (
        <section data-testid="skill-panel-confirmation">
          <h3 className="skill-card__label">Подтверждение</h3>
          {node.confirmed && review.confirmation ? (
            <ConfirmationState confirmation={review.confirmation} />
          ) : (
            <p className="skill-card__note" data-testid="skill-panel-not-confirmed">
              Компетенция не подтверждена: её подтверждает приёмка строки ИПР или руководитель либо админ.
            </p>
          )}
          {review.canManage ? (
            review.confirmation?.manual ? (
              // Снять можно только ручную запись: подтверждение приёмкой ИПР снимается отменой приёмки.
              <ActionForm action={revokeCompetencyConfirmationAction} className="skill-card__form">
                <input type="hidden" name="employeeId" value={review.employeeId} />
                <input type="hidden" name="competencyId" value={node.id} />
                <label className="lbl">
                  Причина
                  <input className="field" name="reason" maxLength={1000} />
                </label>
                <button className="btn-danger" type="submit">
                  Снять
                </button>
              </ActionForm>
            ) : (
              /*
                Ручное основание пишется и поверх приёмки ИПР: иначе после отмены приёмки навык
                остаётся без подтверждения, а записать основание можно было бы только в карточке.
              */
              <>
                {node.confirmed ? (
                  <p className="skill-card__note" data-testid="skill-panel-confirmed-by-idp">
                    Подтверждено приёмкой ИПР: снимается отменой приёмки в плане.
                  </p>
                ) : null}
                <ActionForm action={confirmCompetencyAction} className="skill-card__form">
                  <input type="hidden" name="employeeId" value={review.employeeId} />
                  <input type="hidden" name="competencyId" value={node.id} />
                  <label className="lbl">
                    Основание
                    <input className="field" name="note" maxLength={1000} />
                  </label>
                  <button className="btn-primary" type="submit">
                    Подтвердить
                  </button>
                </ActionForm>
              </>
            )
          ) : null}
        </section>
      ) : (
        <section>
          <h3 className="skill-card__label">Пометка</h3>
          <SkillMarkForm key={node.id} competencyId={node.id} name={node.name} status={node.mark} note={node.note} />
          <a className="link-accent skill-card__link" href="/me/marks">
            Все пометки по компетенциям
          </a>
        </section>
      )}

      <section>
        <h3 className="skill-card__label">Материалы</h3>
        {node.materials.length === 0 ? (
          <p className="skill-card__note">Материалов нет.</p>
        ) : (
          <ul className="skill-card__list" aria-label="Материалы">
            {node.materials.map((link, index) => (
              <li key={`${link.kind}-${link.url}-${index}`}>
                <span className="skill-card__tag">{LINK_KIND[link.kind] ?? link.kind}</span>
                <a className="link-accent" href={link.url} target="_blank" rel="noopener noreferrer">
                  {link.title}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section data-testid="skill-panel-rows">
        <h3 className="skill-card__label">Строки ИПР</h3>
        {node.rows.length === 0 ? (
          <p className="skill-card__note">В активном плане строк по этой компетенции нет.</p>
        ) : (
          <ul className="skill-card__list">
            {node.rows.map((row) => (
              <li key={row.id}>
                {planId ? (
                  <a className="link-accent" href={`/idps/${planId}#item-${row.id}`}>
                    {row.name}
                  </a>
                ) : (
                  <span>{row.name}</span>
                )}
                <span className="skill-card__note">
                  {" · "}
                  {ITEM_STATUS[row.status] ?? row.status}
                  {row.accepted ? " · принято" : ""}
                  {row.dueOn ? ` · до ${row.dueOn}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}
