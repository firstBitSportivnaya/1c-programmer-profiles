import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { idpItems, idpPool, idps } from "@/db/schema";
import { ensureSchema } from "@/lib/queries";

export type Achievement = {
  key: string;
  title: string;
  detail: string | null;
};

export type AchievementPlan = {
  status: "active" | "completed" | "cancelled";
  pool: { competencyId: string; competencyName: string }[];
  items: { competencyId: string; accepted: boolean }[];
};

const FIRST_ROW = "Первая принятая строка";
const COMPETENCY = "Компетенция подтверждена";
const POOL = "Все компетенции пула подтверждены";
const IDP_DONE = "ИПР выполнен";

/**
 * Компетенции этого плана с подтверждением: все её строки приняты и хотя бы одна строка есть (ADR 0006).
 * Пул без строк подтверждения не даёт.
 */
function confirmedCompetencies(plan: AchievementPlan) {
  const groups = new Map<string, { total: number; accepted: number }>();
  for (const item of plan.items) {
    const group = groups.get(item.competencyId) ?? { total: 0, accepted: 0 };
    group.total += 1;
    if (item.accepted) group.accepted += 1;
    groups.set(item.competencyId, group);
  }
  return new Set(
    [...groups.entries()].filter(([, group]) => group.total > 0 && group.accepted === group.total).map(([id]) => id),
  );
}

/**
 * Ачивки считаются на чтении по текущим приёмкам всех не отменённых планов сотрудника.
 * Отдельной таблицы нет, сняли приёмку — ачивка пропала. Отменённый план не считается.
 */
export function computeAchievements(plans: AchievementPlan[]): Achievement[] {
  const live = plans.filter((plan) => plan.status !== "cancelled");
  const result: Achievement[] = [];

  const hasAccepted = live.some((plan) => plan.items.some((item) => item.accepted));
  if (hasAccepted) result.push({ key: "first-row", title: FIRST_ROW, detail: null });

  const confirmedNames = new Map<string, string>();
  for (const plan of live) {
    const confirmed = confirmedCompetencies(plan);
    for (const row of plan.pool) {
      if (confirmed.has(row.competencyId)) confirmedNames.set(row.competencyId, row.competencyName);
    }
  }
  const sorted = [...confirmedNames.entries()].sort((a, b) => a[1].localeCompare(b[1], "ru"));
  for (const [competencyId, name] of sorted) {
    result.push({ key: `competency:${competencyId}`, title: COMPETENCY, detail: name });
  }

  const poolConfirmed = live.some((plan) => {
    if (plan.pool.length === 0) return false;
    const confirmed = confirmedCompetencies(plan);
    return plan.pool.every((row) => confirmed.has(row.competencyId));
  });
  if (poolConfirmed) result.push({ key: "pool", title: POOL, detail: null });

  if (live.some((plan) => plan.status === "completed")) result.push({ key: "idp", title: IDP_DONE, detail: null });

  return result;
}

/** Ачивки одного сотрудника. Чужие планы сюда не попадают: выборка по `employee_id`. */
export function employeeAchievements(employeeId: string): Achievement[] {
  ensureSchema();
  const db = getDb();
  const plans = db.select().from(idps).where(eq(idps.employeeId, employeeId)).all();
  if (plans.length === 0) return [];
  const planIds = plans.map((plan) => plan.id);
  const items = db.select().from(idpItems).where(inArray(idpItems.idpId, planIds)).all();
  const pool = db.select().from(idpPool).where(inArray(idpPool.idpId, planIds)).all();
  return computeAchievements(
    plans.map((plan) => ({
      status: plan.status,
      pool: pool.filter((row) => row.idpId === plan.id),
      items: items
        .filter((item) => item.idpId === plan.id)
        .map((item) => ({ competencyId: item.competencyId, accepted: item.acceptedAt != null })),
    })),
  );
}
