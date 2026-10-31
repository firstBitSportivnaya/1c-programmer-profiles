"use client";

import type { SkillTreeNode } from "@/lib/skill-tree";

const MARK_LABEL: Record<string, string> = {
  has: "есть",
  in_progress: "в процессе",
  lacks: "нет",
  "": "не отмечено",
};

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

/** Планка уровня: требование должности и цель активного ИПР, личного уровня нет (ADR 0001, 0007). */
export function levelLabel(node: Pick<SkillTreeNode, "currentLevel" | "targetLevel">): string {
  const { currentLevel, targetLevel } = node;
  if (currentLevel == null && targetLevel == null) return "планка не задана";
  if (currentLevel == null) return `планка цели ${targetLevel}`;
  if (targetLevel == null || targetLevel === currentLevel) return `планка ${currentLevel}`;
  return `планка ${currentLevel} → ${targetLevel}`;
}

/**
 * Карточка узла поверх холста: критерий профиля, материалы, личная пометка и строки активного плана.
 * Размеров шрифта три: заголовок, текст и подпись; иерархия — весом и регистром.
 */
export function SkillNodePanel({
  node,
  context,
  planId,
  onClose,
}: {
  node: SkillTreeNode;
  context: string;
  planId: string | null;
  onClose: () => void;
}) {
  return (
    <aside className="skill-card" role="dialog" aria-label={`Узел: ${node.name}`} data-testid="skill-node-panel">
      <div className="skill-card__head">
        <div>
          <p className="skill-card__label">{context}</p>
          <h2 className="skill-card__title">{node.name}</h2>
        </div>
        <button type="button" className="skill-card__close" onClick={onClose}>
          Закрыть
        </button>
      </div>

      <p className="skill-card__text" data-testid="skill-panel-level">
        {levelLabel(node)}
      </p>

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

      <section>
        <h3 className="skill-card__label">Пометка</h3>
        <p className="skill-card__text">
          <span data-testid="skill-panel-mark">{MARK_LABEL[node.mark] ?? node.mark}</span>
          {node.note ? <span className="skill-card__note"> · «{node.note}»</span> : null}
        </p>
        <a className="link-accent skill-card__link" href="/me/marks">
          Изменить пометку
        </a>
      </section>

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
