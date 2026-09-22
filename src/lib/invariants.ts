import { eq, or } from "drizzle-orm";
import { competencies, employees, idpAssignments, idpItems, idpPool, idps, jobTransitions, profileSkills, profiles } from "@/db/schema";
import { getDb } from "@/db";
import type { SessionEmployee } from "@/lib/auth";

export class InvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvariantError";
  }
}

export function assertTransition(fromJobId: string, toJobId: string) {
  if (fromJobId === toJobId) {
    throw new InvariantError("Ребро не может быть петлёй");
  }
}

export function assertSkillLevel(type: string, level: number | null) {
  if (type === "duty") {
    if (level !== null) {
      throw new InvariantError("У обязанности не может быть уровня");
    }
    return;
  }
  if (level === null) return;
  if (level !== 1 && level !== 2 && level !== 3) {
    throw new InvariantError("Уровень компетенции должен быть 1, 2 или 3");
  }
}

export function sectionForType(type: string): "technical" | "personal" | "duties" {
  if (type === "professional") return "technical";
  if (type === "universal") return "personal";
  return "duties";
}

export function assertCompetencyTree(parentId: string | null, type?: string) {
  if (!parentId) return;
  const db = getDb();
  const parent = db.select().from(competencies).where(eq(competencies.id, parentId)).get();
  if (!parent) {
    throw new InvariantError("Родительская компетенция не найдена");
  }
  if (parent.parentId) {
    throw new InvariantError("Глубина дерева компетенций не больше 1");
  }
  if (type && parent.type !== type) {
    throw new InvariantError("Тип дочерней компетенции должен совпадать с родителем");
  }
}

export function assertCompetencyNameUnique(id: string, parentId: string | null, name: string) {
  const db = getDb();
  const clash = db
    .select()
    .from(competencies)
    .all()
    .find((c) => c.id !== id && c.parentId === parentId && c.name === name);
  if (clash) {
    throw new InvariantError("Имя компетенции должно быть уникально среди соседей");
  }
}

export function assertTypeChangeAllowed(id: string, nextType: string) {
  const db = getDb();
  const current = db.select().from(competencies).where(eq(competencies.id, id)).get();
  if (!current) {
    throw new InvariantError("Компетенция не найдена");
  }
  if (current.type === nextType) return;
  const used = db.select().from(profileSkills).where(eq(profileSkills.competencyId, id)).get();
  if (used) {
    throw new InvariantError("Тип нельзя менять: компетенция уже в профиле");
  }
  const assignment = db.select().from(idpAssignments).where(eq(idpAssignments.competencyId, id)).get();
  if (assignment) {
    throw new InvariantError("Тип нельзя менять: есть задания ИПР");
  }
}

export function assertJobDeletable(jobId: string) {
  const db = getDb();
  const profile = db.select().from(profiles).where(eq(profiles.jobId, jobId)).get();
  if (profile) {
    throw new InvariantError("Нельзя удалить должность: есть профиль");
  }
  const edge = db
    .select()
    .from(jobTransitions)
    .where(or(eq(jobTransitions.fromJobId, jobId), eq(jobTransitions.toJobId, jobId)))
    .get();
  if (edge) {
    throw new InvariantError("Нельзя удалить должность: есть рёбра карьеры");
  }
  const holder = db.select().from(employees).where(eq(employees.jobId, jobId)).get();
  if (holder) {
    throw new InvariantError("Нельзя удалить должность: она назначена сотруднику");
  }
  const target = db.select().from(idps).where(eq(idps.targetJobId, jobId)).get();
  if (target) {
    throw new InvariantError("Нельзя удалить должность: она цель ИПР");
  }
  const source = db.select().from(idps).where(eq(idps.sourceJobId, jobId)).get();
  if (source) {
    throw new InvariantError("Нельзя удалить должность: она текущая в ИПР");
  }
}

export function assertManagerLink(employeeId: string, managerId: string | null) {
  if (!managerId) return;
  if (managerId === employeeId) {
    throw new InvariantError("Сотрудник не может быть своим руководителем");
  }
  const db = getDb();
  const manager = db.select().from(employees).where(eq(employees.id, managerId)).get();
  if (!manager) {
    throw new InvariantError("Руководитель не найден");
  }
  const seen = new Set([employeeId, managerId]);
  let cursor: string | null = manager.managerId;
  while (cursor) {
    if (seen.has(cursor)) {
      throw new InvariantError("Оргсвязь не может содержать цикл");
    }
    seen.add(cursor);
    const row = db.select().from(employees).where(eq(employees.id, cursor)).get();
    cursor = row?.managerId ?? null;
  }
}

export function assertNoSecondActiveIdp(employeeId: string) {
  const active = getDb()
    .select()
    .from(idps)
    .where(eq(idps.employeeId, employeeId))
    .all()
    .find((row) => row.status === "active");
  if (active) {
    throw new InvariantError("У сотрудника уже есть активный ИПР");
  }
}

export function assertNotLastAdmin(employeeId: string) {
  const db = getDb();
  const row = db.select().from(employees).where(eq(employees.id, employeeId)).get();
  if (!row || row.isAdmin !== 1) return;
  const other = db
    .select()
    .from(employees)
    .all()
    .find((e) => e.id !== employeeId && e.isAdmin === 1 && e.isActive === 1);
  if (!other) {
    throw new InvariantError("Нельзя убрать последнего админа");
  }
}

export function canManageEmployee(actor: SessionEmployee, targetId: string): boolean {
  if (actor.isAdmin) return true;
  const target = getDb().select().from(employees).where(eq(employees.id, targetId)).get();
  return Boolean(target && target.managerId === actor.id);
}

export function canViewEmployee(actor: SessionEmployee, targetId: string): boolean {
  if (actor.id === targetId) return true;
  return canManageEmployee(actor, targetId);
}

export function canTickIdpItem(actor: SessionEmployee, employeeId: string): boolean {
  if (actor.id === employeeId) return true;
  return canManageEmployee(actor, employeeId);
}

export function canEditAssignmentCatalog(actor: SessionEmployee): boolean {
  if (actor.isAdmin) return true;
  return Boolean(getDb().select().from(employees).where(eq(employees.managerId, actor.id)).get());
}

export function assertCompetencyDeletable(id: string) {
  const db = getDb();
  const used = db.select().from(profileSkills).where(eq(profileSkills.competencyId, id)).get();
  if (used) {
    throw new InvariantError("Нельзя удалить компетенцию: есть строки профиля");
  }
  const child = db.select().from(competencies).where(eq(competencies.parentId, id)).get();
  if (child) {
    throw new InvariantError("Нельзя удалить компетенцию: есть дочерние элементы");
  }
  const assignment = db.select().from(idpAssignments).where(eq(idpAssignments.competencyId, id)).get();
  if (assignment) {
    throw new InvariantError("Нельзя удалить компетенцию: есть задания ИПР");
  }
  const pool = db.select().from(idpPool).where(eq(idpPool.competencyId, id)).get();
  if (pool) {
    throw new InvariantError("Нельзя удалить компетенцию: она в пуле ИПР");
  }
  const item = db.select().from(idpItems).where(eq(idpItems.competencyId, id)).get();
  if (item) {
    throw new InvariantError("Нельзя удалить компетенцию: есть строки ИПР");
  }
}
