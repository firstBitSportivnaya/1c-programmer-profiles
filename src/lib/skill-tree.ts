import type { CompetencyLinkKind, IdpItemStatus } from "@/db/schema";

/**
 * Дерево навыков: личные пометки и путь активного ИПР на одной карте.
 * Чистая сборка без запросов к базе: страница отдаёт уже прочитанные строки.
 * Личного уровня нет (ADR 0001, 0007): планка уровня — требование должности,
 * подтверждение — приёмка строки (ADR 0006).
 */

export type SkillMarkStatus = "has" | "lacks" | "in_progress";

export type TreeSectionKey = "technical" | "personal";

export type TreeProfileSkill = {
  id: string;
  name: string;
  section: TreeSectionKey;
  groupId: string | null;
  groupName: string | null;
  level: number | null;
  criteria: string | null;
};

export type TreePoolRow = {
  competencyId: string;
  competencyName: string;
  requiredLevel: number | null;
};

export type TreeItemRow = {
  id: number;
  competencyId: string;
  name: string;
  status: IdpItemStatus;
  dueOn: string | null;
  accepted: boolean;
};

export type TreeMarkRow = {
  competencyId: string;
  status: SkillMarkStatus;
  note: string;
};

export type TreeOutsideRow = {
  id: string;
  name: string;
  section: TreeSectionKey;
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

export type SkillNode = {
  id: string;
  name: string;
  section: TreeSectionKey;
  groupId: string | null;
  groupName: string | null;
  level: number | null;
  wasLevel: number | null;
  mark: SkillMarkStatus | "";
  note: string;
  confirmed: boolean;
  plan: { state: PlanState; total: number; accepted: number };
  criteria: string | null;
  materials: TreeLink[];
  rows: { id: number; name: string; status: IdpItemStatus; dueOn: string | null; accepted: boolean }[];
};

export type SkillTier = {
  job: TreeJob;
  sections: { key: TreeSectionKey; title: string; skills: SkillNode[] }[];
};

export type SkillTreeData = {
  current: SkillTier | null;
  target: SkillTier | null;
  outside: SkillNode[];
  planId: string | null;
};

const SECTION_TITLES: Record<TreeSectionKey, string> = {
  technical: "Профессиональные",
  personal: "Личные",
};

/** Состояние шага плана по строкам одной компетенции: принято всё, начато или не начато. */
export function planState(rows: { status: IdpItemStatus; accepted: boolean }[]): {
  state: PlanState;
  total: number;
  accepted: number;
} {
  const accepted = rows.filter((row) => row.accepted).length;
  if (rows.length > 0 && accepted === rows.length) return { state: "done", total: rows.length, accepted };
  if (accepted > 0 || rows.some((row) => row.status !== "not_started")) {
    return { state: "in_progress", total: rows.length, accepted };
  }
  return { state: "not_started", total: rows.length, accepted };
}

function sections(skills: SkillNode[]): SkillTier["sections"] {
  return (["technical", "personal"] as const)
    .map((key) => ({ key, title: SECTION_TITLES[key], skills: skills.filter((skill) => skill.section === key) }))
    .filter((section) => section.skills.length > 0);
}

export type BuildSkillTreeInput = {
  currentJob: TreeJob | null;
  targetJob: TreeJob | null;
  planId: string | null;
  currentSkills: TreeProfileSkill[];
  targetSkills: TreeProfileSkill[];
  pool: TreePoolRow[];
  items: TreeItemRow[];
  marks: TreeMarkRow[];
  outside: TreeOutsideRow[];
  materials: Map<string, TreeLink[]>;
  confirmed: Set<string>;
};

/**
 * Собирает два яруса и группу «Вне профиля». Пул активного плана — верхний ярус:
 * компетенция попадает туда один раз, даже если она уже есть в текущем профиле
 * (тогда узел помнит прежнюю планку). Обязанности сюда не передаются.
 */
export function buildSkillTree(input: BuildSkillTreeInput): SkillTreeData {
  const marks = new Map(input.marks.map((row) => [row.competencyId, row]));
  const items = new Map<string, TreeItemRow[]>();
  for (const row of input.items) {
    items.set(row.competencyId, [...(items.get(row.competencyId) ?? []), row]);
  }
  const currentById = new Map(input.currentSkills.map((row) => [row.id, row]));
  const targetById = new Map(input.targetSkills.map((row) => [row.id, row]));

  const makeNode = (
    id: string,
    name: string,
    section: TreeSectionKey,
    groupId: string | null,
    groupName: string | null,
    level: number | null,
    wasLevel: number | null,
    criteria: string | null,
    rowsFromPlan: TreeItemRow[],
  ): SkillNode => {
    const mark = marks.get(id);
    const plan = planState(rowsFromPlan);
    return {
      id,
      name,
      section,
      groupId,
      groupName,
      level,
      wasLevel,
      mark: mark?.status ?? "",
      note: mark?.note ?? "",
      confirmed: input.confirmed.has(id),
      plan,
      criteria,
      materials: input.materials.get(id) ?? [],
      rows: rowsFromPlan.map((row) => ({
        id: row.id,
        name: row.name,
        status: row.status,
        dueOn: row.dueOn,
        accepted: row.accepted,
      })),
    };
  };

  const poolIds = new Set(input.pool.map((row) => row.competencyId));

  const currentSkills = input.currentSkills
    .filter((row) => !poolIds.has(row.id))
    .map((row) =>
      makeNode(
        row.id,
        row.name,
        row.section,
        row.groupId,
        row.groupName,
        row.level,
        null,
        row.criteria,
        items.get(row.id) ?? [],
      ),
    );

  const targetSkills = input.pool.map((row) => {
    const target = targetById.get(row.competencyId);
    const previous = currentById.get(row.competencyId);
    return makeNode(
      row.competencyId,
      target?.name ?? row.competencyName,
      target?.section ?? "technical",
      target?.groupId ?? null,
      target?.groupName ?? null,
      row.requiredLevel ?? target?.level ?? null,
      previous?.level ?? null,
      target?.criteria ?? null,
      items.get(row.competencyId) ?? [],
    );
  });

  const outside = input.outside.map((row) =>
    makeNode(row.id, row.name, row.section, null, null, null, null, null, items.get(row.id) ?? []),
  );

  return {
    current:
      input.currentJob && currentSkills.length > 0
        ? { job: input.currentJob, sections: sections(currentSkills) }
        : null,
    target: input.targetJob ? { job: input.targetJob, sections: sections(targetSkills) } : null,
    outside,
    planId: input.planId,
  };
}
