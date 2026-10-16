"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb, getSqlite, now, retryIfClosed } from "@/db";
import {
  idpAssignmentOptions,
  idpAssignmentQuestions,
  idpAssignments,
  idpItemAttempts,
  idpItemOptions,
  idpItemQuestions,
  idpItems,
  idps,
} from "@/db/schema";
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
  listAssignmentTest,
  listCompetencies,
  listIdpAssignments,
  getProfileByJob,
  listActiveIdpAssignments,
  listIdpPool,
} from "@/lib/queries";
import type { ActionResult } from "@/lib/action-result";
import { parseAssignmentSheet, type ParsedAssignment } from "@/lib/assignment-workbook";
import { readXlsxSheet } from "@/lib/xlsx-sheet";

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

function copyAssignmentTest(itemId: number, assignmentId: string | null) {
  if (!assignmentId) return;
  const db = getDb();
  listAssignmentTest(assignmentId).forEach((question, questionIndex) => {
    const questionId = newId("iq");
    db.insert(idpItemQuestions)
      .values({ id: questionId, itemId, prompt: question.prompt, sortOrder: questionIndex })
      .run();
    question.options.forEach((option, optionIndex) => {
      db.insert(idpItemOptions)
        .values({
          id: newId("iopt"),
          questionId,
          text: option.text,
          isCorrect: option.isCorrect ? 1 : 0,
          sortOrder: optionIndex,
        })
        .run();
    });
  });
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
      const idpId = String(formData.get("idpId") ?? "");
      const found = getIdp(idpId);
      if (!found || (found.status !== "active" && found.status !== "completed")) {
        throw new InvariantError("Активный ИПР не найден");
      }
      if (!canManageEmployee(actor, found.employeeId)) {
        throw new InvariantError("Нельзя править этот ИПР");
      }
      const idp = found;
      const competencyIdRaw = String(formData.get("competencyId") ?? "");
      const assignmentId = String(formData.get("assignmentId") ?? "").trim();
      const dueOn = parseOptionalDue(String(formData.get("dueOn") ?? ""), idp.periodStart, idp.periodEnd);
      const db = getDb();
      const pool = poolRow(idp.id, competencyIdRaw);
      assertAssignableCompetency(competencyIdRaw);
      let competencyId = competencyIdRaw;
      let assignmentName: string;
      let learnText: string;
      let verifyText: string;
      let assignmentLevel: number;
      let catalogId: string | null = null;
      if (assignmentId) {
        const catalog = getIdpAssignment(assignmentId);
        if (!catalog || catalog.archived !== 0) {
          throw new InvariantError("Задание не найдено в справочнике");
        }
        if (catalog.competencyId !== competencyIdRaw) {
          throw new InvariantError("Это задание другой компетенции");
        }
        competencyId = competencyIdRaw;
        assignmentName = catalog.name;
        learnText = catalog.learnText;
        verifyText = catalog.verifyText;
        catalogId = catalog.id;
        assignmentLevel = levelForPool(catalog.level, pool.requiredLevel, "Сначала задайте уровень на карточке задания");
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
          assignmentLevel = levelForPool(existing.level, pool.requiredLevel, "Сначала задайте уровень на карточке задания");
        } else {
          const level = levelForPool(parseAssignmentLevel(formData), pool.requiredLevel, "Нужен уровень задания");
          const created = insertCatalogAssignment(competencyId, texts, level);
          assignmentName = created.name;
          learnText = created.learnText;
          verifyText = created.verifyText;
          catalogId = created.id;
          assignmentLevel = level;
        }
      }
      getSqlite()
        .transaction(() => {
          const item = db
            .insert(idpItems)
            .values({
              idpId: idp.id,
              assignmentId: catalogId,
              competencyId,
              competencyName: pool.competencyName,
              requiredLevel: pool.requiredLevel,
              assignmentName,
              assignmentLevel,
              learnText,
              verifyText,
              dueOn,
              status: "not_started",
              acceptedById: null,
              acceptedAt: null,
              sortOrder: nextItemSort(idp.id),
            })
            .returning({ id: idpItems.id })
            .get();
          copyAssignmentTest(item.id, catalogId);
          db.update(idps).set({ status: "active", updatedAt: now() }).where(eq(idps.id, idp.id)).run();
          return true;
        })
        .deferred(null);
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
    const db = getDb();
    const questions = db
      .select({ id: idpItemQuestions.id })
      .from(idpItemQuestions)
      .where(eq(idpItemQuestions.itemId, item.id))
      .all();
    getSqlite()
      .transaction(() => {
        for (const question of questions) {
          db.delete(idpItemOptions).where(eq(idpItemOptions.questionId, question.id)).run();
        }
        db.delete(idpItemQuestions).where(eq(idpItemQuestions.itemId, item.id)).run();
        db.delete(idpItemAttempts).where(eq(idpItemAttempts.itemId, item.id)).run();
        db.delete(idpItems).where(eq(idpItems.id, item.id)).run();
        return true;
      })
      .deferred(null);
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

function parseAssignmentLevel(formData: FormData): number | null {
  const raw = String(formData.get("level") ?? "").trim();
  if (!raw) return null;
  const level = Number(raw);
  if (level !== 1 && level !== 2 && level !== 3) throw new InvariantError("Уровень задания — 1, 2 или 3");
  return level;
}

function levelForPool(level: number | null, requiredLevel: number | null, emptyMessage: string) {
  if (level == null) throw new InvariantError(emptyMessage);
  if (requiredLevel != null && level > requiredLevel) {
    throw new InvariantError("Задание выше планки этой компетенции");
  }
  return level;
}

function insertCatalogAssignment(
  competencyId: string,
  texts: { name: string; learnText: string; verifyText: string },
  level: number | null,
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
      level,
      archived: 0,
      updatedAt: now(),
    })
    .run();
  return { id, ...texts, level };
}

export async function saveAssignmentAction(_prev: ActionResult, formData: FormData, retried = false): Promise<ActionResult> {
  try {
    const actor = await requireEmployee();
    if (!canEditAssignmentCatalog(actor)) {
      throw new InvariantError("Справочник заданий правят руководители и админ");
    }
    const idRaw = String(formData.get("id") ?? "").trim();
    const competencyId = String(formData.get("competencyId") ?? "");
    const db = getDb();
    const t = now();
    if (idRaw) {
      const existing = getIdpAssignment(idRaw);
      if (!existing) throw new InvariantError("Задание не найдено");
      if (existing.archived !== 0) throw new InvariantError("Скрытое задание сначала верните в справочник");
    }
    const level = parseAssignmentLevel(formData);
    const texts = readAssignmentTexts(formData);
    assertAssignableCompetency(competencyId);
    if (!idRaw) {
      const created = insertCatalogAssignment(competencyId, texts, level);
      revalidatePath("/assignments");
      revalidatePath(`/assignments/${created.id}`);
      return { href: `/assignments/${created.id}` };
    }
    const clash = listActiveIdpAssignments(competencyId).find(
      (row) => row.id !== idRaw && row.name.toLowerCase() === texts.name.toLowerCase(),
    );
    if (clash) throw new InvariantError("Такое задание уже есть в справочнике этой компетенции");
    db.update(idpAssignments)
      .set({
        competencyId,
        name: texts.name,
        learnText: texts.learnText,
        verifyText: texts.verifyText,
        level,
        updatedAt: t,
      })
      .where(eq(idpAssignments.id, idRaw))
      .run();
    revalidatePath("/assignments");
    revalidatePath(`/assignments/${idRaw}`);
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
    revalidatePath(`/assignments/${id}`);
    return null;
  } catch (error) {
    if (retryIfClosed(error, retried)) return archiveAssignmentAction(_prev, formData, true);
    if (isUniqueConstraint(error)) return { error: "Такое задание уже есть в справочнике этой компетенции" };
    return asActionError(error);
  }
}

function readAssignmentTest(formData: FormData) {
  const prompts = formData.getAll("prompt").map((value) => String(value).trim());
  const questions = prompts
    .map((prompt, index) => {
      const options = formData.getAll(`option-${index}`).map((value) => String(value).trim());
      const correct = new Set(formData.getAll(`correct-${index}`).map((value) => Number(value)));
      return { prompt, options, correct };
    })
    .filter((question) => question.prompt.length > 0 || question.options.some((text) => text.length > 0));
  for (const question of questions) {
    if (!question.prompt) throw new InvariantError("Нужен текст вопроса");
    if (question.options.length < 2 || question.options.some((text) => text.length === 0)) {
      throw new InvariantError("У вопроса нужно хотя бы два варианта");
    }
    const correctCount = question.options.filter((_, index) => question.correct.has(index)).length;
    if (correctCount !== 1) throw new InvariantError("У вопроса должен быть ровно один верный вариант");
  }
  return questions;
}

function replaceAssignmentTest(
  assignmentId: string,
  questions: { prompt: string; options: { text: string; correct: boolean }[] }[],
) {
  const db = getDb();
  const previous = db
    .select({ id: idpAssignmentQuestions.id })
    .from(idpAssignmentQuestions)
    .where(eq(idpAssignmentQuestions.assignmentId, assignmentId))
    .all();
  for (const question of previous) {
    db.delete(idpAssignmentOptions).where(eq(idpAssignmentOptions.questionId, question.id)).run();
  }
  db.delete(idpAssignmentQuestions).where(eq(idpAssignmentQuestions.assignmentId, assignmentId)).run();
  questions.forEach((question, questionIndex) => {
    const questionId = newId("q");
    db.insert(idpAssignmentQuestions)
      .values({ id: questionId, assignmentId, prompt: question.prompt, sortOrder: questionIndex })
      .run();
    question.options.forEach((option, optionIndex) => {
      db.insert(idpAssignmentOptions)
        .values({
          id: newId("opt"),
          questionId,
          text: option.text,
          isCorrect: option.correct ? 1 : 0,
          sortOrder: optionIndex,
        })
        .run();
    });
  });
}

export async function saveAssignmentTestAction(
  _prev: ActionResult,
  formData: FormData,
  retried = false,
): Promise<ActionResult> {
  try {
    const actor = await requireEmployee();
    if (!canEditAssignmentCatalog(actor)) {
      throw new InvariantError("Справочник заданий правят руководители и админ");
    }
    const id = String(formData.get("id") ?? "");
    const existing = getIdpAssignment(id);
    if (!existing) throw new InvariantError("Задание не найдено");
    if (existing.archived !== 0) throw new InvariantError("Скрытое задание сначала верните в справочник");
    const questions = readAssignmentTest(formData).map((question) => ({
      prompt: question.prompt,
      options: question.options.map((text, index) => ({ text, correct: question.correct.has(index) })),
    }));
    getSqlite()
      .transaction(() => {
        replaceAssignmentTest(id, questions);
        return true;
      })
      .deferred(null);
    revalidatePath(`/assignments/${id}`);
    return null;
  } catch (error) {
    if (retryIfClosed(error, retried)) return saveAssignmentTestAction(_prev, formData, true);
    return asActionError(error);
  }
}

export async function importAssignmentsAction(
  _prev: ActionResult,
  formData: FormData,
  retried = false,
): Promise<ActionResult> {
  try {
    const actor = await requireEmployee();
    if (!actor.isAdmin) throw new InvariantError("Загрузку заданий выполняет админ");
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0 || !file.name.toLowerCase().endsWith(".xlsx")) {
      throw new InvariantError("Нужен файл Excel .xlsx");
    }
    let grid: string[][];
    try {
      grid = readXlsxSheet(Buffer.from(await file.arrayBuffer()));
    } catch {
      return { error: "Это не файл Excel" };
    }
    const parsed = parseAssignmentSheet(grid);
    const competencies = new Map(listCompetencies().map((item) => [item.id, item]));
    const catalog = listIdpAssignments();
    const errors = [...parsed.errors];
    const plan: (
      | { kind: "create"; item: ParsedAssignment }
      | { kind: "update"; id: string; item: ParsedAssignment; hiddenNames: string[] }
      | { kind: "skip"; names: string[] }
    )[] = [];
    for (const item of parsed.assignments) {
      const competency = competencies.get(item.competencyId);
      if (!competency) {
        errors.push(`Неизвестная компетенция «${item.competencyId}»`);
        continue;
      }
      if (competency.type === "duty") {
        errors.push("Задание только к компетенции, не к обязанности");
        continue;
      }
      if (item.levelProvided && item.level != null && (item.level < 1 || item.level > 3)) {
        errors.push(`У задания «${item.name}» уровень — 1, 2 или 3`);
        continue;
      }
      const same = catalog.filter(
        (row) => row.competencyId === item.competencyId && row.name.toLowerCase() === item.name.toLowerCase(),
      );
      const active = same.filter((row) => row.archived === 0);
      const hidden = same.filter((row) => row.archived !== 0);
      if (active.length > 1) {
        errors.push(`Несколько активных заданий «${item.name}»`);
        continue;
      }
      if (active.length === 1) {
        const current = active[0];
        if (!current) continue;
        plan.push({ kind: "update", id: current.id, item, hiddenNames: hidden.map((row) => row.name) });
      } else if (hidden.length > 0) {
        plan.push({ kind: "skip", names: hidden.map((row) => row.name) });
      } else {
        plan.push({ kind: "create", item });
      }
    }
    if (errors.length > 0) return { error: errors.join("\n") };

    const db = getDb();
    const t = now();
    const hiddenNames: string[] = [];
    const touched: string[] = [];
    getSqlite()
      .transaction(() => {
        for (const step of plan) {
          if (step.kind === "skip") {
            hiddenNames.push(...step.names);
            continue;
          }
          if (step.kind === "create") {
            const id = newId("asg");
            db.insert(idpAssignments)
              .values({
                id,
                competencyId: step.item.competencyId,
                name: step.item.name,
                learnText: step.item.learnText,
                verifyText: step.item.verifyText,
                level: step.item.levelProvided ? step.item.level : null,
                archived: 0,
                updatedAt: t,
              })
              .run();
            replaceAssignmentTest(id, step.item.questions);
            touched.push(id);
            continue;
          }
          db.update(idpAssignments)
            .set({
              learnText: step.item.learnText,
              verifyText: step.item.verifyText,
              ...(step.item.levelProvided && step.item.level != null ? { level: step.item.level } : {}),
              updatedAt: t,
            })
            .where(eq(idpAssignments.id, step.id))
            .run();
          replaceAssignmentTest(step.id, step.item.questions);
          hiddenNames.push(...step.hiddenNames);
          touched.push(step.id);
        }
        return true;
      })
      .deferred(null);
    revalidatePath("/assignments");
    for (const id of touched) revalidatePath(`/assignments/${id}`);
    const lines = [`Загружено заданий: ${touched.length}.`];
    if (hiddenNames.length > 0) lines.push(`Скрытые без изменений: ${hiddenNames.join(", ")}`);
    return { notice: lines.join("\n") };
  } catch (error) {
    if (retryIfClosed(error, retried)) return importAssignmentsAction(_prev, formData, true);
    if (isUniqueConstraint(error)) return { error: "Такое задание уже есть в справочнике этой компетенции" };
    return asActionError(error);
  }
}

export async function submitItemTestAction(
  _prev: ActionResult,
  formData: FormData,
  retried = false,
): Promise<ActionResult> {
  try {
    const actor = await requireEmployee();
    const item = getIdpItem(Number(formData.get("itemId")));
    if (!item) throw new InvariantError("Задание не найдено");
    const idp = getIdp(item.idpId);
    if (!idp || idp.status !== "active") throw new InvariantError("Активный ИПР не найден");
    if (actor.id !== idp.employeeId) throw new InvariantError("Тест сдаёт сотрудник этого плана");
    if (item.acceptedAt != null) throw new InvariantError("После приёмки тест не сдаётся");
    const db = getDb();
    const questions = db
      .select()
      .from(idpItemQuestions)
      .where(eq(idpItemQuestions.itemId, item.id))
      .all();
    if (questions.length === 0) throw new InvariantError("У строки нет теста");
    let passed = true;
    for (const question of questions) {
      const chosen = String(formData.get(`answer-${question.id}`) ?? "");
      const option = db.select().from(idpItemOptions).where(eq(idpItemOptions.id, chosen)).get();
      if (!option || option.questionId !== question.id || option.isCorrect !== 1) passed = false;
    }
    db.insert(idpItemAttempts)
      .values({ id: newId("att"), itemId: item.id, passed: passed ? 1 : 0, createdAt: now() })
      .run();
    revalidateIdp(idp.employeeId, idp.id);
    revalidatePath(`/idps/${idp.id}/items/${item.id}`);
    return null;
  } catch (error) {
    if (retryIfClosed(error, retried)) return submitItemTestAction(_prev, formData, true);
    return asActionError(error);
  }
}
