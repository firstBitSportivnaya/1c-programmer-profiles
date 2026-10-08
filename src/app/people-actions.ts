"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getDb, now, retryIfClosed } from "@/db";
import { employeeCompetencyMarks, employees, idps, type CompetencyMarkStatus } from "@/db/schema";
import { requireAdmin, requireEmployee } from "@/lib/auth";
import {
  InvariantError,
  assertManagerLink,
  assertNotLastAdmin,
  canManageEmployee,
} from "@/lib/invariants";
import { hashPassword } from "@/lib/password";
import {
  getActiveIdp,
  getEmployee,
  getEmployeeByLogin,
  getJob,
  markableCompetencies,
} from "@/lib/queries";
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

function newId(prefix: string) {
  return `${prefix}-${randomBytes(4).toString("hex")}`;
}

function readLogin(formData: FormData) {
  const login = String(formData.get("login") ?? "")
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9._-]{2,40}$/.test(login)) {
    throw new InvariantError("Логин: 2–40 символов, латиница, цифры, точка, дефис");
  }
  return login;
}

function revalidatePeople(employeeId: string, idpId?: string) {
  revalidatePath("/me");
  revalidatePath("/people");
  revalidatePath("/idps");
  revalidatePath("/assignments");
  revalidatePath(`/people/${employeeId}`);
  if (idpId) revalidatePath(`/idps/${idpId}`);
}

export async function saveEmployeeAction(
  _prev: ActionResult,
  formData: FormData,
  retried = false,
): Promise<ActionResult> {
  try {
    await requireAdmin();
    const idRaw = String(formData.get("id") ?? "").trim();
    const login = readLogin(formData);
    const name = String(formData.get("name") ?? "").trim();
    const jobId = String(formData.get("jobId") ?? "").trim();
    const managerId = String(formData.get("managerId") ?? "").trim() || null;
    const password = String(formData.get("password") ?? "");
    const isAdminFlag = String(formData.get("isAdmin") ?? "") === "1" ? 1 : 0;
    if (!name) throw new InvariantError("Нужно имя");
    if (!getJob(jobId)) throw new InvariantError("Должность не найдена");
    const db = getDb();
    const t = now();
    if (!idRaw) {
      if (password.length < 8) throw new InvariantError("Пароль не короче 8 символов");
      if (getEmployeeByLogin(login)) throw new InvariantError("Такой логин уже есть");
      const id = newId("emp");
      assertManagerLink(id, managerId);
      db.insert(employees)
        .values({
          id,
          login,
          name,
          passwordHash: hashPassword(password),
          jobId,
          managerId,
          isAdmin: isAdminFlag,
          isActive: 1,
          updatedAt: t,
        })
        .run();
      revalidatePeople(id);
      return null;
    }
    const existing = getEmployee(idRaw);
    if (!existing) throw new InvariantError("Сотрудник не найден");
    assertManagerLink(idRaw, managerId);
    if (isAdminFlag === 0) assertNotLastAdmin(idRaw);
    const clash = getEmployeeByLogin(login);
    if (clash && clash.id !== idRaw) throw new InvariantError("Такой логин уже есть");
    const patch: {
      login: string;
      name: string;
      jobId: string;
      managerId: string | null;
      isAdmin: number;
      updatedAt: number;
      passwordHash?: string;
    } = {
      login,
      name,
      jobId,
      managerId,
      isAdmin: isAdminFlag,
      updatedAt: t,
    };
    if (password) {
      if (password.length < 8) throw new InvariantError("Пароль не короче 8 символов");
      patch.passwordHash = hashPassword(password);
    }
    db.update(employees).set(patch).where(eq(employees.id, idRaw)).run();
    revalidatePeople(idRaw);
    return null;
  } catch (error) {
    if (retryIfClosed(error, retried)) return saveEmployeeAction(_prev, formData, true);
    if (isUniqueConstraint(error)) return { error: "Такой логин уже есть" };
    return asActionError(error);
  }
}

export async function assignJobAction(
  _prev: ActionResult,
  formData: FormData,
  retried = false,
): Promise<ActionResult> {
  try {
    const actor = await requireEmployee();
    const employeeId = String(formData.get("employeeId") ?? "");
    const jobId = String(formData.get("jobId") ?? "");
    if (!canManageEmployee(actor, employeeId)) {
      throw new InvariantError("Нельзя менять должность этого сотрудника");
    }
    if (!getJob(jobId)) throw new InvariantError("Должность не найдена");
    const t = now();
    getDb().update(employees).set({ jobId, updatedAt: t }).where(eq(employees.id, employeeId)).run();
    revalidatePeople(employeeId);
    return null;
  } catch (error) {
    if (retryIfClosed(error, retried)) return assignJobAction(_prev, formData, true);
    return asActionError(error);
  }
}

const MARK_STATUSES: CompetencyMarkStatus[] = ["has", "lacks", "in_progress"];

/** Ставит или снимает личную пометку навыка у вошедшего сотрудника (ADR 0007). Пустой статус снимает пометку. */
export async function setCompetencyMarkAction(
  _prev: ActionResult,
  formData: FormData,
  retried = false,
): Promise<ActionResult> {
  try {
    const actor = await requireEmployee();
    const competencyId = String(formData.get("competencyId") ?? "");
    const status = String(formData.get("status") ?? "");
    if (status !== "" && !MARK_STATUSES.includes(status as CompetencyMarkStatus)) {
      throw new InvariantError("Пометка: есть, нет или в процессе");
    }
    if (!markableCompetencies(actor.id, actor.jobId).some((row) => row.id === competencyId)) {
      throw new InvariantError("Пометить можно только навык своей должности или цели ИПР");
    }
    const db = getDb();
    const own = and(
      eq(employeeCompetencyMarks.employeeId, actor.id),
      eq(employeeCompetencyMarks.competencyId, competencyId),
    );
    if (status === "") {
      db.delete(employeeCompetencyMarks).where(own).run();
    } else {
      const t = now();
      db.insert(employeeCompetencyMarks)
        .values({ employeeId: actor.id, competencyId, status: status as CompetencyMarkStatus, updatedAt: t })
        .onConflictDoUpdate({
          target: [employeeCompetencyMarks.employeeId, employeeCompetencyMarks.competencyId],
          set: { status: status as CompetencyMarkStatus, updatedAt: t },
        })
        .run();
    }
    revalidatePath("/me");
    return null;
  } catch (error) {
    if (retryIfClosed(error, retried)) return setCompetencyMarkAction(_prev, formData, true);
    return asActionError(error);
  }
}

export async function deactivateEmployeeAction(
  _prev: ActionResult,
  formData: FormData,
  retried = false,
): Promise<ActionResult> {
  try {
    await requireAdmin();
    const employeeId = String(formData.get("employeeId") ?? "");
    const existing = getEmployee(employeeId);
    if (!existing) throw new InvariantError("Сотрудник не найден");
    assertNotLastAdmin(employeeId);
    const t = now();
    const db = getDb();
    const active = getActiveIdp(employeeId);
    if (active) {
      db.update(idps).set({ status: "cancelled", updatedAt: t }).where(eq(idps.id, active.id)).run();
    }
    db.update(employees)
      .set({ isActive: 0, managerId: null, updatedAt: t })
      .where(eq(employees.id, employeeId))
      .run();
    db.update(employees)
      .set({ managerId: null, updatedAt: t })
      .where(eq(employees.managerId, employeeId))
      .run();
    revalidatePeople(employeeId);
    return null;
  } catch (error) {
    if (retryIfClosed(error, retried)) return deactivateEmployeeAction(_prev, formData, true);
    return asActionError(error);
  }
}

