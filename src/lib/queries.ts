import { cache } from "react";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { migrate } from "@/db/migrate";
import {
  achievements,
  competencies,
  competencyLinks,
  employeeCompetencyMarks,
  employees,
  idpAssignmentOptions,
  idpAssignmentQuestions,
  idpAssignments,
  idpItemAttempts,
  idpItemOptions,
  idpItemQuestions,
  idpItems,
  idpPool,
  idps,
  jobTransitions,
  jobs,
  profileSkills,
  profiles,
  type CompetencyMarkStatus,
} from "@/db/schema";
import { sectionForType } from "@/lib/invariants";

const SCHEMA_TICK = 8;
let appliedTick = 0;
export function ensureSchema() {
  if (appliedTick !== SCHEMA_TICK) {
    migrate();
    appliedTick = SCHEMA_TICK;
  }
}

export const listJobs = cache(function listJobs() {
  ensureSchema();
  return getDb().select().from(jobs).orderBy(asc(jobs.rankOrder), asc(jobs.name)).all();
});

export function getJob(id: string) {
  ensureSchema();
  return getDb().select().from(jobs).where(eq(jobs.id, id)).get();
}

export function listTransitions() {
  ensureSchema();
  return getDb().select().from(jobTransitions).all();
}

export function outgoingTransitions(jobId: string) {
  ensureSchema();
  return getDb().select().from(jobTransitions).where(eq(jobTransitions.fromJobId, jobId)).all();
}

export function getProfileByJob(jobId: string) {
  ensureSchema();
  return getDb().select().from(profiles).where(eq(profiles.jobId, jobId)).get();
}

/** Адрес страницы должности: с профилем — сразу профиль, без профиля — карточка `/jobs/{id}`. */
export function jobHref(jobId: string) {
  return getProfileByJob(jobId) ? `/jobs/${jobId}/profile` : `/jobs/${jobId}`;
}

export const listCompetencies = cache(function listCompetencies() {
  ensureSchema();
  return getDb().select().from(competencies).orderBy(asc(competencies.name)).all();
});

export function getCompetency(id: string) {
  ensureSchema();
  return getDb().select().from(competencies).where(eq(competencies.id, id)).get();
}

/**
 * Каталог достижений целиком (ADR 0010): скрытые записи тоже нужны админке, из списка их не убираем.
 * Сначала по категории, внутри — скрытые в конце, затем по названию.
 */
export const listAchievements = cache(function listAchievements() {
  ensureSchema();
  return getDb()
    .select()
    .from(achievements)
    .orderBy(asc(achievements.category), asc(achievements.archived), asc(achievements.title))
    .all();
});

export function getAchievement(id: string) {
  ensureSchema();
  return getDb().select().from(achievements).where(eq(achievements.id, id)).get();
}

export function profileSkillRows(profileId: string) {
  ensureSchema();
  return getDb()
    .select({
      skill: profileSkills,
      competency: competencies,
    })
    .from(profileSkills)
    .innerJoin(competencies, eq(profileSkills.competencyId, competencies.id))
    .where(eq(profileSkills.profileId, profileId))
    .orderBy(asc(profileSkills.sortOrder))
    .all();
}

export type ProfileSkillRow = ReturnType<typeof profileSkillRows>[number];

export type SkillCluster = {
  key: string;
  title: string | null;
  rows: ProfileSkillRow[];
};

export function clusterSkillRows(rows: ProfileSkillRow[]): SkillCluster[] {
  const byId = new Map(listCompetencies().map((c) => [c.id, c]));
  const buckets = new Map<string, ProfileSkillRow[]>();
  const order: string[] = [];
  for (const row of rows) {
    const parent = row.competency.parentId ? byId.get(row.competency.parentId) : undefined;
    const key = parent ? parent.id : `skill:${row.competency.id}`;
    if (!buckets.has(key)) {
      buckets.set(key, []);
      order.push(key);
    }
    buckets.get(key)!.push(row);
  }
  return order.map((key) => {
    const clusterRows = buckets.get(key)!;
    const parent = byId.get(key);
    if (!parent) {
      return { key, title: null, rows: clusterRows };
    }
    return { key, title: parent.name, rows: clusterRows };
  });
}

export function groupedProfile(jobId: string) {
  const profile = getProfileByJob(jobId);
  if (!profile) return null;
  const rows = profileSkillRows(profile.id);
  return {
    profile,
    technical: rows.filter((r) => sectionForType(r.competency.type) === "technical"),
    personal: rows.filter((r) => sectionForType(r.competency.type) === "personal"),
    duties: rows.filter((r) => sectionForType(r.competency.type) === "duties"),
  };
}

export function compareJobs(aId: string, bId: string) {
  const a = groupedProfile(aId);
  const b = groupedProfile(bId);
  if (!a || !b) return { error: "both-need-profiles" as const };
  const mapA = new Map(a.technical.concat(a.personal, a.duties).map((r) => [r.competency.id, r]));
  const mapB = new Map(b.technical.concat(b.personal, b.duties).map((r) => [r.competency.id, r]));
  const ids = new Set([...mapA.keys(), ...mapB.keys()]);
  const lines = [...ids].map((id) => {
    const left = mapA.get(id);
    const right = mapB.get(id);
    const name = left?.competency.name ?? right!.competency.name;
    const type = left?.competency.type ?? right!.competency.type;
    const levelA = left?.skill.level ?? null;
    const levelB = right?.skill.level ?? null;
    const criteriaA = left?.skill.criteria ?? null;
    const criteriaB = right?.skill.criteria ?? null;
    const presentA = Boolean(left);
    const presentB = Boolean(right);
    let change: "added" | "removed" | "level" | "criteria" | "same" = "same";
    if (presentA && !presentB) change = "removed";
    else if (!presentA && presentB) change = "added";
    else if (type !== "duty" && levelA !== levelB) change = "level";
    else if ((criteriaA ?? "") !== (criteriaB ?? "")) change = "criteria";
    const section = sectionForType(type);
    return { id, name, type, section, presentA, presentB, levelA, levelB, criteriaA, criteriaB, change };
  });
  lines.sort((x, y) => x.name.localeCompare(y.name, "ru"));
  return { aJobId: aId, bJobId: bId, lines };
}

const usedSkillIds = cache(function usedSkillIds(profileId: string) {
  ensureSchema();
  return getDb()
    .select({ competencyId: profileSkills.competencyId })
    .from(profileSkills)
    .where(eq(profileSkills.profileId, profileId))
    .all()
    .map((row) => row.competencyId);
});

export function unusedCompetencies(profileId: string, type: string) {
  const all = listCompetencies();
  const used = new Set(usedSkillIds(profileId));
  const parentIds = new Set(all.flatMap((row) => (row.parentId ? [row.parentId] : [])));
  return all.filter((row) => row.type === type && !used.has(row.id) && !parentIds.has(row.id));
}

export const listEmployees = cache(function listEmployees() {
  ensureSchema();
  return getDb().select().from(employees).orderBy(asc(employees.name)).all();
});

export function getEmployee(id: string) {
  ensureSchema();
  return getDb().select().from(employees).where(eq(employees.id, id)).get();
}

export function getEmployeeByLogin(login: string) {
  ensureSchema();
  return getDb().select().from(employees).where(eq(employees.login, login)).get();
}

export function listDirectReports(managerId: string) {
  ensureSchema();
  return getDb().select().from(employees).where(eq(employees.managerId, managerId)).orderBy(asc(employees.name)).all();
}

export function listEmployeesVisibleTo(actor: { id: string; isAdmin: boolean }) {
  if (actor.isAdmin) {
    return listEmployees().filter((row) => row.isActive === 1);
  }
  const self = getEmployee(actor.id);
  const reports = listDirectReports(actor.id).filter((row) => row.isActive === 1 && row.id !== actor.id);
  return self && self.isActive === 1 ? [self, ...reports] : reports;
}

export function getActiveIdp(employeeId: string) {
  ensureSchema();
  return getDb()
    .select()
    .from(idps)
    .where(eq(idps.employeeId, employeeId))
    .all()
    .find((row) => row.status === "active");
}

export type MarkableCompetency = {
  id: string;
  name: string;
  section: "technical" | "personal";
  onlyInTarget: boolean;
  criteria: string | null;
};

/**
 * Навыки, которые сотрудник может пометить впервые (ADR 0007): профиль текущей должности
 * и профиль цели активного ИПР, без обязанностей. `onlyInTarget` — навыка нет в текущей должности.
 * Критерий берётся из текущей должности; у навыка только из цели — из её профиля.
 */
export function markableCompetencies(employeeId: string, jobId: string): MarkableCompetency[] {
  const rows = new Map<string, MarkableCompetency>();
  const add = (profileJobId: string, onlyInTarget: boolean) => {
    const grouped = groupedProfile(profileJobId);
    if (!grouped) return;
    for (const row of grouped.technical.concat(grouped.personal)) {
      if (rows.has(row.competency.id)) continue;
      const criteria = row.skill.criteria?.trim() ? row.skill.criteria : null;
      rows.set(row.competency.id, {
        id: row.competency.id,
        name: row.competency.name,
        section: sectionForType(row.competency.type) === "technical" ? "technical" : "personal",
        onlyInTarget,
        criteria,
      });
    }
  };
  add(jobId, false);
  const active = getActiveIdp(employeeId);
  if (active) add(active.targetJobId, true);
  return [...rows.values()].sort((x, y) => x.name.localeCompare(y.name, "ru"));
}

export type CompetencyMarkView = MarkableCompetency & {
  status: CompetencyMarkStatus | "";
  note: string;
  outside: boolean;
};

export type CompetencyMarkSummary = {
  unmarked: number;
  has: number;
  lacks: number;
  inProgress: number;
};

/** Текущий набор, уже стоящие пометки вне него и сводка только по текущему набору (ADR 0008). */
export function competencyMarkViews(employeeId: string, jobId: string) {
  ensureSchema();
  const currentRows = markableCompetencies(employeeId, jobId);
  const stored = getDb()
    .select({
      competencyId: employeeCompetencyMarks.competencyId,
      status: employeeCompetencyMarks.status,
      note: employeeCompetencyMarks.note,
      name: competencies.name,
      type: competencies.type,
    })
    .from(employeeCompetencyMarks)
    .innerJoin(competencies, eq(employeeCompetencyMarks.competencyId, competencies.id))
    .where(eq(employeeCompetencyMarks.employeeId, employeeId))
    .all();
  const byId = new Map(stored.map((row) => [row.competencyId, row]));
  const current: CompetencyMarkView[] = currentRows.map((row) => {
    const mark = byId.get(row.id);
    return { ...row, status: mark?.status ?? "", note: mark?.note ?? "", outside: false };
  });
  const allowed = new Set(currentRows.map((row) => row.id));
  const outside: CompetencyMarkView[] = stored
    .filter((row) => !allowed.has(row.competencyId) && row.type !== "duty")
    .map((row) => ({
      id: row.competencyId,
      name: row.name,
      section: sectionForType(row.type) === "technical" ? ("technical" as const) : ("personal" as const),
      onlyInTarget: false,
      criteria: null,
      status: row.status,
      note: row.note ?? "",
      outside: true,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const summary: CompetencyMarkSummary = { unmarked: 0, has: 0, lacks: 0, inProgress: 0 };
  for (const row of current) {
    if (row.status === "has") summary.has += 1;
    else if (row.status === "lacks") summary.lacks += 1;
    else if (row.status === "in_progress") summary.inProgress += 1;
    else summary.unmarked += 1;
  }
  return { current, outside, summary };
}

export type CompetencyLink = typeof competencyLinks.$inferSelect;

/** Ссылки на материалы: компетенция → ссылки в порядке `sort_order`. */
export function listCompetencyLinks() {
  ensureSchema();
  const rows = getDb()
    .select()
    .from(competencyLinks)
    .orderBy(asc(competencyLinks.sortOrder), asc(competencyLinks.id))
    .all();
  const byCompetency = new Map<string, CompetencyLink[]>();
  for (const row of rows) {
    byCompetency.set(row.competencyId, [...(byCompetency.get(row.competencyId) ?? []), row]);
  }
  return byCompetency;
}

export function listIdps(employeeId: string) {
  ensureSchema();
  return getDb()
    .select()
    .from(idps)
    .where(eq(idps.employeeId, employeeId))
    .orderBy(asc(idps.updatedAt))
    .all()
    .reverse();
}

export function listIdpsVisibleTo(actor: { id: string; isAdmin: boolean }) {
  ensureSchema();
  const rows = getDb().select().from(idps).orderBy(desc(idps.updatedAt)).all();
  if (actor.isAdmin) return rows;
  const managerByEmployee = new Map(listEmployees().map((row) => [row.id, row.managerId]));
  return rows.filter((idp) => idp.employeeId === actor.id || managerByEmployee.get(idp.employeeId) === actor.id);
}

export function activeIdpEmployeeIds() {
  ensureSchema();
  return new Set(
    getDb()
      .select({ employeeId: idps.employeeId })
      .from(idps)
      .where(eq(idps.status, "active"))
      .all()
      .map((row) => row.employeeId),
  );
}

export function getIdp(id: string) {
  ensureSchema();
  return getDb().select().from(idps).where(eq(idps.id, id)).get();
}

export function listIdpItems(idpId: string) {
  ensureSchema();
  return getDb().select().from(idpItems).where(eq(idpItems.idpId, idpId)).orderBy(asc(idpItems.sortOrder)).all();
}

export function listIdpAcceptance(idpIds: string[]) {
  ensureSchema();
  if (idpIds.length === 0) return [];
  return getDb()
    .select({ idpId: idpItems.idpId, acceptedAt: idpItems.acceptedAt })
    .from(idpItems)
    .where(inArray(idpItems.idpId, idpIds))
    .all();
}

export function listIdpPool(idpId: string) {
  ensureSchema();
  return getDb().select().from(idpPool).where(eq(idpPool.idpId, idpId)).orderBy(asc(idpPool.competencyName)).all();
}

export function listIdpAssignments(competencyId?: string) {
  ensureSchema();
  if (competencyId) {
    return getDb()
      .select()
      .from(idpAssignments)
      .where(eq(idpAssignments.competencyId, competencyId))
      .orderBy(asc(idpAssignments.name))
      .all();
  }
  return getDb().select().from(idpAssignments).orderBy(asc(idpAssignments.name)).all();
}

export function listActiveIdpAssignments(competencyId: string) {
  return listIdpAssignments(competencyId).filter((row) => row.archived === 0);
}

export function listActiveIdpAssignmentsFor(competencyIds: string[]) {
  ensureSchema();
  if (competencyIds.length === 0) return [];
  return getDb()
    .select()
    .from(idpAssignments)
    .where(and(inArray(idpAssignments.competencyId, competencyIds), eq(idpAssignments.archived, 0)))
    .orderBy(asc(idpAssignments.name))
    .all();
}

export function getIdpAssignment(id: string) {
  ensureSchema();
  return getDb().select().from(idpAssignments).where(eq(idpAssignments.id, id)).get();
}

export type AssignmentTestQuestion = { id: string; prompt: string; options: { id: string; text: string; isCorrect: boolean }[] };

/** Тест справочника. Верный вариант виден только редактору карточки. */
export function listAssignmentTest(assignmentId: string): AssignmentTestQuestion[] {
  ensureSchema();
  const db = getDb();
  const questions = db
    .select()
    .from(idpAssignmentQuestions)
    .where(eq(idpAssignmentQuestions.assignmentId, assignmentId))
    .orderBy(asc(idpAssignmentQuestions.sortOrder))
    .all();
  return questions.map((question) => ({
    id: question.id,
    prompt: question.prompt,
    options: db
      .select()
      .from(idpAssignmentOptions)
      .where(eq(idpAssignmentOptions.questionId, question.id))
      .orderBy(asc(idpAssignmentOptions.sortOrder))
      .all()
      .map((option) => ({ id: option.id, text: option.text, isCorrect: option.isCorrect === 1 })),
  }));
}

export function listItemQuestionPrompts(itemIds: number[]) {
  ensureSchema();
  const prompts = new Map<number, string[]>();
  if (itemIds.length === 0) return prompts;
  const questions = getDb()
    .select()
    .from(idpItemQuestions)
    .where(inArray(idpItemQuestions.itemId, itemIds))
    .orderBy(asc(idpItemQuestions.sortOrder))
    .all();
  for (const question of questions) {
    const list = prompts.get(question.itemId) ?? [];
    list.push(question.prompt);
    prompts.set(question.itemId, list);
  }
  return prompts;
}

export type ItemTestForTake = { id: string; prompt: string; options: { id: string; text: string }[] };

/** Вопросы строки без признака верного ответа: его нельзя отдавать на страницу. */
export function listItemTestsForTake(itemIds: number[]) {
  ensureSchema();
  const tests = new Map<number, ItemTestForTake[]>();
  if (itemIds.length === 0) return tests;
  const db = getDb();
  const questions = db
    .select({
      id: idpItemQuestions.id,
      itemId: idpItemQuestions.itemId,
      prompt: idpItemQuestions.prompt,
      sortOrder: idpItemQuestions.sortOrder,
    })
    .from(idpItemQuestions)
    .where(inArray(idpItemQuestions.itemId, itemIds))
    .orderBy(asc(idpItemQuestions.sortOrder))
    .all();
  for (const question of questions) {
    const options = db
      .select({ id: idpItemOptions.id, text: idpItemOptions.text })
      .from(idpItemOptions)
      .where(eq(idpItemOptions.questionId, question.id))
      .orderBy(asc(idpItemOptions.sortOrder))
      .all();
    const list = tests.get(question.itemId) ?? [];
    list.push({ id: question.id, prompt: question.prompt, options });
    tests.set(question.itemId, list);
  }
  return tests;
}

export function listItemAttemptState(itemIds: number[]) {
  ensureSchema();
  const state = new Map<number, { count: number; passed: boolean | null }>();
  if (itemIds.length === 0) return state;
  const rows = getDb()
    .select()
    .from(idpItemAttempts)
    .where(inArray(idpItemAttempts.itemId, itemIds))
    .orderBy(asc(idpItemAttempts.createdAt), asc(sql`rowid`))
    .all();
  for (const row of rows) {
    const current = state.get(row.itemId) ?? { count: 0, passed: null };
    current.count += 1;
    current.passed = row.passed === 1;
    state.set(row.itemId, current);
  }
  return state;
}

export function assignmentCompetencies() {
  const all = listCompetencies();
  return all.filter((c) => c.type !== "duty" && !all.some((x) => x.parentId === c.id));
}

export function jobsWithProfiles() {
  ensureSchema();
  const profiled = new Set(getDb().select().from(profiles).all().map((p) => p.jobId));
  return listJobs().filter((job) => profiled.has(job.id));
}
