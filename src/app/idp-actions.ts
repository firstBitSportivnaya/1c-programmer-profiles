"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb, now, retryIfClosed } from "@/db";
import { idpAssignments, idpItems, idps } from "@/db/schema";
import { requireEmployee, type SessionEmployee } from "@/lib/auth";
import {
  expandIdpPool,
  fillIdpPool,
  getIdpItem,
  maybeCompleteIdp,
  nextItemSort,
  parseOptionalDue,
  parsePeriod,
} from "@/lib/idp";
import {
  InvariantError,
  assertNoSecondActiveIdp,
  canEditAssignmentCatalog,
  canManageEmployee,
  canTickIdpItem,
} from "@/lib/invariants";
import {
  getCompetency,
  getEmployee,
  getIdp,
  getIdpAssignment,
  getProfileByJob,
  listActiveIdpAssignments,
  listIdpPool,
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

function revalidateIdp(employeeId: string, idpId?: string) {
  revalidatePath("/me");
  revalidatePath("/people");
  revalidatePath("/idps");
  revalidatePath("/assignments");
  revalidatePath(`/people/${employeeId}`);
  if (idpId) revalidatePath(`/idps/${idpId}`);
}

function readAssignmentTexts(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const learnText = String(formData.get("learnText") ?? "").trim();
  const verifyText = String(formData.get("verifyText") ?? "").trim();
  if (!name || !learnText || !verifyText) {
    throw new InvariantError("Нужны название, узнать и проверить");
  }
  return { name, learnText, verifyText };
}

function assertAssignableCompetency(competencyId: string) {
  const competency = getCompetency(competencyId);
  if (!competency || competency.type === "duty") {
    throw new InvariantError("Задание только к компетенции, не к обязанности");
  }
  return competency;
}

function requireActiveManagedIdp(actor: SessionEmployee, idpId: string) {
  const idp = getIdp(idpId);
  if (!idp || idp.status !== "active") throw new InvariantError("Активный ИПР не найден");
  if (!canManageEmployee(actor, idp.employeeId)) {
    throw new InvariantError("Нельзя править этот ИПР");
  }
  return idp;
}

function poolRow(idpId: string, competencyId: string) {
  const row = listIdpPool(idpId).find((item) => item.competencyId === competencyId);
  if (!row) throw new InvariantError("Этой компетенции нет в разрыве этого ИПР");
  return row;
}

export async function createIdpAction(_prev: ActionResult, formData: FormData, retried = false): Promise<ActionResult> {
  try {
    const actor = await requireEmployee();
    const employeeId = String(formData.get("employeeId") ?? "");
    const targetJobId = String(formData.get("targetJobId") ?? "");
    const { periodStart, periodEnd } = parsePeriod(
      String(formData.get("periodStart") ?? ""),
      String(formData.get("periodEnd") ?? ""),
    );
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
        periodStart,
        periodEnd,
        status: "active",
        updatedAt: now(),
      })
      .run();
    fillIdpPool(id, employee.jobId, targetJobId);
    revalidateIdp(employeeId, id);
    return null;
  } catch (error) {
    if (retryIfClosed(error, retried)) return createIdpAction(_prev, formData, true);
    if (isUniqueConstraint(error)) return { error: "У сотрудника уже есть активный ИПР" };
    return asActionError(error);
  }
}

export async function refreshIdpPoolAction(_prev: ActionResult, formData: FormData, retried = false): Promise<ActionResult> {
  try {
    const actor = await requireEmployee();
    const idp = requireActiveManagedIdp(actor, String(formData.get("idpId") ?? ""));
    expandIdpPool(idp.id, idp.sourceJobId, idp.targetJobId);
    getDb().update(idps).set({ updatedAt: now() }).where(eq(idps.id, idp.id)).run();
    revalidateIdp(idp.employeeId, idp.id);
    return null;
  } catch (error) {
    if (retryIfClosed(error, retried)) return refreshIdpPoolAction(_prev, formData, true);
    return asActionError(error);
  }
}

export async function cancelIdpAction(_prev: ActionResult, formData: FormData, retried = false): Promise<ActionResult> {
  try {
    const actor = await requireEmployee();
    const idp = requireActiveManagedIdp(actor, String(formData.get("idpId") ?? ""));
    getDb().update(idps).set({ status: "cancelled", updatedAt: now() }).where(eq(idps.id, idp.id)).run();
    revalidateIdp(idp.employeeId, idp.id);
    return null;
  } catch (error) {
    if (retryIfClosed(error, retried)) return cancelIdpAction(_prev, formData, true);
    return asActionError(error);
  }
}

export async function addIdpItemAction(_prev: ActionResult, formData: FormData, retried = false): Promise<ActionResult> {
    try {
      const actor = await requireEmployee();
      const idp = requireActiveManagedIdp(actor, String(formData.get("idpId") ?? ""));
      const competencyIdRaw = String(formData.get("competencyId") ?? "");
      const assignmentId = String(formData.get("assignmentId") ?? "").trim();
      const dueOn = parseOptionalDue(String(formData.get("dueOn") ?? ""), idp.periodStart, idp.periodEnd);
      const db = getDb();
      let competencyId = competencyIdRaw;
      let assignmentName: string;
      let learnText: string;
      let verifyText: string;
      let catalogId: string | null = null;
      if (assignmentId) {
        const catalog = getIdpAssignment(assignmentId);
        if (!catalog || catalog.archived !== 0) {
          throw new InvariantError("Задание не найдено в справочнике");
        }
        competencyId = catalog.competencyId;
        assignmentName = catalog.name;
        learnText = catalog.learnText;
        verifyText = catalog.verifyText;
        catalogId = catalog.id;
      } else {
        const texts = readAssignmentTexts(formData);
        const existing = listActiveIdpAssignments(competencyId).find(
          (row) => row.name.toLowerCase() === texts.name.toLowerCase(),
        );
        if (existing) {
          assignmentName = existing.name;
          learnText = existing.learnText;
          verifyText = existing.verifyText;
          catalogId = existing.id;
        } else {
          const created = insertCatalogAssignment(competencyId, texts);
          assignmentName = created.name;
          learnText = created.learnText;
          verifyText = created.verifyText;
          catalogId = created.id;
        }
      }
      const pool = poolRow(idp.id, competencyId);
      assertAssignableCompetency(competencyId);
      db.insert(idpItems)
        .values({
          idpId: idp.id,
          assignmentId: catalogId,
          competencyId,
          competencyName: pool.competencyName,
          requiredLevel: pool.requiredLevel,
          assignmentName,
          learnText,
          verifyText,
          dueOn,
          status: "not_started",
          acceptedById: null,
          acceptedAt: null,
          sortOrder: nextItemSort(idp.id),
        })
        .run();
      db.update(idps).set({ updatedAt: now() }).where(eq(idps.id, idp.id)).run();
      revalidateIdp(idp.employeeId, idp.id);
      return null;
    } catch (error) {
      if (retryIfClosed(error, retried)) return addIdpItemAction(_prev, formData, true);
      if (isUniqueConstraint(error)) return { error: "Такое задание уже есть в справочнике этой компетенции" };
      return asActionError(error);
    }
}

export async function updateIdpItemAction(_prev: ActionResult, formData: FormData, retried = false): Promise<ActionResult> {
  try {
    const actor = await requireEmployee();
    const item = getIdpItem(Number(formData.get("itemId")));
    if (!item) throw new InvariantError("Задание не найдено");
    const idp = requireActiveManagedIdp(actor, item.idpId);
    const texts = readAssignmentTexts(formData);
    const dueOn = parseOptionalDue(String(formData.get("dueOn") ?? ""), idp.periodStart, idp.periodEnd);
    getDb()
      .update(idpItems)
      .set({
        assignmentName: texts.name,
        learnText: texts.learnText,
        verifyText: texts.verifyText,
        dueOn,
      })
      .where(eq(idpItems.id, item.id))
      .run();
    revalidateIdp(idp.employeeId, idp.id);
    return null;
  } catch (error) {
    if (retryIfClosed(error, retried)) return updateIdpItemAction(_prev, formData, true);
    return asActionError(error);
  }
}

export async function deleteIdpItemAction(_prev: ActionResult, formData: FormData, retried = false): Promise<ActionResult> {
  try {
    const actor = await requireEmployee();
    const item = getIdpItem(Number(formData.get("itemId")));
    if (!item) throw new InvariantError("Задание не найдено");
    const idp = requireActiveManagedIdp(actor, item.idpId);
    getDb().delete(idpItems).where(eq(idpItems.id, item.id)).run();
    maybeCompleteIdp(idp.id);
    revalidateIdp(idp.employeeId, idp.id);
    return null;
  } catch (error) {
    if (retryIfClosed(error, retried)) return deleteIdpItemAction(_prev, formData, true);
    return asActionError(error);
  }
}

export async function setIdpItemStatusAction(_prev: ActionResult, formData: FormData, retried = false): Promise<ActionResult> {
  try {
    const actor = await requireEmployee();
    const item = getIdpItem(Number(formData.get("itemId")));
    if (!item) throw new InvariantError("Задание не найдено");
    const idp = getIdp(item.idpId);
    if (!idp || idp.status !== "active") throw new InvariantError("Активный ИПР не найден");
    if (item.acceptedAt != null) {
      throw new InvariantError("Принятое задание сотрудник не меняет");
    }
    if (!canTickIdpItem(actor, idp.employeeId)) {
      throw new InvariantError("Нельзя отмечать чужой ИПР");
    }
    const status = String(formData.get("status") ?? "") as "not_started" | "in_progress" | "done";
    if (!["not_started", "in_progress", "done"].includes(status)) {
      throw new InvariantError("Неизвестный статус задания");
    }
    getDb().update(idpItems).set({ status }).where(eq(idpItems.id, item.id)).run();
    revalidateIdp(idp.employeeId, idp.id);
    return null;
  } catch (error) {
    if (retryIfClosed(error, retried)) return setIdpItemStatusAction(_prev, formData, true);
    return asActionError(error);
  }
}

export async function acceptIdpItemAction(_prev: ActionResult, formData: FormData, retried = false): Promise<ActionResult> {
  try {
    const actor = await requireEmployee();
    const item = getIdpItem(Number(formData.get("itemId")));
    if (!item) throw new InvariantError("Задание не найдено");
    const idp = requireActiveManagedIdp(actor, item.idpId);
    if (item.acceptedAt != null) throw new InvariantError("Задание уже принято");
    const t = now();
    getDb()
      .update(idpItems)
      .set({
        status: "done",
        acceptedById: actor.id,
        acceptedAt: t,
      })
      .where(eq(idpItems.id, item.id))
      .run();
    maybeCompleteIdp(idp.id);
    revalidateIdp(idp.employeeId, idp.id);
    return null;
  } catch (error) {
    if (retryIfClosed(error, retried)) return acceptIdpItemAction(_prev, formData, true);
    return asActionError(error);
  }
}

export async function unacceptIdpItemAction(_prev: ActionResult, formData: FormData, retried = false): Promise<ActionResult> {
  try {
    const actor = await requireEmployee();
    const item = getIdpItem(Number(formData.get("itemId")));
    if (!item) throw new InvariantError("Задание не найдено");
    const idp = getIdp(item.idpId);
    if (!idp || (idp.status !== "active" && idp.status !== "completed")) {
      throw new InvariantError("ИПР нельзя вернуть в работу");
    }
    if (!canManageEmployee(actor, idp.employeeId)) {
      throw new InvariantError("Нельзя править этот ИПР");
    }
    if (item.acceptedAt == null) throw new InvariantError("Задание ещё не принято");
    getDb()
      .update(idpItems)
      .set({ acceptedById: null, acceptedAt: null })
      .where(eq(idpItems.id, item.id))
      .run();
    if (idp.status === "completed") {
      getDb().update(idps).set({ status: "active", updatedAt: now() }).where(eq(idps.id, idp.id)).run();
    }
    revalidateIdp(idp.employeeId, idp.id);
    return null;
  } catch (error) {
    if (retryIfClosed(error, retried)) return unacceptIdpItemAction(_prev, formData, true);
    return asActionError(error);
  }
}

function insertCatalogAssignment(
  competencyId: string,
  texts: { name: string; learnText: string; verifyText: string },
) {
  assertAssignableCompetency(competencyId);
  const clash = listActiveIdpAssignments(competencyId).find(
    (row) => row.name.toLowerCase() === texts.name.toLowerCase(),
  );
  if (clash) throw new InvariantError("Такое задание уже есть в справочнике этой компетенции");
  const id = newId("asg");
  getDb()
    .insert(idpAssignments)
    .values({
      id,
      competencyId,
      name: texts.name,
      learnText: texts.learnText,
      verifyText: texts.verifyText,
      archived: 0,
      updatedAt: now(),
    })
    .run();
  return { id, ...texts };
}

export async function saveAssignmentAction(_prev: ActionResult, formData: FormData, retried = false): Promise<ActionResult> {
  try {
    const actor = await requireEmployee();
    if (!canEditAssignmentCatalog(actor)) {
      throw new InvariantError("Справочник заданий правят руководители и админ");
    }
    const idRaw = String(formData.get("id") ?? "").trim();
    const competencyId = String(formData.get("competencyId") ?? "");
    const texts = readAssignmentTexts(formData);
    assertAssignableCompetency(competencyId);
    const db = getDb();
    const t = now();
    if (!idRaw) {
      insertCatalogAssignment(competencyId, texts);
      revalidatePath("/assignments");
      return null;
    }
    const existing = getIdpAssignment(idRaw);
    if (!existing) throw new InvariantError("Задание не найдено");
    if (existing.archived !== 0) throw new InvariantError("Скрытое задание сначала верните в справочник");
    if (existing.competencyId !== competencyId) {
      throw new InvariantError("Компетенцию задания не меняют");
    }
    db.update(idpAssignments)
      .set({ name: texts.name, learnText: texts.learnText, verifyText: texts.verifyText, updatedAt: t })
      .where(eq(idpAssignments.id, idRaw))
      .run();
    revalidatePath("/assignments");
    return null;
  } catch (error) {
    if (retryIfClosed(error, retried)) return saveAssignmentAction(_prev, formData, true);
    if (isUniqueConstraint(error)) return { error: "Такое задание уже есть в справочнике этой компетенции" };
    return asActionError(error);
  }
}

export async function archiveAssignmentAction(_prev: ActionResult, formData: FormData, retried = false): Promise<ActionResult> {
  try {
    const actor = await requireEmployee();
    if (!canEditAssignmentCatalog(actor)) {
      throw new InvariantError("Справочник заданий правят руководители и админ");
    }
    const id = String(formData.get("id") ?? "");
    const existing = getIdpAssignment(id);
    if (!existing) throw new InvariantError("Задание не найдено");
    getDb()
      .update(idpAssignments)
      .set({ archived: existing.archived === 0 ? 1 : 0, updatedAt: now() })
      .where(eq(idpAssignments.id, id))
      .run();
    revalidatePath("/assignments");
    return null;
  } catch (error) {
    if (retryIfClosed(error, retried)) return archiveAssignmentAction(_prev, formData, true);
    if (isUniqueConstraint(error)) return { error: "Такое задание уже есть в справочнике этой компетенции" };
    return asActionError(error);
  }
}
