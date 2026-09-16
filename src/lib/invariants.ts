import { eq, or } from "drizzle-orm";
import { competencies, jobTransitions, profileSkills, profiles } from "@/db/schema";
import { getDb } from "@/db";

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
}
