"use client";

import type { SkillNode } from "@/lib/skill-tree";

export type SkillNodeTier = "current" | "target" | "outside";

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

const TIER_LABEL: Record<SkillNodeTier, string> = {
  current: "Сейчас",
  target: "Цель активного ИПР",
  outside: "Вне профиля",
};

const LINK_KIND: Record<string, string> = {
  its: "ИТС",
  training: "Обучение",
  video: "Видео",
};

/** Планка уровня: у цели ниже текущей планки стрелка «было → стало», личного уровня нет. */
export function levelLabel(node: Pick<SkillNode, "level" | "wasLevel">): string {
  if (node.level == null) return "планка не задана";
  if (node.wasLevel != null) return `планка ${node.wasLevel} → ${node.level}`;
  return `планка ${node.level}`;
}

/** Панель узла: критерий профиля, материалы, личная пометка и строки активного плана. */
export function SkillNodePanel({
  node,
  tier,
  planId,
  onClose,
}: {
  node: SkillNode;
  tier: SkillNodeTier;
  planId: string | null;
  onClose: () => void;
}) {
  return (
    <aside className="skill-panel panel panel-pad space-y-4" data-testid="skill-node-panel" aria-label={`Узел: ${node.name}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="muted text-xs uppercase tracking-widest">{TIER_LABEL[tier]}</p>
          <h2 className="text-base font-semibold leading-snug">{node.name}</h2>
        </div>
        <button type="button" className="btn-quiet" onClick={onClose}>
          Закрыть
        </button>
      </div>

      <p className="text-sm" data-testid="skill-panel-level">
        {levelLabel(node)}
      </p>

      <section className="space-y-1">
        <h3 className="section-title mb-0">Критерий</h3>
        {node.criteria ? (
          <p className="skill-criteria" data-testid="skill-panel-criteria">
            {node.criteria}
          </p>
        ) : (
          <p className="muted text-sm">Критерий не заполнен.</p>
        )}
      </section>

      <section className="space-y-1">
        <h3 className="section-title mb-0">Пометка</h3>
        <p className="text-sm">
          <span data-testid="skill-panel-mark">{MARK_LABEL[node.mark] ?? node.mark}</span>
          {node.note ? <span className="muted"> · «{node.note}»</span> : null}
        </p>
        <a className="link-accent text-sm" href="/me/marks">
          Изменить пометку
        </a>
      </section>

      <section className="space-y-1">
        <h3 className="section-title mb-0">Материалы</h3>
        {node.materials.length === 0 ? (
          <p className="muted text-sm">Материалов нет.</p>
        ) : (
          <ul className="space-y-1 text-sm" aria-label="Материалы">
            {node.materials.map((link, index) => (
              <li key={`${link.kind}-${link.url}-${index}`} className="flex flex-wrap items-center gap-2">
                <span className="chip">{LINK_KIND[link.kind] ?? link.kind}</span>
                <a className="link-accent" href={link.url} target="_blank" rel="noopener noreferrer">
                  {link.title}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-1" data-testid="skill-panel-rows">
        <h3 className="section-title mb-0">Строки ИПР</h3>
        {node.rows.length === 0 ? (
          <p className="muted text-sm">В активном плане строк по этой компетенции нет.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {node.rows.map((row) => (
              <li key={row.id}>
                {planId ? (
                  <a className="link-accent" href={`/idps/${planId}#item-${row.id}`}>
                    {row.name}
                  </a>
                ) : (
                  <span>{row.name}</span>
                )}
                <span className="muted">
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
