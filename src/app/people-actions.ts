"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb, now } from "@/db";
import { employees, idpItems, idps } from "@/db/schema";
import { requireAdmin, requireEmployee } from "@/lib/auth";
import { gapSnapshot } from "@/lib/gap";
import {
  InvariantError,
  assertManagerLink,
  assertNoSecondActiveIdp,
  assertNotLastAdmin,
  canManageEmployee,
  canTickIdpItem,
} from "@/lib/invariants";
import { hashPassword } from "@/lib/password";
import {
  getActiveIdp,
  getEmployee,
  getEmployeeByLogin,
  getIdp,
  getJob,
  getProfileByJob,
  listIdpItems,
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

function insertGapItems(idpId: string, currentJobId: string, targetJobId: string, startSort = 0) {
  const items = gapSnapshot(currentJobId, targetJobId);
  const db = getDb();
  items.forEach((item, index) => {
    db.insert(idpItems)
      .values({
        idpId,
        kind: "gap",
        competencyId: item.competencyId,
        competencyName: item.competencyName,
        requiredLevel: item.requiredLevel,
        body: null,
        status: "not_started",
        sortOrder: startSort + index,
      })
      .run();
  });
}

function revalidatePeople(employeeId: string, idpId?: string) {
  revalidatePath("/me");
  revalidatePath("/people");
  revalidatePath("/idps");
  revalidatePath(`/people/${employeeId}`);
  if (idpId) revalidatePath(`/idps/${idpId}`);
}

function applyJobSideEffects(employeeId: string, jobId: string, t: number) {
  const active = getActiveIdp(employeeId);
  if (active && active.targetJobId === jobId) {
    getDb().update(idps).set({ status: "completed", updatedAt: t }).where(eq(idps.id, active.id)).run();
  }
}

export async function saveEmployeeAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
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
    if (existing.jobId !== jobId) {
      applyJobSideEffects(idRaw, jobId, t);
    }
    db.update(employees).set(patch).where(eq(employees.id, idRaw)).run();
    revalidatePeople(idRaw);
    return null;
  } catch (error) {
    if (isUniqueConstraint(error)) return { error: "Такой логин уже есть" };
    return asActionError(error);
  }
}

export async function assignJobAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const actor = await requireEmployee();
    const employeeId = String(formData.get("employeeId") ?? "");
    const jobId = String(formData.get("jobId") ?? "");
    if (!canManageEmployee(actor, employeeId)) {
      throw new InvariantError("Нельзя менять должность этого сотрудника");
    }
    if (!getJob(jobId)) throw new InvariantError("Должность не найдена");
    const t = now();
    applyJobSideEffects(employeeId, jobId, t);
    getDb().update(employees).set({ jobId, updatedAt: t }).where(eq(employees.id, employeeId)).run();
    revalidatePeople(employeeId);
    return null;
  } catch (error) {
    return asActionError(error);
  }
}

export async function deactivateEmployeeAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
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
    return asActionError(error);
  }
}

export async function createIdpAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const actor = await requireEmployee();
    const employeeId = String(formData.get("employeeId") ?? "");
    const targetJobId = String(formData.get("targetJobId") ?? "");
    if (!canManageEmployee(actor, employeeId)) {
      throw new InvariantError("Нельзя завести ИПР этому сотруднику");
    }
    const employee = getEmployee(employeeId);
    if (!employee || employee.isActive !== 1) throw new InvariantError("Сотрудник не найден");
    if (!getProfileByJob(targetJobId)) throw new InvariantError("У целевой должности нет профиля");
    assertNoSecondActiveIdp(employeeId);
    const id = newId("idp");
    getDb()
      .insert(idps)
      .values({
        id,
        employeeId,
        sourceJobId: employee.jobId,
        targetJobId,
        createdById: actor.id,
        status: "active",
        updatedAt: now(),
      })
      .run();
    insertGapItems(id, employee.jobId, targetJobId);
    revalidatePeople(employeeId, id);
    return null;
  } catch (error) {
    if (isUniqueConstraint(error)) return { error: "У сотрудника уже есть активный ИПР" };
    return asActionError(error);
  }
}

export async function addFreeIdpItemAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const actor = await requireEmployee();
    const idpId = String(formData.get("idpId") ?? "");
    const body = String(formData.get("body") ?? "").trim();
    if (!body) throw new InvariantError("Нужен текст пункта");
    const idp = getIdp(idpId);
    if (!idp || idp.status !== "active") throw new InvariantError("Активный ИПР не найден");
    if (!canManageEmployee(actor, idp.employeeId)) {
      throw new InvariantError("Нельзя править этот ИПР");
    }
    const existing = listIdpItems(idpId);
    const sortOrder = existing.reduce((m, item) => Math.max(m, item.sortOrder), -1) + 1;
    getDb()
      .insert(idpItems)
      .values({
        idpId,
        kind: "free",
        competencyId: null,
        competencyName: null,
        requiredLevel: null,
        body,
        status: "not_started",
        sortOrder,
      })
      .run();
    revalidatePeople(idp.employeeId, idp.id);
    return null;
  } catch (error) {
    return asActionError(error);
  }
}

export async function refreshIdpSnapshotAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const actor = await requireEmployee();
    const idpId = String(formData.get("idpId") ?? "");
    const idp = getIdp(idpId);
    if (!idp || idp.status !== "active") throw new InvariantError("Активный ИПР не найден");
    if (!canManageEmployee(actor, idp.employeeId)) {
      throw new InvariantError("Нельзя обновить этот ИПР");
    }
    const employee = getEmployee(idp.employeeId);
    if (!employee) throw new InvariantError("Сотрудник не найден");
    const next = gapSnapshot(employee.jobId, idp.targetJobId);
    const nextIds = new Set(next.map((item) => item.competencyId));
    const db = getDb();
    const current = listIdpItems(idpId);
    for (const item of current) {
      if (item.kind !== "gap") continue;
      if (!item.competencyId || !nextIds.has(item.competencyId)) {
        db.delete(idpItems).where(eq(idpItems.id, item.id)).run();
      }
    }
    const kept = listIdpItems(idpId).filter((item) => item.kind === "gap");
    const keptIds = new Set(kept.map((item) => item.competencyId));
    let sort = current.reduce((m, item) => Math.max(m, item.sortOrder), -1) + 1;
    for (const item of next) {
      if (keptIds.has(item.competencyId)) continue;
      db.insert(idpItems)
        .values({
          idpId,
          kind: "gap",
          competencyId: item.competencyId,
          competencyName: item.competencyName,
          requiredLevel: item.requiredLevel,
          body: null,
          status: "not_started",
          sortOrder: sort,
        })
        .run();
      sort += 1;
    }
    db.update(idps).set({ updatedAt: now() }).where(eq(idps.id, idpId)).run();
    revalidatePeople(idp.employeeId, idp.id);
    return null;
  } catch (error) {
    return asActionError(error);
  }
}

export async function setIdpItemStatusAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const actor = await requireEmployee();
    const itemId = Number(formData.get("itemId"));
    const status = String(formData.get("status") ?? "") as "not_started" | "in_progress" | "done";
    if (!["not_started", "in_progress", "done"].includes(status)) {
      throw new InvariantError("Неизвестный статус пункта");
    }
    const item = getDb().select().from(idpItems).where(eq(idpItems.id, itemId)).get();
    if (!item) throw new InvariantError("Пункт не найден");
    const idp = getIdp(item.idpId);
    if (!idp || idp.status !== "active") throw new InvariantError("Активный ИПР не найден");
    if (!canTickIdpItem(actor, idp.employeeId)) {
      throw new InvariantError("Нельзя отмечать чужой ИПР");
    }
    getDb().update(idpItems).set({ status }).where(eq(idpItems.id, itemId)).run();
    revalidatePeople(idp.employeeId, idp.id);
    return null;
  } catch (error) {
    return asActionError(error);
  }
}

export async function closeIdpAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const actor = await requireEmployee();
    const idpId = String(formData.get("idpId") ?? "");
    const status = String(formData.get("status") ?? "") as "completed" | "cancelled";
    if (status !== "completed" && status !== "cancelled") {
      throw new InvariantError("ИПР закрывают как выполнен или отменён");
    }
    const idp = getIdp(idpId);
    if (!idp || idp.status !== "active") throw new InvariantError("Активный ИПР не найден");
    if (!canManageEmployee(actor, idp.employeeId)) {
      throw new InvariantError("Нельзя закрыть этот ИПР");
    }
    getDb().update(idps).set({ status, updatedAt: now() }).where(eq(idps.id, idpId)).run();
    revalidatePeople(idp.employeeId, idp.id);
    return null;
  } catch (error) {
    return asActionError(error);
  }
}
