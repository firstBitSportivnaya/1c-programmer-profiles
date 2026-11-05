/**
 * Достижения сотрудника (ADR 0010): выдачи из таблицы и снимок приёмок, по которому видны
 * подтверждённые компетенции. Сами достижения здесь не считаются: их выдаёт `achievement-rules.ts`,
 * а страница только читает результат. Подтверждённые компетенции — отдельный блок: в каталог
 * и в таблицу выдач они не попадают (ADR 0006).
 */
import { asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import {
  achievements,
  employeeAchievements as employeeAchievementRows,
  idpItems,
  idpPool,
  idps,
} from "@/db/schema";
import type { AchievementCategory, AchievementIcon } from "@/lib/achievement-catalog";
import { ensureSchema, getCompetency, getIdp } from "@/lib/queries";

/** Строка плана для правил: приёмка и срок нужны для условий, название — для блока компетенций. */
export type PlanItemFacts = {
  id: number;
  competencyId: string;
  competencyName: string;
  acceptedAt: number | null;
  dueOn: string | null;
};

/** План сотрудника целиком: статус, пул и строки. Отменённый план условия не даёт. */
export type PlanFacts = {
  id: string;
  status: "active" | "completed" | "cancelled";
  updatedAt: number;
  pool: { competencyId: string; competencyName: string }[];
  items: PlanItemFacts[];
};

/** Принятая строка: из неё берётся ссылка достижений «первая строка» и порогов по числу строк. */
export type AcceptedItem = { planId: string; itemId: number; acceptedAt: number };

/** Подтверждённая компетенция: все строки плана по ней приняты, поэтому она видна отдельным блоком. */
export type ConfirmedCompetency = {
  competencyId: string;
  name: string;
  /** План, приёмка в котором подтвердила компетенцию: из него берётся ссылка достижения. */
  planId: string;
  acceptedAt: number;
};

export type EmployeeAchievement = {
  /** Ключ каталога: он же ключ строки и ключ пиктограммы. */
  id: string;
  title: string;
  description: string;
  category: AchievementCategory;
  icon: AchievementIcon;
  grantedAt: number;
  /** План, из-за которого выдано; `null` — у достижения плана нет (должность, наставничество, рука человека). */
  sourceRef: string | null;
  /** Адрес цели; `null` — плана нет или он удалён, строка остаётся текстом без битой ссылки. */
  href: string | null;
};

/** Все планы сотрудника с пулом и строками: один снимок данных для всех правил сотрудника. */
export function loadPlans(employeeId: string): PlanFacts[] {
  ensureSchema();
  const db = getDb();
  const plans = db.select().from(idps).where(eq(idps.employeeId, employeeId)).all();
  if (plans.length === 0) return [];
  const ids = plans.map((plan) => plan.id);
  const items = db.select().from(idpItems).where(inArray(idpItems.idpId, ids)).all();
  const pool = db.select().from(idpPool).where(inArray(idpPool.idpId, ids)).all();
  return plans.map((plan) => ({
    id: plan.id,
    status: plan.status,
    updatedAt: plan.updatedAt,
    pool: pool.filter((row) => row.idpId === plan.id),
    items: items
      .filter((row) => row.idpId === plan.id)
      .map((row) => ({
        id: row.id,
        competencyId: row.competencyId,
        competencyName: row.competencyName,
        acceptedAt: row.acceptedAt,
        dueOn: row.dueOn,
      })),
  }));
}

/** Компетенции плана с подтверждением: все её строки приняты и хотя бы одна строка есть (ADR 0006). */
export function planConfirmed(plan: PlanFacts): Map<string, { name: string; acceptedAt: number }> {
  const groups = new Map<string, { name: string; total: number; accepted: number; acceptedAt: number }>();
  for (const item of plan.items) {
    const group = groups.get(item.competencyId) ?? {
      name: item.competencyName,
      total: 0,
      accepted: 0,
      acceptedAt: 0,
    };
    group.total += 1;
    if (item.acceptedAt != null) {
      group.accepted += 1;
      group.acceptedAt = Math.max(group.acceptedAt, item.acceptedAt);
    }
    groups.set(item.competencyId, group);
  }
  const confirmed = new Map<string, { name: string; acceptedAt: number }>();
  for (const [competencyId, group] of groups) {
    if (group.total > 0 && group.accepted === group.total) {
      confirmed.set(competencyId, { name: group.name, acceptedAt: group.acceptedAt });
    }
  }
  return confirmed;
}

/**
 * Подтверждённые компетенции не отменённых планов: одна запись на компетенцию, первая по времени.
 * Имя берётся из справочника, а удалённая оттуда компетенция остаётся названием из строки плана.
 */
export function collectConfirmed(live: PlanFacts[]): ConfirmedCompetency[] {
  const byId = new Map<string, ConfirmedCompetency>();
  for (const plan of live) {
    for (const [competencyId, row] of planConfirmed(plan)) {
      const known = byId.get(competencyId);
      if (known && known.acceptedAt <= row.acceptedAt) continue;
      byId.set(competencyId, {
        competencyId,
        name: getCompetency(competencyId)?.name ?? row.name,
        planId: plan.id,
        acceptedAt: row.acceptedAt,
      });
    }
  }
  return [...byId.values()].sort((a, b) => a.acceptedAt - b.acceptedAt || a.competencyId.localeCompare(b.competencyId));
}

/** Подтверждённые компетенции сотрудника для блока на странице достижений; строкой выдачи они не становятся. */
export function confirmedCompetencies(employeeId: string): ConfirmedCompetency[] {
  return collectConfirmed(loadPlans(employeeId).filter((plan) => plan.status !== "cancelled"));
}

/**
 * Выданные и не отозванные достижения сотрудника, свежие сверху. Чужие строки сюда не попадают:
 * выборка по `employee_id`, страницы с чужим id нет. Отозванные в списке не показываются,
 * но остаются в базе с датой отзыва.
 */
export function employeeAchievements(employeeId: string): EmployeeAchievement[] {
  ensureSchema();
  const rows = getDb()
    .select({ grant: employeeAchievementRows, catalog: achievements })
    .from(employeeAchievementRows)
    .innerJoin(achievements, eq(achievements.id, employeeAchievementRows.achievementId))
    .where(eq(employeeAchievementRows.employeeId, employeeId))
    .orderBy(desc(employeeAchievementRows.grantedAt), asc(achievements.title))
    .all();
  return rows
    .filter(({ grant }) => grant.revokedAt == null)
    .map(({ grant, catalog }) => ({
      id: catalog.id,
      title: catalog.title,
      description: catalog.description,
      category: catalog.category,
      icon: catalog.icon,
      grantedAt: grant.grantedAt,
      sourceRef: grant.sourceRef,
      href: grant.sourceRef && getIdp(grant.sourceRef) ? `/idps/${encodeURIComponent(grant.sourceRef)}` : null,
    }));
}
