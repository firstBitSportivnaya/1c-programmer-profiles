import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { idpItems, idpPool, idps } from "@/db/schema";
import { ensureSchema, getCompetency } from "@/lib/queries";

/** Куда ведёт достижение: впервые принятая строка плана, план целиком или карточка компетенции. */
export type AchievementTarget =
  | { kind: "item"; idpId: string; itemId: number }
  | { kind: "idp"; idpId: string }
  | { kind: "competency"; competencyId: string };

export type Achievement = {
  key: string;
  title: string;
  detail: string | null;
  /** Адрес цели; `null` — цели в справочнике больше нет, строка остаётся текстом без битой ссылки. */
  href: string | null;
};

export type AchievementPlan = {
  id: string;
  status: "active" | "completed" | "cancelled";
  pool: { competencyId: string; competencyName: string }[];
  items: { id: number; competencyId: string; acceptedAt: number | null }[];
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
    if (item.acceptedAt != null) group.accepted += 1;
    groups.set(item.competencyId, group);
  }
  return new Set(
    [...groups.entries()].filter(([, group]) => group.total > 0 && group.accepted === group.total).map(([id]) => id),
  );
}

/** Адрес цели достижения. Компетенции, удалённой из справочника, не отдаём: её карточка ответит 404. */
function targetHref(target: AchievementTarget, competencyExists: (id: string) => boolean): string | null {
  switch (target.kind) {
    case "item":
      return `/idps/${target.idpId}#item-${target.itemId}`;
    case "idp":
      return `/idps/${target.idpId}`;
    case "competency":
      return competencyExists(target.competencyId)
        ? `/competencies/${encodeURIComponent(target.competencyId)}`
        : null;
  }
}

/**
 * Ачивки считаются на чтении по текущим приёмкам всех не отменённых планов сотрудника.
 * Отдельной таблицы нет, сняли приёмку — ачивка пропала. Отменённый план не считается.
 * `competencyExists` проверяет справочник: без него цель ссылки считается существующей.
 */
export function computeAchievements(
  plans: AchievementPlan[],
  options: { competencyExists?: (id: string) => boolean } = {},
): Achievement[] {
  const competencyExists = options.competencyExists ?? (() => true);
  const live = plans.filter((plan) => plan.status !== "cancelled");
  const result: Achievement[] = [];

  // Первая принятая строка за всё время: самое раннее подтверждение, при равном времени — меньший id.
  const accepted = live
    .flatMap((plan) => plan.items.filter((item) => item.acceptedAt != null).map((item) => ({ plan, item })))
    .sort((a, b) => (a.item.acceptedAt ?? 0) - (b.item.acceptedAt ?? 0) || a.item.id - b.item.id);
  if (accepted.length > 0) {
    const { plan, item } = accepted[0];
    result.push({
      key: "first-row",
      title: FIRST_ROW,
      detail: null,
      href: targetHref({ kind: "item", idpId: plan.id, itemId: item.id }, competencyExists),
    });
  }

  const confirmedNames = new Map<string, string>();
  for (const plan of live) {
    const confirmed = confirmedCompetencies(plan);
    for (const row of plan.pool) {
      if (confirmed.has(row.competencyId)) confirmedNames.set(row.competencyId, row.competencyName);
    }
  }
  const sorted = [...confirmedNames.entries()].sort((a, b) => a[1].localeCompare(b[1], "ru"));
  for (const [competencyId, name] of sorted) {
    result.push({
      key: `competency:${competencyId}`,
      title: COMPETENCY,
      detail: name,
      href: targetHref({ kind: "competency", competencyId }, competencyExists),
    });
  }

  const poolPlan = live.find((plan) => {
    if (plan.pool.length === 0) return false;
    const confirmed = confirmedCompetencies(plan);
    return plan.pool.every((row) => confirmed.has(row.competencyId));
  });
  if (poolPlan) {
    result.push({
      key: "pool",
      title: POOL,
      detail: null,
      href: targetHref({ kind: "idp", idpId: poolPlan.id }, competencyExists),
    });
  }

  const donePlan = live.find((plan) => plan.status === "completed");
  if (donePlan) {
    result.push({
      key: "idp",
      title: IDP_DONE,
      detail: null,
      href: targetHref({ kind: "idp", idpId: donePlan.id }, competencyExists),
    });
  }

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
      id: plan.id,
      status: plan.status,
      pool: pool.filter((row) => row.idpId === plan.id),
      items: items
        .filter((item) => item.idpId === plan.id)
        .map((item) => ({ id: item.id, competencyId: item.competencyId, acceptedAt: item.acceptedAt })),
    })),
    { competencyExists: (id) => getCompetency(id) != null },
  );
}
