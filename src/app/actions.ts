"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb, now } from "@/db";
import { competencies, jobTransitions, jobs, profileSkills, profiles } from "@/db/schema";
import { clearAdminCookie, requireAdmin, setAdminCookie, verifyPassword } from "@/lib/auth";
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

function isNextControlFlow(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    String((error as { digest?: unknown }).digest).startsWith("NEXT_")
  );
}

function fail(error: unknown): never {
  if (isNextControlFlow(error)) throw error;
  if (error instanceof InvariantError) throw error;
  if (error instanceof Error) throw error;
  throw new Error("Неизвестная ошибка");
}

export async function loginAction(_prev: unknown, formData: FormData) {
  const password = String(formData.get("password") ?? "");
  if (!verifyPassword(password)) {
    return { ok: false as const, error: "Неверный пароль" };
  }
  await setAdminCookie();
  redirect("/");
}

export async function logoutAction() {
  await clearAdminCookie();
  redirect("/");
}

export async function saveJobAction(formData: FormData) {
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
  } catch (error) {
    fail(error);
  }
}

export async function deleteJobAction(formData: FormData) {
  try {
    await requireAdmin();
    const id = String(formData.get("id") ?? "");
    assertJobDeletable(id);
    getDb().delete(jobs).where(eq(jobs.id, id)).run();
    revalidatePath("/");
    redirect("/");
  } catch (error) {
    fail(error);
  }
}

export async function addTransitionAction(formData: FormData) {
  try {
    await requireAdmin();
    const fromJobId = String(formData.get("fromJobId") ?? "");
    const toJobId = String(formData.get("toJobId") ?? "");
    const kind = String(formData.get("kind") ?? "") as "linear" | "level_change";
    assertTransition(fromJobId, toJobId);
    if (kind !== "linear" && kind !== "level_change") {
      throw new InvariantError("Тип ребра: linear или level_change");
    }
    getDb().insert(jobTransitions).values({ fromJobId, toJobId, kind }).run();
    revalidatePath("/");
    revalidatePath(`/jobs/${fromJobId}`);
  } catch (error) {
    fail(error);
  }
}

export async function deleteTransitionAction(formData: FormData) {
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
  } catch (error) {
    fail(error);
  }
}

export async function saveCompetencyAction(formData: FormData) {
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
  } catch (error) {
    fail(error);
  }
}

export async function deleteCompetencyAction(formData: FormData) {
  try {
    await requireAdmin();
    const id = String(formData.get("id") ?? "");
    assertCompetencyDeletable(id);
    getDb().delete(competencies).where(eq(competencies.id, id)).run();
    revalidatePath("/admin/competencies");
  } catch (error) {
    fail(error);
  }
}

export async function upsertSkillAction(formData: FormData) {
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
    const level = competency.type === "duty" ? null : Number(levelRaw);
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
  } catch (error) {
    fail(error);
  }
}

export async function deleteSkillAction(formData: FormData) {
  try {
    await requireAdmin();
    const jobId = String(formData.get("jobId") ?? "");
    const skillId = Number(formData.get("skillId"));
    getDb().delete(profileSkills).where(eq(profileSkills.id, skillId)).run();
    revalidatePath(`/jobs/${jobId}/profile`);
    revalidatePath("/compare");
  } catch (error) {
    fail(error);
  }
}

export async function createProfileAction(formData: FormData) {
  try {
    await requireAdmin();
    const jobId = String(formData.get("jobId") ?? "");
    const db = getDb();
    if (db.select().from(profiles).where(eq(profiles.jobId, jobId)).get()) {
      throw new InvariantError("Профиль уже есть");
    }
    db.insert(profiles).values({ id: `profile-${jobId}`, jobId, updatedAt: now() }).run();
    revalidatePath(`/jobs/${jobId}`);
    redirect(`/jobs/${jobId}/profile`);
  } catch (error) {
    fail(error);
  }
}
