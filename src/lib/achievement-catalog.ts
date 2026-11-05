/**
 * Словарь каталога достижений (ADR 0010). Общий для `npm run check:seed`, будущего заполнения
 * таблицы и админской формы: категории, правила и иконки — закрытые списки, а не свободный текст.
 */

export const ACHIEVEMENT_CATEGORIES = ["idp", "competency", "career", "mentoring", "contribution"] as const;

/**
 * Правила выдачи. `manual` — выдаёт человек; остальные проверяются по текущим данным и отзываются,
 * когда условие перестало выполняться. `job.assigned` требует `ruleParam` — id должности.
 */
export const ACHIEVEMENT_RULES = [
  "manual",
  "idp.first-accepted-item",
  "idp.items-3",
  "idp.items-10",
  "idp.competency-confirmed",
  "idp.pool-confirmed",
  "idp.completed",
  "idp.completed-2",
  "idp.on-time",
  "competency.confirmed-3",
  "competency.confirmed-5",
  "competency.confirmed-10",
  "competency.confirmed-20",
  "competency.half-profile",
  "competency.full-profile",
  "competency.outside-profile",
  "job.assigned",
  "manager.direct-1",
  "manager.direct-3",
  "manager.report-idp-completed",
  "manager.report-competency",
] as const;

/** Иконки каталога: имена глифов из `src/components/skill-icons.tsx`. */
export const ACHIEVEMENT_ICONS = [
  "flag",
  "checklist",
  "kanban",
  "award",
  "target",
  "file-check",
  "branch",
  "clock",
  "grid",
  "layers",
  "scale",
  "gauge",
  "shield-check",
  "compass",
  "code",
  "blocks",
  "users",
  "chat",
  "book",
  "send",
  "bug",
  "search",
  "ruler",
  "wrench",
] as const;

/** Ровно столько записей в каталоге. */
export const ACHIEVEMENT_CATALOG_SIZE = 30;

export type AchievementCategory = (typeof ACHIEVEMENT_CATEGORIES)[number];
export type AchievementRule = (typeof ACHIEVEMENT_RULES)[number];
export type AchievementIcon = (typeof ACHIEVEMENT_ICONS)[number];

export type AchievementRecord = {
  id: string;
  title: string;
  description: string;
  category: AchievementCategory;
  rule: AchievementRule;
  ruleParam: string | null;
  icon: AchievementIcon;
};

/** Правило, которому нужен параметр (сейчас единственное — назначенная должность). */
export function ruleNeedsParam(rule: AchievementRule): boolean {
  return rule === "job.assigned";
}
