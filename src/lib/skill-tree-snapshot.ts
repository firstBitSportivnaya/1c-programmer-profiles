import { confirmedCompetencies, type ConfirmedCompetency } from "@/lib/achievements";
import {
  competencyMarkViews,
  getActiveIdp,
  getJob,
  groupedProfile,
  jobHref,
  listCompetencies,
  listCompetencyLinks,
  listIdpItems,
} from "@/lib/queries";
import {
  buildSkillTree,
  type SkillTreeData,
  type TreeLink,
  type TreeMarkRow,
  type TreeSkillRow,
} from "@/lib/skill-tree";

/** Девиз дерева: статический текст, один для всех, от данных и отбора не зависит. */
export const SKILL_TREE_MOTTO = "Навык не появляется сразу — он вырастает из предпосылки.";

/**
 * Кто смотрит дерево. `own` — сам сотрудник: с личными пометками. `review` — руководитель или админ:
 * пометок в снимке нет вовсе (ADR 0007), поэтому они не уходят в клиент даже пустыми строками.
 */
export type SkillTreeMode = "own" | "review";

/**
 * Подтверждение для панели узла (issue #133, ADR 0011): дата ручной записи приходит с сервера
 * готовой строкой. Панель — клиентский компонент, и `new Date` в браузере дал бы другую дату
 * в другом часовом поясе, чем карточка сотрудника, которая форматирует её на сервере.
 */
export type SkillConfirmationView = {
  /** План, приёмка в котором подтвердила навык; `null` — подтверждено только вручную. */
  planId: string | null;
  /** Ручная часть записи; `null` — подтверждено только приёмкой. */
  manual: { confirmedOn: string; confirmedByName: string; note: string } | null;
};

/** `confirmed_at` хранит секунды Unix; в карточке и панели дата — ДД.ММ.ГГГГ по времени сервера. */
function dottedDate(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}.${month}.${date.getFullYear()}`;
}

/** Строка подтверждения для панели: источник и готовая дата ручной записи. */
function confirmationView(row: ConfirmedCompetency): SkillConfirmationView {
  return {
    planId: row.planId,
    manual: row.manual
      ? {
          confirmedOn: dottedDate(row.manual.confirmedAt),
          confirmedByName: row.manual.confirmedByName,
          note: row.manual.note,
        }
      : null,
  };
}

export type SkillTreeSnapshot = {
  data: SkillTreeData;
  /** Навыки должности и цели: без них дерево показывает пустое состояние. */
  hasProfile: boolean;
  /** Личные пометки сотрудника и их пояснения. В режиме `review` всегда `false`. */
  hasMarks: boolean;
  /** Подтверждённые компетенции: они открывают дерево и без профиля (ADR 0011). */
  hasConfirmed: boolean;
  /** Подтверждения по компетенциям: источник, план и ручная запись с готовой датой. */
  confirmations: Record<string, SkillConfirmationView>;
};

type ProfileRow = { level: number | null; criteria: string | null };

/** Строки профиля по компетенциям: планка и критерий. У обязанностей уровня нет. */
function profileRows(jobId: string | null): Map<string, ProfileRow> {
  const map = new Map<string, ProfileRow>();
  if (!jobId) return map;
  const grouped = groupedProfile(jobId);
  if (!grouped) return map;
  for (const row of grouped.technical.concat(grouped.personal)) {
    map.set(row.competency.id, {
      level: row.skill.level,
      criteria: row.skill.criteria?.trim() ? row.skill.criteria : null,
    });
  }
  return map;
}

/** Уровни навыков профиля. */
function levelMap(rows: Map<string, ProfileRow>): Map<string, number | null> {
  return new Map([...rows].map(([id, row]) => [id, row.level]));
}

/**
 * Критерий читается по той планке, которую требует план: если цель выше текущей,
 * показываем критерий цели, иначе критерий текущей должности.
 */
function criteriaMap(current: Map<string, ProfileRow>, target: Map<string, ProfileRow>) {
  const map = new Map<string, string | null>();
  for (const id of new Set([...current.keys(), ...target.keys()])) {
    const now = current.get(id);
    const goal = target.get(id);
    const fromTarget = goal !== undefined && (now === undefined || (goal.level ?? 0) > (now.level ?? 0));
    map.set(id, (fromTarget ? goal.criteria : now?.criteria) ?? goal?.criteria ?? null);
  }
  return map;
}

/** Все навыки справочника: группы без родителя и обязанности в дерево не входят. */
function treeSkills(): TreeSkillRow[] {
  const all = listCompetencies();
  const names = new Map(all.map((row) => [row.id, row.name]));
  return all
    .filter((row) => row.parentId !== null && row.type !== "duty")
    .map((row) => ({
      id: row.id,
      name: row.name,
      groupId: row.parentId,
      groupName: row.parentId ? (names.get(row.parentId) ?? null) : null,
      kind: row.type === "universal" ? "universal" : "professional",
    }));
}

/** Личные пометки сотрудника: только они дают заливку узла (ADR 0007, 0008). */
function markRows(employeeId: string, jobId: string): TreeMarkRow[] {
  const { current, outside } = competencyMarkViews(employeeId, jobId);
  const marks: TreeMarkRow[] = [];
  for (const row of [...current, ...outside]) {
    if (row.status === "has" || row.status === "lacks" || row.status === "in_progress") {
      marks.push({ competencyId: row.id, status: row.status, note: row.note });
    }
  }
  return marks;
}

/**
 * Снимок дерева для страницы: должности, активный план, профиль, предпосылки, критерии,
 * материалы, строки плана и подтверждения. Одна точка сборки для `/me/skills` и карточки
 * сотрудника: страницы не считают дерево сами. Личный слой берётся только в режиме `own`.
 */
export function loadSkillTreeSnapshot(employeeId: string, jobId: string, mode: SkillTreeMode): SkillTreeSnapshot {
  const currentJob = getJob(jobId);
  const active = getActiveIdp(employeeId);
  const targetJob = active ? getJob(active.targetJobId) : null;
  const marks = mode === "own" ? markRows(employeeId, jobId) : [];

  const materials = new Map<string, TreeLink[]>();
  for (const [competencyId, links] of listCompetencyLinks()) {
    materials.set(
      competencyId,
      links.map((link) => ({ kind: link.kind, title: link.title, url: link.url })),
    );
  }

  const currentRows = profileRows(jobId);
  const targetRows = profileRows(active?.targetJobId ?? null);
  const criteria = criteriaMap(currentRows, targetRows);

  const confirmedRows = confirmedCompetencies(employeeId);
  const confirmed = new Set(confirmedRows.map((row) => row.competencyId));
  const confirmations: Record<string, SkillConfirmationView> = {};
  for (const row of confirmedRows) confirmations[row.competencyId] = confirmationView(row);

  const data = buildSkillTree({
    currentJob: currentJob ? { id: currentJob.id, name: currentJob.name, href: jobHref(currentJob.id) } : null,
    targetJob: targetJob ? { id: targetJob.id, name: targetJob.name, href: jobHref(targetJob.id) } : null,
    planId: active?.id ?? null,
    skills: treeSkills(),
    currentLevels: levelMap(currentRows),
    targetLevels: levelMap(targetRows),
    criteria,
    items: active
      ? listIdpItems(active.id).map((item) => ({
          id: item.id,
          competencyId: item.competencyId,
          name: item.assignmentName,
          status: item.status,
          dueOn: item.dueOn,
          accepted: item.acceptedAt != null,
        }))
      : [],
    marks,
    materials,
    confirmed,
  });

  return {
    data,
    hasProfile: data.nodes.some((node) => node.relation !== "none"),
    hasMarks: data.nodes.some((node) => node.mark !== ""),
    hasConfirmed: data.nodes.some((node) => node.confirmed),
    confirmations,
  };
}
