"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getDb, getSqlite, now, retryIfClosed } from "@/db";
import {
  employeeAchievements,
  employeeCompetencyConfirmations,
  employeeCompetencyMarks,
  employees,
  idps,
  type CompetencyMarkStatus,
} from "@/db/schema";
import { requireAdmin, requireEmployee } from "@/lib/auth";
import { syncEmployeeAchievements } from "@/lib/achievement-rules";
import {
  InvariantError,
  assertManagerLink,
  assertNotLastAdmin,
  canManageEmployee,
} from "@/lib/invariants";
import { hashPassword } from "@/lib/password";
import {
  getAchievement,
  getActiveIdp,
  getCompetency,
  getEmployee,
  getEmployeeByLogin,
  getJob,
  listSkillCompetencies,
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
  revalidatePath("/me/achievements");
  revalidatePath("/me/skills");
  revalidatePath("/people");
  revalidatePath("/idps");
  revalidatePath("/assignments");
  revalidatePath(`/people/${employeeId}`);
  // Дерево сотрудника в карточке показывает подтверждения: подтверждение и отзыв меняют его тоже.
  revalidatePath(`/people/${employeeId}/skills`);
  if (idpId) revalidatePath(`/idps/${idpId}`);
}

/** Карточка руководителя показывает свои достижения: подтверждение подчинённого их меняет. */
function revalidateManagerCard(managerId: string | null | undefined) {
  if (managerId) revalidatePath(`/people/${managerId}`);
}

/**
 * Сверка автоматических достижений после смены должности или оргсвязи (ADR 0010), а также после
 * ручного подтверждения компетенции и его отзыва (ADR 0011): у сотрудника меняются правила
 * должности, профиля и подтверждений, у затронутых руководителей — правила наставничества.
 */
function syncPeopleAchievements(...ids: (string | null | undefined)[]) {
  for (const id of new Set(ids.filter((value): value is string => Boolean(value)))) {
    syncEmployeeAchievements(id);
  }
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
      syncPeopleAchievements(id, managerId);
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
    syncPeopleAchievements(idRaw, existing.managerId, managerId);
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
    syncPeopleAchievements(employeeId);
    revalidatePeople(employeeId);
    return null;
  } catch (error) {
    if (retryIfClosed(error, retried)) return assignJobAction(_prev, formData, true);
    return asActionError(error);
  }
}

const REVOKE_REASON_LIMIT = 1000;

/**
 * Ключ достижения из формы: сотрудник должен существовать, запись каталога — быть выбрана.
 * Права и наличие самой записи проверяются действием, здесь только то, без чего запрос бессмыслен.
 */
function readAchievementKey(formData: FormData) {
  const employeeId = String(formData.get("employeeId") ?? "").trim();
  const achievementId = String(formData.get("achievementId") ?? "").trim();
  if (!getEmployee(employeeId)) throw new InvariantError("Сотрудник не найден");
  if (!achievementId) throw new InvariantError("Достижение не выбрано");
  return { employeeId, achievementId };
}

/**
 * Ручная выдача достижения (ADR 0010). Админ выдаёт любому, руководитель — только прямому
 * подчинённому: то же условие, что у приёмки ИПР. Повторная выдача не добавляет строку,
 * а снимает отзыв и ставит новую дату; `granted_by_id` подписывает её человеком.
 */
export async function grantAchievementAction(
  _prev: ActionResult,
  formData: FormData,
  retried = false,
): Promise<ActionResult> {
  try {
    const actor = await requireEmployee();
    const { employeeId, achievementId } = readAchievementKey(formData);
    if (!canManageEmployee(actor, employeeId)) {
      throw new InvariantError("Нельзя выдать достижение этому сотруднику");
    }
    const achievement = getAchievement(achievementId);
    if (!achievement) throw new InvariantError("Достижение не найдено");
    if (achievement.archived !== 0) throw new InvariantError("Достижение скрыто из каталога");
    const t = now();
    getDb()
      .insert(employeeAchievements)
      .values({
        employeeId,
        achievementId,
        source: "manual",
        ruleKey: achievement.rule,
        sourceRef: null,
        grantedAt: t,
        grantedById: actor.id,
      })
      .onConflictDoUpdate({
        target: [employeeAchievements.employeeId, employeeAchievements.achievementId],
        set: {
          source: "manual",
          ruleKey: achievement.rule,
          sourceRef: null,
          grantedAt: t,
          grantedById: actor.id,
          revokedAt: null,
          revokedById: null,
          revokeReason: null,
        },
      })
      .run();
    revalidatePeople(employeeId);
    revalidatePath("/me/achievements");
    return null;
  } catch (error) {
    if (retryIfClosed(error, retried)) return grantAchievementAction(_prev, formData, true);
    return asActionError(error);
  }
}

/**
 * Ручной отзыв выданного достижения (ADR 0010). Строка не удаляется: остаются дата, автор
 * и причина. Отозвать можно и автоматическую выдачу — подпись человека сильнее правила,
 * сверка такую строку больше не оживляет.
 */
export async function revokeAchievementAction(
  _prev: ActionResult,
  formData: FormData,
  retried = false,
): Promise<ActionResult> {
  try {
    const actor = await requireEmployee();
    const { employeeId, achievementId } = readAchievementKey(formData);
    if (!canManageEmployee(actor, employeeId)) {
      throw new InvariantError("Нельзя отозвать достижение этого сотрудника");
    }
    const reason = String(formData.get("reason") ?? "").trim();
    if (!reason) throw new InvariantError("Нужна причина отзыва");
    if (reason.length > REVOKE_REASON_LIMIT) {
      throw new InvariantError(`Причина: не длиннее ${REVOKE_REASON_LIMIT} символов`);
    }
    const db = getDb();
    const key = and(
      eq(employeeAchievements.employeeId, employeeId),
      eq(employeeAchievements.achievementId, achievementId),
    );
    const existing = db.select().from(employeeAchievements).where(key).get();
    if (!existing || existing.revokedAt != null) throw new InvariantError("Достижение не выдано");
    db.update(employeeAchievements)
      .set({ revokedAt: now(), revokedById: actor.id, revokeReason: reason })
      .where(key)
      .run();
    revalidatePeople(employeeId);
    revalidatePath("/me/achievements");
    return null;
  } catch (error) {
    if (retryIfClosed(error, retried)) return revokeAchievementAction(_prev, formData, true);
    return asActionError(error);
  }
}

const CONFIRMATION_NOTE_LIMIT = 1000;

/** Ключ подтверждения из формы: сотрудник должен существовать, навык — быть выбран. */
function readConfirmationKey(formData: FormData) {
  const employeeId = String(formData.get("employeeId") ?? "").trim();
  const competencyId = String(formData.get("competencyId") ?? "").trim();
  if (!getEmployee(employeeId)) throw new InvariantError("Сотрудник не найден");
  if (!competencyId) throw new InvariantError("Навык не выбран");
  return { employeeId, competencyId };
}

/**
 * Подтвердить можно только навык (ADR 0011): обязанность уровнем не обладает и в подтверждениях
 * не участвует, а группа разделов — не навык, хотя и хранится в том же справочнике. Список навыков
 * тот же, что в форме, поэтому действие не расходится с тем, что предлагает интерфейс.
 */
function readConfirmableSkill(id: string) {
  const competency = getCompetency(id);
  if (!competency) throw new InvariantError("Навык не найден");
  if (!listSkillCompetencies().some((row) => row.id === id)) {
    throw new InvariantError("Подтвердить можно только навык");
  }
  return competency;
}

/**
 * Ручное подтверждение компетенции (ADR 0011). Админ подтверждает любому, руководитель — только
 * прямому подчинённому: то же условие, что у приёмки ИПР. Повтор обновляет ту же строку и снимает
 * отзыв, поэтому второй записи по паре «сотрудник × компетенция» не появляется. После записи
 * сверяются достижения сотрудника и его руководителя: ручная запись — второй источник правил.
 */
export async function confirmCompetencyAction(
  _prev: ActionResult,
  formData: FormData,
  retried = false,
): Promise<ActionResult> {
  try {
    const actor = await requireEmployee();
    const { employeeId, competencyId } = readConfirmationKey(formData);
    if (!canManageEmployee(actor, employeeId)) {
      throw new InvariantError("Нельзя подтвердить компетенцию этому сотруднику");
    }
    const competency = readConfirmableSkill(competencyId);
    const note = String(formData.get("note") ?? "").trim();
    if (!note) throw new InvariantError("Нужно основание подтверждения");
    if (note.length > CONFIRMATION_NOTE_LIMIT) {
      throw new InvariantError(`Основание: не длиннее ${CONFIRMATION_NOTE_LIMIT} символов`);
    }
    const managerId = getEmployee(employeeId)?.managerId;
    const t = now();
    getDb()
      .insert(employeeCompetencyConfirmations)
      .values({
        employeeId,
        competencyId,
        competencyName: competency.name,
        note,
        confirmedAt: t,
        confirmedById: actor.id,
      })
      .onConflictDoUpdate({
        target: [employeeCompetencyConfirmations.employeeId, employeeCompetencyConfirmations.competencyId],
        set: {
          competencyName: competency.name,
          note,
          confirmedAt: t,
          confirmedById: actor.id,
          revokedAt: null,
          revokedById: null,
          revokeReason: null,
        },
      })
      .run();
    syncPeopleAchievements(employeeId, managerId);
    revalidatePeople(employeeId);
    revalidateManagerCard(managerId);
    return null;
  } catch (error) {
    if (retryIfClosed(error, retried)) return confirmCompetencyAction(_prev, formData, true);
    return asActionError(error);
  }
}

/**
 * Отзыв ручного подтверждения (ADR 0011). Строка не удаляется: остаются дата, автор и причина.
 * Повторный отзыв получает отказ и данные не меняет.
 */
export async function revokeCompetencyConfirmationAction(
  _prev: ActionResult,
  formData: FormData,
  retried = false,
): Promise<ActionResult> {
  try {
    const actor = await requireEmployee();
    const { employeeId, competencyId } = readConfirmationKey(formData);
    if (!canManageEmployee(actor, employeeId)) {
      throw new InvariantError("Нельзя отозвать подтверждение этого сотрудника");
    }
    const reason = String(formData.get("reason") ?? "").trim();
    if (!reason) throw new InvariantError("Нужна причина отзыва");
    if (reason.length > REVOKE_REASON_LIMIT) {
      throw new InvariantError(`Причина: не длиннее ${REVOKE_REASON_LIMIT} символов`);
    }
    const db = getDb();
    const key = and(
      eq(employeeCompetencyConfirmations.employeeId, employeeId),
      eq(employeeCompetencyConfirmations.competencyId, competencyId),
    );
    const managerId = getEmployee(employeeId)?.managerId;
    // Проверка, отзыв и сверка — одной транзакцией: иначе сбой сверки оставил бы подтверждение
    // снятым, а достижения — действующими, и повторный отзыв уже не запустил бы пересчёт.
    getSqlite()
      .transaction(() => {
        const existing = db.select().from(employeeCompetencyConfirmations).where(key).get();
        if (!existing || existing.revokedAt != null) throw new InvariantError("Подтверждение не найдено");
        db.update(employeeCompetencyConfirmations)
          .set({ revokedAt: now(), revokedById: actor.id, revokeReason: reason })
          .where(key)
          .run();
        syncPeopleAchievements(employeeId, managerId);
        return true;
      })
      .immediate(null);
    revalidatePeople(employeeId);
    revalidateManagerCard(managerId);
    return null;
  } catch (error) {
    if (retryIfClosed(error, retried)) return revokeCompetencyConfirmationAction(_prev, formData, true);
    return asActionError(error);
  }
}

const MARK_STATUSES: CompetencyMarkStatus[] = ["has", "lacks", "in_progress"];
const MARK_NOTE_LIMIT = 1000;

/** Ставит, меняет или снимает личную пометку вошедшего сотрудника (ADR 0007, ADR 0008). Пустой статус снимает пометку и пояснение. */
export async function setCompetencyMarkAction(
  _prev: ActionResult,
  formData: FormData,
  retried = false,
): Promise<ActionResult> {
  try {
    const actor = await requireEmployee();
    const competencyId = String(formData.get("competencyId") ?? "");
    const status = String(formData.get("status") ?? "");
    const note = String(formData.get("note") ?? "");
    if (status !== "" && !MARK_STATUSES.includes(status as CompetencyMarkStatus)) {
      throw new InvariantError("Статус: есть, нет или в процессе");
    }
    if (status !== "" && note.length > MARK_NOTE_LIMIT) {
      throw new InvariantError("Пояснение: не длиннее 1000 символов");
    }
    const db = getDb();
    const own = and(
      eq(employeeCompetencyMarks.employeeId, actor.id),
      eq(employeeCompetencyMarks.competencyId, competencyId),
    );
    const existing = db.select().from(employeeCompetencyMarks).where(own).get();
    const markable = markableCompetencies(actor.id, actor.jobId).some((row) => row.id === competencyId);
    if (status === "") {
      db.delete(employeeCompetencyMarks).where(own).run();
    } else if (!existing && !markable) {
      throw new InvariantError("Отметить можно только навык своей должности или цели ИПР");
    } else {
      const t = now();
      db.insert(employeeCompetencyMarks)
        .values({
          employeeId: actor.id,
          competencyId,
          status: status as CompetencyMarkStatus,
          note,
          updatedAt: t,
        })
        .onConflictDoUpdate({
          target: [employeeCompetencyMarks.employeeId, employeeCompetencyMarks.competencyId],
          set: { status: status as CompetencyMarkStatus, note, updatedAt: t },
        })
        .run();
    }
    revalidatePath("/me");
    revalidatePath("/me/marks");
    revalidatePath("/me/skills");
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
    const previousManagerId = existing.managerId;
    db.update(employees)
      .set({ isActive: 0, managerId: null, updatedAt: t })
      .where(eq(employees.id, employeeId))
      .run();
    db.update(employees)
      .set({ managerId: null, updatedAt: t })
      .where(eq(employees.managerId, employeeId))
      .run();
    syncPeopleAchievements(employeeId, previousManagerId);
    revalidatePeople(employeeId);
    return null;
  } catch (error) {
    if (retryIfClosed(error, retried)) return deactivateEmployeeAction(_prev, formData, true);
    return asActionError(error);
  }
}

