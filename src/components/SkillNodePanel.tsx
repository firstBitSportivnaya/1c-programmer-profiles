"use client";

import { SkillMarkForm } from "@/components/SkillMarkForm";
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
        <SkillMarkForm key={node.id} competencyId={node.id} name={node.name} status={node.mark} note={node.note} />
        <a className="link-accent skill-card__link" href="/me/marks">
          Все пометки по компетенциям
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
