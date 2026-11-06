/**
 * Автоматические правила достижений (ADR 0010). Правило — предикат по текущим данным сотрудника:
 * ИПР и их строки, справочник компетенций, профиль текущей должности, должность и оргсвязь.
 * Подтверждение компетенции берётся из общего расчёта: приёмка строки или действующая ручная
 * запись (ADR 0011). Личные пометки условием не служат — это заметка сотрудника для себя (ADR 0007).
 *
 * Планировщика нет: `syncEmployeeAchievements` идемпотентно сверяет выдачи после изменения данных
 * и при открытии `/me/achievements`. Повторное выполнение условия второй строки не даёт,
 * ручную выдачу сверка не трогает, отзыв человека не оживляет.
 */
import { and, eq } from "drizzle-orm";
import { getDb, getSqlite, now } from "@/db";
import { achievements, employeeAchievements } from "@/db/schema";
import type { AchievementRule } from "@/lib/achievement-catalog";
import {
  collectConfirmed,
  loadPlans,
  type AcceptedItem,
  type ConfirmedCompetency,
  type PlanFacts,
} from "@/lib/achievements";
import {
  ensureSchema,
  getEmployee,
  groupedProfile,
  listCompetencyConfirmations,
  listDirectReports,
} from "@/lib/queries";

type Facts = {
  employeeId: string;
  jobId: string;
  plans: PlanFacts[];
  /** Планы, которые участвуют в правилах: отменённый план условия не даёт. */
  live: PlanFacts[];
  accepted: AcceptedItem[];
  confirmed: ConfirmedCompetency[];
  profileSkills: Set<string>;
  reports: number;
  reportCompletedIdp: string | null;
  /** Подтверждённая компетенция подчинённого: приёмкой или ручной записью (ADR 0011). */
  reportConfirmed: Condition;
};

type Condition = { holds: boolean; sourceRef: string | null };

const NO_CONDITION: Condition = { holds: false, sourceRef: null };

/**
 * Сигналы подчинённых для правил наставничества: выполненный план и подтверждённая компетенция.
 * Подтверждение берётся из общего расчёта (ADR 0011), поэтому ручная запись считается так же,
 * как приёмка; у ручной нет плана, и достижение остаётся без ссылки.
 */
function reportSignals(employeeIds: string[]): { completed: string | null; confirmed: Condition } {
  let completed: string | null = null;
  let confirmed: Condition | null = null;
  for (const employeeId of employeeIds) {
    const plans = loadPlans(employeeId);
    for (const plan of plans) {
      if (plan.status === "completed") completed ??= plan.id;
    }
    if (confirmed == null) {
      const rows = collectConfirmed(
        plans.filter((plan) => plan.status !== "cancelled"),
        listCompetencyConfirmations(employeeId),
      );
      const row = rows.find((item) => item.planId != null) ?? rows[0];
      if (row) confirmed = { holds: true, sourceRef: row.planId };
    }
    if (completed && confirmed) break;
  }
  return { completed, confirmed: confirmed ?? NO_CONDITION };
}

/** Снимок данных сотрудника: должность, планы, приёмки, профиль и прямые подчинённые. */
function buildFacts(employee: { id: string; jobId: string }): Facts {
  const plans = loadPlans(employee.id);
  const live = plans.filter((plan) => plan.status !== "cancelled");
  const accepted = live
    .flatMap((plan) =>
      plan.items
        .filter((item) => item.acceptedAt != null)
        .map((item) => ({ planId: plan.id, itemId: item.id, acceptedAt: item.acceptedAt as number })),
    )
    .sort((a, b) => a.acceptedAt - b.acceptedAt || a.itemId - b.itemId);
  const profile = groupedProfile(employee.jobId);
  const profileSkills = new Set(
    (profile?.technical ?? []).concat(profile?.personal ?? []).map((row) => row.competency.id),
  );
  const reports = listDirectReports(employee.id).map((row) => row.id);
  const signals = reports.length > 0 ? reportSignals(reports) : { completed: null, confirmed: NO_CONDITION };
  return {
    employeeId: employee.id,
    jobId: employee.jobId,
    plans,
    live,
    accepted,
    confirmed: collectConfirmed(live, listCompetencyConfirmations(employee.id)),
    profileSkills,
    reports: reports.length,
    reportCompletedIdp: signals.completed,
    reportConfirmed: signals.confirmed,
  };
}

/** План, к которому относится N-я по счёту запись: из него берётся ссылка достижения. */
function planAt(items: { planId: string | null }[], index: number) {
  return items[index]?.planId ?? null;
}

/** Дата приёмки как `ГГГГ-ММ-ДД`: срок задания хранится такой же строкой. */
function isoDate(unix: number) {
  const date = new Date(unix * 1000);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Выполненный план в срок: все строки приняты, а принятые со сроком — не позже срока.
 * Плана без строк со сроком это условие не нарушает: проверять нечего.
 */
function onTimePlan(facts: Facts) {
  return facts.plans
    .filter((plan) => plan.status === "completed")
    .sort((a, b) => a.updatedAt - b.updatedAt || a.id.localeCompare(b.id))
    .find((plan) =>
      plan.items.every(
        (item) => item.acceptedAt != null && (item.dueOn == null || isoDate(item.acceptedAt) <= item.dueOn),
      ),
    );
}

/** Условие автоматического правила по снимку данных; `sourceRef` — план, из-за которого выдано. */
function evaluateRule(rule: AchievementRule, ruleParam: string | null, facts: Facts): Condition {
  switch (rule) {
    case "manual":
      return NO_CONDITION;
    case "idp.first-accepted-item":
      return facts.accepted.length >= 1 ? { holds: true, sourceRef: planAt(facts.accepted, 0) } : NO_CONDITION;
    case "idp.items-3":
      return facts.accepted.length >= 3 ? { holds: true, sourceRef: planAt(facts.accepted, 2) } : NO_CONDITION;
    case "idp.items-10":
      return facts.accepted.length >= 10 ? { holds: true, sourceRef: planAt(facts.accepted, 9) } : NO_CONDITION;
    case "idp.competency-confirmed":
      // Ручная запись может быть раньше приёмки: ссылку берём у записи с планом, если она есть.
      return facts.confirmed.length >= 1
        ? { holds: true, sourceRef: facts.confirmed.find((row) => row.planId != null)?.planId ?? null }
        : NO_CONDITION;
    case "idp.pool-confirmed": {
      const confirmedIds = new Set(facts.confirmed.map((row) => row.competencyId));
      const plan = facts.live.find(
        (row) => row.pool.length > 0 && row.pool.every((item) => confirmedIds.has(item.competencyId)),
      );
      return plan ? { holds: true, sourceRef: plan.id } : NO_CONDITION;
    }
    case "idp.completed":
    case "idp.completed-2": {
      const done = facts.plans
        .filter((plan) => plan.status === "completed")
        .sort((a, b) => a.updatedAt - b.updatedAt || a.id.localeCompare(b.id));
      const need = rule === "idp.completed" ? 1 : 2;
      const plan = done[need - 1];
      return plan ? { holds: true, sourceRef: plan.id } : NO_CONDITION;
    }
    case "idp.on-time": {
      const plan = onTimePlan(facts);
      return plan ? { holds: true, sourceRef: plan.id } : NO_CONDITION;
    }
    case "competency.confirmed-3":
    case "competency.confirmed-5":
    case "competency.confirmed-10":
    case "competency.confirmed-20": {
      const need = Number(rule.slice("competency.confirmed-".length));
      return facts.confirmed.length >= need
        ? { holds: true, sourceRef: planAt(facts.confirmed, need - 1) }
        : NO_CONDITION;
    }
    case "competency.half-profile": {
      if (facts.profileSkills.size === 0) return NO_CONDITION;
      const need = Math.ceil(facts.profileSkills.size / 2);
      let seen = 0;
      for (const row of facts.confirmed) {
        if (!facts.profileSkills.has(row.competencyId)) continue;
        seen += 1;
        if (seen >= need) return { holds: true, sourceRef: row.planId };
      }
      return NO_CONDITION;
    }
    case "competency.full-profile": {
      if (facts.profileSkills.size === 0) return NO_CONDITION;
      let seen = 0;
      for (const row of facts.confirmed) {
        if (!facts.profileSkills.has(row.competencyId)) continue;
        seen += 1;
        if (seen >= facts.profileSkills.size) return { holds: true, sourceRef: row.planId };
      }
      return NO_CONDITION;
    }
    case "competency.outside-profile": {
      const row = facts.confirmed.find((item) => !facts.profileSkills.has(item.competencyId));
      return row ? { holds: true, sourceRef: row.planId } : NO_CONDITION;
    }
    case "job.assigned":
      return ruleParam != null && facts.jobId === ruleParam ? { holds: true, sourceRef: null } : NO_CONDITION;
    case "manager.direct-1":
      return facts.reports >= 1 ? { holds: true, sourceRef: null } : NO_CONDITION;
    case "manager.direct-3":
      return facts.reports >= 3 ? { holds: true, sourceRef: null } : NO_CONDITION;
    case "manager.report-idp-completed":
      return facts.reportCompletedIdp ? { holds: true, sourceRef: facts.reportCompletedIdp } : NO_CONDITION;
    case "manager.report-competency":
      return facts.reportConfirmed;
  }
}

/**
 * Идемпотентная сверка выдач сотрудника (ADR 0010). Выдаёт недостающие автоматические достижения,
 * отзывает те, чьё условие перестало выполняться, и не трогает ручные и отозванные человеком.
 * Скрытое из каталога (`archived`) заново не выдаётся: снятое в каталоге предложение не возвращается.
 */
export function syncEmployeeAchievements(employeeId: string): void {
  ensureSchema();
  const employee = getEmployee(employeeId);
  if (!employee) return;
  const db = getDb();
  const facts = buildFacts(employee);
  const catalog = db.select().from(achievements).all();
  const t = now();
  const key = (achievementId: string) =>
    and(eq(employeeAchievements.employeeId, employeeId), eq(employeeAchievements.achievementId, achievementId));

  getSqlite()
    .transaction(() => {
      // Чтение внутри `BEGIN IMMEDIATE`: соседний процесс к этому моменту уже зафиксировал свою выдачу,
      // поэтому вторая строка не упрётся в первичный ключ `(employee_id, achievement_id)`.
      const current = new Map(
        db
          .select()
          .from(employeeAchievements)
          .where(eq(employeeAchievements.employeeId, employeeId))
          .all()
          .map((row) => [row.achievementId, row]),
      );
      for (const row of catalog) {
        const existing = current.get(row.id);
        // Ручная запись ничего не выдаёт автоматически. Автоматическая строка прошлого правила
        // при этом остаётся без условия: сверять её больше не с чем, поэтому она отзывается.
        // Ручные выдачи (в том числе по этой же записи) не трогаются.
        if (row.rule === "manual") {
          if (existing && existing.source === "auto" && existing.revokedAt == null) {
            db.update(employeeAchievements)
              .set({ revokedAt: t, revokedById: null, revokeReason: null })
              .where(key(row.id))
              .run();
          }
          continue;
        }
        if (row.archived !== 0 && (!existing || existing.revokedAt != null)) continue;
        const { holds, sourceRef } = evaluateRule(row.rule, row.ruleParam, facts);
        if (holds) {
          if (!existing) {
            db.insert(employeeAchievements)
              .values({
                employeeId,
                achievementId: row.id,
                source: "auto",
                ruleKey: row.rule,
                sourceRef,
                grantedAt: t,
              })
              .run();
            continue;
          }
          // Решение человека сильнее предиката: отозванное вручную автоматика не оживляет.
          if (existing.source !== "auto" || existing.revokedAt == null || existing.revokedById != null) continue;
          db.update(employeeAchievements)
            .set({ revokedAt: null, revokedById: null, revokeReason: null, grantedAt: t, ruleKey: row.rule, sourceRef })
            .where(key(row.id))
            .run();
          continue;
        }
        if (existing && existing.source === "auto" && existing.revokedAt == null) {
          db.update(employeeAchievements)
            .set({ revokedAt: t, revokedById: null, revokeReason: null })
            .where(key(row.id))
            .run();
        }
      }
      return true;
    })
    .immediate(null);
}
