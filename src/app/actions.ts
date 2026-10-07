"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getDb, now, retryIfClosed } from "@/db";
import { competencies, employeeCompetencyMarks, jobTransitions, jobs, profileSkills, profiles } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
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
import { getCompetency } from "@/lib/queries";
import type { ActionResult } from "@/lib/action-result";

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
    assertCompetencyTree(parentId, type);
    assertCompetencyNameUnique(id, parentId, name);
    const db = getDb();
    const existing = db.select().from(competencies).where(eq(competencies.id, id)).get();
    if (existing) {
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
    revalidatePath("/admin/competencies");
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
    db.delete(competencies).where(eq(competencies.id, id)).run();
    revalidatePath("/admin/competencies");
    return null;
  } catch (error) {
    if (retryIfClosed(error, retried)) return deleteCompetencyAction(_prev, formData, true);
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
