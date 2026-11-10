import type { CompetencyLinkKind, IdpItemStatus } from "@/db/schema";

/**
 * Дерево навыков: карта предпосылок с личным слоем (ADR 0009).
 * Чистая сборка без запросов к базе: страница отдаёт уже прочитанные строки.
 * Личного уровня нет (ADR 0001, 0007): планка — требование должности,
 * подтверждение — приёмка всех строк компетенции или ручная запись (ADR 0006, 0011).
 */

export type SkillMarkStatus = "has" | "lacks" | "in_progress";

/** Отношение навыка к сотруднику: текущая должность, цель активного ИПР или оба. */
export type SkillRelation = "current" | "target" | "both" | "none";

/** Вид компетенции: профессиональная или личная (универсальная). Обязанности в дерево не входят. */
export type SkillKind = "professional" | "universal";

export type TreeSkillRow = {
  id: string;
  name: string;
  /** Группа справочника: она же тема навыка и цвет бейджа в узле. */
  groupId: string | null;
  groupName: string | null;
  kind: SkillKind;
};

export type TreeItemRow = {
  id: number;
  competencyId: string;
  name: string;
  status: IdpItemStatus;
  /** Срок уже как `ДД.ММ.ГГГГ` или `null`: панель дату не форматирует. */
  dueOn: string | null;
  accepted: boolean;
};

export type TreeMarkRow = {
  competencyId: string;
  status: SkillMarkStatus;
  note: string;
};

export type TreeLink = {
  kind: CompetencyLinkKind;
  title: string;
  url: string;
};

export type TreeJob = {
  id: string;
  name: string;
  href: string;
};

export type PlanState = "done" | "in_progress" | "not_started";

export type SkillPlan = { state: PlanState; total: number; accepted: number };

export type SkillTreeNode = {
  id: string;
  name: string;
  /** Группа справочника: тема навыка, её цвет идёт в бейдж узла. */
  groupId: string | null;
  groupName: string | null;
  kind: SkillKind;
  /** Планка текущей должности: требование, не оценка сотрудника. */
  currentLevel: number | null;
  /** Планка цели активного ИПР. */
  targetLevel: number | null;
  relation: SkillRelation;
  mark: SkillMarkStatus | "";
  note: string;
  confirmed: boolean;
  criteria: string | null;
  materials: TreeLink[];
  plan: SkillPlan;
  rows: { id: number; name: string; status: IdpItemStatus; dueOn: string | null; accepted: boolean }[];
};

export type SkillTreeData = {
  nodes: SkillTreeNode[];
  currentJob: TreeJob | null;
  targetJob: TreeJob | null;
  planId: string | null;
};

/** Состояние шага плана по строкам одной компетенции: принято всё, начато или не начато. */
export function planState(rows: { status: IdpItemStatus; accepted: boolean }[]): SkillPlan {
  const accepted = rows.filter((row) => row.accepted).length;
  if (rows.length > 0 && accepted === rows.length) return { state: "done", total: rows.length, accepted };
  if (accepted > 0 || rows.some((row) => row.status !== "not_started")) {
    return { state: "in_progress", total: rows.length, accepted };
  }
  return { state: "not_started", total: rows.length, accepted };
}

/**
 * Счётчики дерева: только счётчики и процент, без очков, опыта и уровней (ADR 0001).
 * «Всего» — узлы текущего отбора, «освоено» — пометка «есть», «в плане» — шаг активного ИПР
 * в любом состоянии, кроме «не начат». При пустом отборе процент равен нулю: деления на ноль нет.
 */
export type SkillTreeStats = { total: number; mastered: number; inPlan: number; progress: number };

export function skillTreeStats(nodes: Pick<SkillTreeNode, "mark" | "plan">[]): SkillTreeStats {
  const total = nodes.length;
  const mastered = nodes.filter((node) => node.mark === "has").length;
  const inPlan = nodes.filter((node) => node.plan.state !== "not_started").length;
  const progress = total === 0 ? 0 : Math.round((mastered / total) * 100);
  return { total, mastered, inPlan, progress };
}

export type BuildSkillTreeInput = {
  skills: TreeSkillRow[];
  /** Планки навыков текущей должности. */
  currentLevels: Map<string, number | null>;
  /** Планки навыков пула активного ИПР. */
  targetLevels: Map<string, number | null>;
  /** Критерий: из текущей должности, иначе из цели. */
  criteria: Map<string, string | null>;
  marks: TreeMarkRow[];
  items: TreeItemRow[];
  materials: Map<string, TreeLink[]>;
  confirmed: Set<string>;
  currentJob: TreeJob | null;
  targetJob: TreeJob | null;
  planId: string | null;
};

function relationOf(inCurrent: boolean, inTarget: boolean): SkillRelation {
  if (inCurrent && inTarget) return "both";
  if (inCurrent) return "current";
  if (inTarget) return "target";
  return "none";
}

/** Собирает все навыки справочника с личным слоем: пометка, подтверждение, строки плана. */
export function buildSkillTree(input: BuildSkillTreeInput): SkillTreeData {
  const marks = new Map(input.marks.map((row) => [row.competencyId, row]));
  const items = new Map<string, TreeItemRow[]>();
  for (const row of input.items) {
    const list = items.get(row.competencyId);
    if (list) list.push(row);
    else items.set(row.competencyId, [row]);
  }

  const nodes: SkillTreeNode[] = input.skills.map((skill) => {
    const mark = marks.get(skill.id);
    const inCurrent = input.currentLevels.has(skill.id);
    const inTarget = input.targetLevels.has(skill.id);
    const rows = items.get(skill.id) ?? [];
    return {
      id: skill.id,
      name: skill.name,
      groupId: skill.groupId,
      groupName: skill.groupName,
      kind: skill.kind,
      currentLevel: input.currentLevels.get(skill.id) ?? null,
      targetLevel: input.targetLevels.get(skill.id) ?? null,
      relation: relationOf(inCurrent, inTarget),
      mark: mark?.status ?? "",
      note: mark?.note ?? "",
      confirmed: input.confirmed.has(skill.id),
      criteria: input.criteria.get(skill.id) ?? null,
      materials: input.materials.get(skill.id) ?? [],
      plan: planState(rows),
      rows: rows.map((row) => ({
        id: row.id,
        name: row.name,
        status: row.status,
        dueOn: row.dueOn,
        accepted: row.accepted,
      })),
    };
  });

  return { nodes, currentJob: input.currentJob, targetJob: input.targetJob, planId: input.planId };
}
