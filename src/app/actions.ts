"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getDb, getSqlite, now, retryIfClosed } from "@/db";
import {
  achievements,
  competencies,
  competencyLinks,
  employeeCompetencyMarks,
  employees,
  jobTransitions,
  jobs,
  profileSkills,
  profiles,
  type CompetencyLinkKind,
} from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { syncEmployeeAchievements } from "@/lib/achievement-rules";
import {
  ACHIEVEMENT_CATEGORIES,
  ACHIEVEMENT_ICONS,
  ACHIEVEMENT_RULE_LABELS,
  ACHIEVEMENT_RULES,
  ruleNeedsParam,
  type AchievementCategory,
  type AchievementIcon,
  type AchievementRule,
} from "@/lib/achievement-catalog";
import {
  InvariantError,
  assertCompetencyDeletable,
  assertCompetencyNameUnique,
  assertCompetencyTree,
  assertJobDeletable,
  assertSkillLevel,
  assertTransition,
  assertTypeChangeAllowed,
} from "@/lib/invariants";
import { getCompetency, getJob } from "@/lib/queries";
import { parseMaterialJson, parseMaterialSheet } from "@/lib/material-workbook";
import { readXlsxSheet } from "@/lib/xlsx-sheet";
import type { ActionResult } from "@/lib/action-result";

function revalidateCompetencyAdmin(id?: string) {
  revalidatePath("/admin/competencies");
  if (id) revalidatePath(`/admin/competencies/${id}`);
  revalidatePath("/jobs/[jobId]/profile", "page");
  revalidatePath("/idps/[idpId]", "page");
}

function revalidateAchievementAdmin(id?: string) {
  revalidatePath("/admin/achievements");
  if (id) revalidatePath(`/admin/achievements/${id}`);
}

/** Закрытые списки каталога (ADR 0010): неизвестное значение из формы не сохраняем. */
function isAchievementCategory(value: string): value is AchievementCategory {
  return (ACHIEVEMENT_CATEGORIES as readonly string[]).includes(value);
}

function isAchievementRule(value: string): value is AchievementRule {
  return (ACHIEVEMENT_RULES as readonly string[]).includes(value);
}

function isAchievementIcon(value: string): value is AchievementIcon {
  return (ACHIEVEMENT_ICONS as readonly string[]).includes(value);
}

/** Ключ каталога — slug: на него ссылаются выдачи, поэтому после создания он не меняется. */
const ACHIEVEMENT_ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Сверка достижений после правки профиля должности (ADR 0010): правила `competency.half-profile`,
 * `competency.full-profile` и `competency.outside-profile` читают набор навыков профиля,
 * поэтому меняются выдачи всех сотрудников этой должности, а не только открытая страница.
 */
function syncProfileAchievements(jobId: string) {
  const rows = getDb()
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.jobId, jobId), eq(employees.isActive, 1)))
    .all();
  for (const row of rows) syncEmployeeAchievements(row.id);
}

function isNextControlFlow(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    String((error as { digest?: unknown }).digest).startsWith("NEXT_")
  );
}

function asActionError(error: unknown): ActionResult {
  if (isNextControlFlow(error)) throw error;
  if (error instanceof InvariantError || error instanceof Error) {
    return { error: error.message };
  }
  return { error: "Неизвестная ошибка" };
}

function isUniqueConstraint(error: unknown) {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

export async function saveJobAction(
  _prev: ActionResult,
  formData: FormData,
  retried = false,
): Promise<ActionResult> {
  try {
    await requireAdmin();
    const id = String(formData.get("id") ?? "").trim();
    const name = String(formData.get("name") ?? "").trim();
    const rankOrder = Number(formData.get("rankOrder"));
    const lane = String(formData.get("lane") ?? "") as "executor" | "manager" | "other";
    const yearsRaw = String(formData.get("yearsRequired") ?? "").trim();
    const professionalStandard = String(formData.get("professionalStandard") ?? "").trim() || null;
    if (!id || !name || Number.isNaN(rankOrder) || !["executor", "manager", "other"].includes(lane)) {
      throw new InvariantError("Заполните идентификатор, название, порядок и ветку");
    }
    const yearsRequired = yearsRaw === "" ? null : Number(yearsRaw);
    const db = getDb();
    const existing = db.select().from(jobs).where(eq(jobs.id, id)).get();
    const t = now();
    if (existing) {
      db.update(jobs)
        .set({ name, rankOrder, lane, yearsRequired, professionalStandard, updatedAt: t })
        .where(eq(jobs.id, id))
        .run();
    } else {
      db.insert(jobs)
        .values({ id, name, rankOrder, lane, yearsRequired, professionalStandard, updatedAt: t })
        .run();
    }
    revalidatePath("/");
    revalidatePath(`/jobs/${id}`);
    revalidatePath(`/jobs/${id}/profile`);
    return null;
  } catch (error) {
    if (retryIfClosed(error, retried)) return saveJobAction(_prev, formData, true);
    if (isUniqueConstraint(error)) return { error: "Должность с таким id или названием уже есть" };
    return asActionError(error);
  }
}

export async function deleteJobAction(
  _prev: ActionResult,
  formData: FormData,
  retried = false,
): Promise<ActionResult> {
  try {
    await requireAdmin();
    const id = String(formData.get("id") ?? "");
    assertJobDeletable(id);
    getDb().delete(jobs).where(eq(jobs.id, id)).run();
    revalidatePath("/");
    revalidatePath(`/jobs/${id}`);
    revalidatePath(`/jobs/${id}/profile`);
    return null;
  } catch (error) {
    if (retryIfClosed(error, retried)) return deleteJobAction(_prev, formData, true);
    return asActionError(error);
  }
}

export async function addTransitionAction(
  _prev: ActionResult,
  formData: FormData,
  retried = false,
): Promise<ActionResult> {
  try {
    await requireAdmin();
    const fromJobId = String(formData.get("fromJobId") ?? "");
    const toJobId = String(formData.get("toJobId") ?? "");
    const kind = String(formData.get("kind") ?? "") as "linear" | "level_change";
    assertTransition(fromJobId, toJobId);
    if (kind !== "linear" && kind !== "level_change") {
      throw new InvariantError("Тип ребра: linear или level_change");
    }
    const db = getDb();
    const dup = db
      .select()
      .from(jobTransitions)
      .where(and(eq(jobTransitions.fromJobId, fromJobId), eq(jobTransitions.toJobId, toJobId)))
      .get();
    if (dup) throw new InvariantError("Такое ребро уже есть");
    db.insert(jobTransitions).values({ fromJobId, toJobId, kind }).run();
    revalidatePath("/");
    revalidatePath(`/jobs/${fromJobId}`);
    revalidatePath(`/jobs/${fromJobId}/profile`);
    return null;
  } catch (error) {
    if (retryIfClosed(error, retried)) return addTransitionAction(_prev, formData, true);
    if (isUniqueConstraint(error)) return { error: "Такое ребро уже есть" };
    return asActionError(error);
  }
}

export async function deleteTransitionAction(
  _prev: ActionResult,
  formData: FormData,
  retried = false,
): Promise<ActionResult> {
  try {
    await requireAdmin();
    const fromJobId = String(formData.get("fromJobId") ?? "");
    const toJobId = String(formData.get("toJobId") ?? "");
    getDb()
      .delete(jobTransitions)
      .where(and(eq(jobTransitions.fromJobId, fromJobId), eq(jobTransitions.toJobId, toJobId)))
      .run();
    revalidatePath("/");
    revalidatePath(`/jobs/${fromJobId}`);
    revalidatePath(`/jobs/${fromJobId}/profile`);
    return null;
  } catch (error) {
    if (retryIfClosed(error, retried)) return deleteTransitionAction(_prev, formData, true);
    return asActionError(error);
  }
}

export async function saveCompetencyAction(
  _prev: ActionResult,
  formData: FormData,
  retried = false,
): Promise<ActionResult> {
  try {
    await requireAdmin();
    const id = String(formData.get("id") ?? "").trim();
    const name = String(formData.get("name") ?? "").trim();
    const type = String(formData.get("type") ?? "") as "professional" | "universal" | "duty";
    const parentId = String(formData.get("parentId") ?? "").trim() || null;
    const description = String(formData.get("description") ?? "").trim() || null;
    if (!id || !name) throw new InvariantError("Нужны id и название");
    if (id === "new") throw new InvariantError("Идентификатор new зарезервирован");
    const creating = formData.get("create") === "1";
    assertCompetencyTree(parentId, type);
    assertCompetencyNameUnique(id, parentId, name);
    const db = getDb();
    const existing = db.select().from(competencies).where(eq(competencies.id, id)).get();
    if (existing) {
      if (creating) throw new InvariantError("Идентификатор уже занят");
      assertTypeChangeAllowed(id, type);
      db.update(competencies)
        .set({ name, type, parentId, description, updatedAt: now() })
        .where(eq(competencies.id, id))
        .run();
    } else {
      db.insert(competencies)
        .values({ id, name, type, parentId, description, updatedAt: now() })
        .run();
    }
    revalidateCompetencyAdmin(id);
    return null;
  } catch (error) {
    if (retryIfClosed(error, retried)) return saveCompetencyAction(_prev, formData, true);
    if (isUniqueConstraint(error)) return { error: "Имя компетенции должно быть уникально среди соседей" };
    return asActionError(error);
  }
}

export async function deleteCompetencyAction(
  _prev: ActionResult,
  formData: FormData,
  retried = false,
): Promise<ActionResult> {
  try {
    await requireAdmin();
    const id = String(formData.get("id") ?? "");
    assertCompetencyDeletable(id);
    const db = getDb();
    db.delete(employeeCompetencyMarks).where(eq(employeeCompetencyMarks.competencyId, id)).run();
    db.delete(competencyLinks).where(eq(competencyLinks.competencyId, id)).run();
    db.delete(competencies).where(eq(competencies.id, id)).run();
    revalidateCompetencyAdmin(id);
    return null;
  } catch (error) {
    if (retryIfClosed(error, retried)) return deleteCompetencyAction(_prev, formData, true);
    return asActionError(error);
  }
}

const LINK_KINDS: CompetencyLinkKind[] = ["its", "training", "video"];

function assertHttpUrl(raw: string) {
  const protocol = URL.canParse(raw) ? new URL(raw).protocol : "";
  if (protocol !== "http:" && protocol !== "https:") {
    throw new InvariantError("Адрес ссылки: только http:// или https://");
  }
}

export async function addCompetencyLinkAction(
  _prev: ActionResult,
  formData: FormData,
  retried = false,
): Promise<ActionResult> {
  try {
    await requireAdmin();
    const competencyId = String(formData.get("competencyId") ?? "");
    const kind = String(formData.get("kind") ?? "") as CompetencyLinkKind;
    const title = String(formData.get("title") ?? "").trim();
    const url = String(formData.get("url") ?? "").trim();
    if (!getCompetency(competencyId)) throw new InvariantError("Компетенция не найдена");
    if (!LINK_KINDS.includes(kind)) throw new InvariantError("Вид ссылки: ИТС, обучение или видео");
    if (!title) throw new InvariantError("Нужно название ссылки");
    assertHttpUrl(url);
    const db = getDb();
    const siblings = db.select().from(competencyLinks).where(eq(competencyLinks.competencyId, competencyId)).all();
    const sortOrder = siblings.reduce((max, link) => Math.max(max, link.sortOrder), -1) + 1;
    db.insert(competencyLinks).values({ competencyId, kind, title, url, sortOrder, updatedAt: now() }).run();
    revalidateCompetencyAdmin(competencyId);
    return null;
  } catch (error) {
    if (retryIfClosed(error, retried)) return addCompetencyLinkAction(_prev, formData, true);
    return asActionError(error);
  }
}

async function readMaterialImport(
  file: FormDataEntryValue | null,
): Promise<{ error: string } | ReturnType<typeof parseMaterialSheet>> {
  if (!(file instanceof File) || file.size === 0) return { error: "Нужен файл Excel .xlsx или JSON" };
  const name = file.name.toLowerCase();
  if (name.endsWith(".json")) return parseMaterialJson(await file.text());
  if (!name.endsWith(".xlsx")) return { error: "Нужен файл Excel .xlsx или JSON" };
  try {
    return parseMaterialSheet(readXlsxSheet(Buffer.from(await file.arrayBuffer())));
  } catch {
    return { error: "Это не файл Excel" };
  }
}

export async function importCompetencyLinksAction(
  _prev: ActionResult,
  formData: FormData,
  retried = false,
): Promise<ActionResult> {
  try {
    await requireAdmin();
    const file = formData.get("file");
    const parsed = await readMaterialImport(file);
    if ("error" in parsed) return { error: parsed.error };
    const db = getDb();
    const known = new Set(db.select({ id: competencies.id }).from(competencies).all().map((row) => row.id));
    const errors = [...parsed.errors];
    for (const item of parsed.materials) {
      if (!known.has(item.competencyId)) errors.push(`Неизвестная компетенция «${item.competencyId}»`);
    }
    if (errors.length > 0) return { error: errors.join("\n") };

    const counts = getSqlite()
      .transaction((): { added: number; updated: number; kept: number; touched: string[] } => {
        const existing = db.select().from(competencyLinks).all();
        const byKey = new Map(existing.map((link) => [`${link.competencyId}\0${link.url}`, link]));
        const nextOrder = new Map<string, number>();
        for (const link of existing) {
          nextOrder.set(link.competencyId, Math.max(nextOrder.get(link.competencyId) ?? -1, link.sortOrder));
        }
        let added = 0;
        let updated = 0;
        let kept = 0;
        const touched = new Set<string>();
        const t = now();
        for (const item of parsed.materials) {
          const key = `${item.competencyId}\0${item.url}`;
          const current = byKey.get(key);
          if (current) {
            if (current.title === item.title && current.kind === item.kind) {
              kept += 1;
              continue;
            }
            db.update(competencyLinks)
              .set({ title: item.title, kind: item.kind, updatedAt: t })
              .where(eq(competencyLinks.id, current.id))
              .run();
            updated += 1;
            touched.add(item.competencyId);
            continue;
          }
          const sortOrder = (nextOrder.get(item.competencyId) ?? -1) + 1;
          nextOrder.set(item.competencyId, sortOrder);
          db.insert(competencyLinks)
            .values({ competencyId: item.competencyId, kind: item.kind, title: item.title, url: item.url, sortOrder, updatedAt: t })
            .run();
          added += 1;
          touched.add(item.competencyId);
        }
        return { added, updated, kept, touched: [...touched] };
      })
      .deferred(null) as { added: number; updated: number; kept: number; touched: string[] };
    for (const id of counts.touched) revalidateCompetencyAdmin(id);
    if (counts.touched.length === 0) revalidateCompetencyAdmin();
    const parts = [`Добавлено ссылок: ${counts.added}.`];
    if (counts.updated > 0) parts.push(`Обновлено: ${counts.updated}.`);
    if (counts.kept > 0) parts.push(`Уже были: ${counts.kept}.`);
    return { notice: parts.join(" ") };
  } catch (error) {
    if (retryIfClosed(error, retried)) return importCompetencyLinksAction(_prev, formData, true);
    return asActionError(error);
  }
}

export async function deleteCompetencyLinkAction(
  _prev: ActionResult,
  formData: FormData,
  retried = false,
): Promise<ActionResult> {
  try {
    await requireAdmin();
    const id = Number(formData.get("linkId"));
    const db = getDb();
    const link = db.select().from(competencyLinks).where(eq(competencyLinks.id, id)).get();
    db.delete(competencyLinks).where(eq(competencyLinks.id, id)).run();
    revalidateCompetencyAdmin(link?.competencyId);
    return null;
  } catch (error) {
    if (retryIfClosed(error, retried)) return deleteCompetencyLinkAction(_prev, formData, true);
    return asActionError(error);
  }
}

export async function upsertSkillAction(
  _prev: ActionResult,
  formData: FormData,
  retried = false,
): Promise<ActionResult> {
  try {
    await requireAdmin();
    const jobId = String(formData.get("jobId") ?? "");
    const competencyId = String(formData.get("competencyId") ?? "");
    const criteria = String(formData.get("criteria") ?? "").trim() || null;
    const levelRaw = String(formData.get("level") ?? "").trim();
    const db = getDb();
    const profile = db.select().from(profiles).where(eq(profiles.jobId, jobId)).get();
    if (!profile) throw new InvariantError("У должности нет профиля");
    const competency = getCompetency(competencyId);
    if (!competency) throw new InvariantError("Компетенция не найдена");
    const level = competency.type === "duty" ? null : levelRaw === "" ? null : Number(levelRaw);
    assertSkillLevel(competency.type, level);
    const existing = db
      .select()
      .from(profileSkills)
      .where(eq(profileSkills.profileId, profile.id))
      .all()
      .find((s) => s.competencyId === competencyId);
    const t = now();
    if (existing) {
      db.update(profileSkills)
        .set({ level, criteria, updatedAt: t })
        .where(eq(profileSkills.id, existing.id))
        .run();
    } else {
      const maxSort = db.select().from(profileSkills).where(eq(profileSkills.profileId, profile.id)).all();
      const sortOrder = maxSort.reduce((m, s) => Math.max(m, s.sortOrder), -1) + 1;
      db.insert(profileSkills)
        .values({ profileId: profile.id, competencyId, level, criteria, sortOrder, updatedAt: t })
        .run();
    }
    syncProfileAchievements(jobId);
    revalidatePath(`/jobs/${jobId}/profile`);
    revalidatePath("/compare");
    return null;
  } catch (error) {
    if (retryIfClosed(error, retried)) return upsertSkillAction(_prev, formData, true);
    return asActionError(error);
  }
}

export async function deleteSkillAction(
  _prev: ActionResult,
  formData: FormData,
  retried = false,
): Promise<ActionResult> {
  try {
    await requireAdmin();
    const jobId = String(formData.get("jobId") ?? "");
    const skillId = Number(formData.get("skillId"));
    const db = getDb();
    const profile = db.select().from(profiles).where(eq(profiles.jobId, jobId)).get();
    if (!profile) throw new InvariantError("У должности нет профиля");
    const row = db
      .select()
      .from(profileSkills)
      .where(and(eq(profileSkills.id, skillId), eq(profileSkills.profileId, profile.id)))
      .get();
    if (!row) throw new InvariantError("Строка профиля не найдена");
    db.delete(profileSkills).where(eq(profileSkills.id, skillId)).run();
    syncProfileAchievements(jobId);
    revalidatePath(`/jobs/${jobId}/profile`);
    revalidatePath("/compare");
    return null;
  } catch (error) {
    if (retryIfClosed(error, retried)) return deleteSkillAction(_prev, formData, true);
    return asActionError(error);
  }
}

export async function createProfileAction(
  _prev: ActionResult,
  formData: FormData,
  retried = false,
): Promise<ActionResult> {
  try {
    await requireAdmin();
    const jobId = String(formData.get("jobId") ?? "");
    const db = getDb();
    if (db.select().from(profiles).where(eq(profiles.jobId, jobId)).get()) {
      throw new InvariantError("Профиль уже есть");
    }
    db.insert(profiles).values({ id: `profile-${jobId}`, jobId, updatedAt: now() }).run();
    revalidatePath(`/jobs/${jobId}`);
    revalidatePath(`/jobs/${jobId}/profile`);
    return null;
  } catch (error) {
    if (retryIfClosed(error, retried)) return createProfileAction(_prev, formData, true);
    return asActionError(error);
  }
}

/**
 * Создание и правка записи каталога достижений (ADR 0010). Ключ у существующей записи не меняется:
 * поле `id` при правке приходит скрытым, а новые выдачи ссылаются именно на ключ. Скрытие — отдельное
 * действие: правка названия и правила не должна заодно менять доступность выдачи.
 */
export async function saveAchievementAction(
  _prev: ActionResult,
  formData: FormData,
  retried = false,
): Promise<ActionResult> {
  try {
    await requireAdmin();
    const id = String(formData.get("id") ?? "").trim();
    const title = String(formData.get("title") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();
    const category = String(formData.get("category") ?? "");
    const rule = String(formData.get("rule") ?? "");
    const icon = String(formData.get("icon") ?? "");
    const ruleParamRaw = String(formData.get("ruleParam") ?? "").trim();
    if (!ACHIEVEMENT_ID_RE.test(id)) throw new InvariantError("Ключ: латиница, цифры и дефис");
    if (!title) throw new InvariantError("Нужно название");
    if (!description) throw new InvariantError("Нужно описание");
    if (!isAchievementCategory(category)) throw new InvariantError("Категория: выберите из списка");
    if (!isAchievementRule(rule)) throw new InvariantError("Правило: выберите из списка");
    if (!isAchievementIcon(icon)) throw new InvariantError("Иконка: выберите из списка");
    let ruleParam: string | null = null;
    if (ruleNeedsParam(rule)) {
      if (!ruleParamRaw) throw new InvariantError(`Правилу «${ACHIEVEMENT_RULE_LABELS[rule]}» нужна должность`);
      if (!getJob(ruleParamRaw)) throw new InvariantError("Должность не найдена");
      ruleParam = ruleParamRaw;
    }
    const db = getDb();
    const existing = db.select().from(achievements).where(eq(achievements.id, id)).get();
    const creating = formData.get("create") === "1";
    if (creating) {
      if (existing) throw new InvariantError("Ключ уже занят");
      db.insert(achievements)
        .values({ id, title, description, category, rule, ruleParam, icon, archived: 0, updatedAt: now() })
        .run();
    } else {
      if (!existing) throw new InvariantError("Достижение не найдено");
      db.update(achievements)
        .set({ title, description, category, rule, ruleParam, icon, updatedAt: now() })
        .where(eq(achievements.id, id))
        .run();
    }
    revalidateAchievementAdmin(id);
    return null;
  } catch (error) {
    if (retryIfClosed(error, retried)) return saveAchievementAction(_prev, formData, true);
    if (isUniqueConstraint(error)) return { error: "Ключ уже занят" };
    return asActionError(error);
  }
}

/**
 * Скрытие записи вместо удаления (ADR 0010). Выдачи не трогаются: у сотрудников достижение остаётся,
 * а из каталога уходит только предложение выдать его снова.
 */
export async function setAchievementArchivedAction(
  _prev: ActionResult,
  formData: FormData,
  retried = false,
): Promise<ActionResult> {
  try {
    await requireAdmin();
    const id = String(formData.get("id") ?? "").trim();
    const archived = String(formData.get("archived") ?? "") === "1" ? 1 : 0;
    const db = getDb();
    if (!db.select().from(achievements).where(eq(achievements.id, id)).get()) {
      throw new InvariantError("Достижение не найдено");
    }
    db.update(achievements).set({ archived, updatedAt: now() }).where(eq(achievements.id, id)).run();
    revalidateAchievementAdmin(id);
    return null;
  } catch (error) {
    if (retryIfClosed(error, retried)) return setAchievementArchivedAction(_prev, formData, true);
    return asActionError(error);
  }
}
