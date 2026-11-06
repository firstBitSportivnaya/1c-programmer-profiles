"use client";

import { useState } from "react";
import {
  ACHIEVEMENT_CATEGORIES,
  ACHIEVEMENT_CATEGORY_LABELS,
  ACHIEVEMENT_ICON_LABELS,
  ACHIEVEMENT_ICONS,
  ACHIEVEMENT_RULE_LABELS,
  ACHIEVEMENT_RULES,
  ruleNeedsParam,
  type AchievementRule,
} from "@/lib/achievement-catalog";

type AchievementDraft = {
  id: string;
  title: string;
  description: string;
  category: string;
  rule: string;
  ruleParam: string | null;
  icon: string;
};

/**
 * Поля записи каталога достижений (ADR 0010). Без `achievement` — форма создания, ключ вводит админ;
 * при правке ключ приходит скрытым и не меняется. Поле должности показывается только правилу
 * `job.assigned`: у остальных правил параметра нет, и лишний выбор в форму не попадает.
 */
export function AchievementFields({
  achievement,
  jobs,
}: {
  achievement?: AchievementDraft;
  jobs: { id: string; name: string }[];
}) {
  const [rule, setRule] = useState(achievement?.rule ?? "manual");
  return (
    <>
      {achievement ? (
        <input type="hidden" name="id" value={achievement.id} />
      ) : (
        <label className="lbl">
          Ключ
          <input name="id" placeholder="латиница, цифры, дефис" className="field" required />
        </label>
      )}
      <label className="lbl">
        Название
        <input name="title" defaultValue={achievement?.title ?? ""} className="field" required />
      </label>
      <label className="lbl md:col-span-2">
        Описание
        <textarea name="description" defaultValue={achievement?.description ?? ""} className="field" required />
      </label>
      <label className="lbl">
        Категория
        <select name="category" defaultValue={achievement?.category ?? "idp"} className="field">
          {ACHIEVEMENT_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {ACHIEVEMENT_CATEGORY_LABELS[category]}
            </option>
          ))}
        </select>
      </label>
      <label className="lbl">
        Правило
        <select
          name="rule"
          defaultValue={achievement?.rule ?? "manual"}
          onChange={(event) => setRule(event.target.value)}
          className="field"
        >
          {ACHIEVEMENT_RULES.map((item) => (
            <option key={item} value={item}>
              {ACHIEVEMENT_RULE_LABELS[item]}
            </option>
          ))}
        </select>
      </label>
      {ruleNeedsParam(rule as AchievementRule) ? (
        <label className="lbl">
          Должность
          <select name="ruleParam" defaultValue={achievement?.ruleParam ?? ""} className="field">
            <option value="">выберите должность</option>
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="lbl">
        Иконка
        <select name="icon" defaultValue={achievement?.icon ?? "flag"} className="field">
          {ACHIEVEMENT_ICONS.map((icon) => (
            <option key={icon} value={icon}>
              {ACHIEVEMENT_ICON_LABELS[icon]}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
