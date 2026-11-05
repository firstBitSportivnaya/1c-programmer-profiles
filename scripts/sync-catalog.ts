/**
 * Перезаписывает компетенции и профили из seed/data.json в уже существующую базу.
 * Сотрудников, ИПР и задания не удаляет. Компетенцию, которой нет в исходниках,
 * убирает только если на неё не ссылаются задания, пул, строки плана и личные пометки.
 *
 *   npm run db:sync-catalog -- <файл базы>
 */
import fs from "node:fs";
import path from "node:path";
import { getSqlite, now, resetDbConnection } from "../src/db";
import { migrate } from "../src/db/migrate";
import { syncEmployeeAchievements } from "../src/lib/achievement-rules";
import type { SqliteClient } from "../src/db/sqlite";

type Competency = {
  id: string;
  name: string;
  description: string | null;
  type: string;
  parentId: string | null;
};

type Skill = {
  competencyId: string;
  level: number | null;
  criteria: string | null;
  sortOrder: number;
};

type Seed = {
  competencies: Competency[];
  profiles: { jobId: string; skills: Skill[] }[];
};

const BLOCKS: { table: string; label: string }[] = [
  { table: "idp_assignments", label: "задания" },
  { table: "idp_pool", label: "пул ИПР" },
  { table: "idp_items", label: "строки ИПР" },
  { table: "employee_competency_marks", label: "личные пометки" },
];

function placeholders(count: number) {
  return Array.from({ length: count }, () => "?").join(", ");
}

function apply(sqlite: SqliteClient, data: Seed, t: number) {
  const ids = data.competencies.map((row) => row.id);
  const idList = placeholders(ids.length);
  const existing = new Set(
    (sqlite.prepare("SELECT id FROM competencies").all() as { id: string }[]).map((row) => row.id),
  );
  const insertCompetency = sqlite.prepare(
    "INSERT INTO competencies (id, name, description, type, parent_id, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const updateCompetency = sqlite.prepare(
    "UPDATE competencies SET name = ?, description = ?, type = ?, parent_id = ?, updated_at = ? WHERE id = ?",
  );
  const writeCompetency = (row: Competency) => {
    if (existing.has(row.id)) {
      updateCompetency.run(row.name, row.description, row.type, row.parentId, t, row.id);
      return;
    }
    insertCompetency.run(row.id, row.name, row.description, row.type, row.parentId, t);
    existing.add(row.id);
  };
  for (const row of data.competencies.filter((item) => !item.parentId)) writeCompetency(row);
  for (const row of data.competencies.filter((item) => item.parentId)) writeCompetency(row);

  const findProfile = sqlite.prepare("SELECT id FROM profiles WHERE job_id = ?");
  const findJob = sqlite.prepare("SELECT id FROM jobs WHERE id = ?");
  const insertProfile = sqlite.prepare("INSERT INTO profiles (id, job_id, updated_at) VALUES (?, ?, ?)");
  let removedSkillCount = 0;
  const findSkill = sqlite.prepare("SELECT id FROM profile_skills WHERE profile_id = ? AND competency_id = ?");
  const updateSkill = sqlite.prepare(
    "UPDATE profile_skills SET level = ?, criteria = ?, sort_order = ?, updated_at = ? WHERE id = ?",
  );
  const insertSkill = sqlite.prepare(
    "INSERT INTO profile_skills (profile_id, competency_id, level, criteria, sort_order, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  );

  for (const profile of data.profiles) {
    if (!findJob.get(profile.jobId)) {
      throw new Error(`В базе нет должности «${profile.jobId}». Перезапись должности не создаёт.`);
    }
    let row = findProfile.get(profile.jobId) as { id: string } | undefined;
    if (!row) {
      const id = `profile-${profile.jobId}`;
      insertProfile.run(id, profile.jobId, t);
      row = { id };
    }
    const keep = profile.skills.map((skill) => skill.competencyId);
    for (const skill of profile.skills) {
      const current = findSkill.get(row.id, skill.competencyId) as { id: number } | undefined;
      if (current) updateSkill.run(skill.level, skill.criteria, skill.sortOrder, t, current.id);
      else insertSkill.run(row.id, skill.competencyId, skill.level, skill.criteria, skill.sortOrder, t);
    }
    const removedHere =
      keep.length === 0
        ? sqlite.prepare("DELETE FROM profile_skills WHERE profile_id = ?").run(row.id)
        : sqlite
            .prepare(`DELETE FROM profile_skills WHERE profile_id = ? AND competency_id NOT IN (${placeholders(keep.length)})`)
            .run(row.id, ...keep);
    removedSkillCount += removedHere.changes;
  }

  removedSkillCount += sqlite.prepare(`DELETE FROM profile_skills WHERE competency_id NOT IN (${idList})`).run(...ids).changes;
  const removedLinks = sqlite
    .prepare(`DELETE FROM competency_links WHERE competency_id NOT IN (${idList})`)
    .run(...ids);

  const extras = sqlite
    .prepare(`SELECT id, name FROM competencies WHERE id NOT IN (${idList})`)
    .all(...ids) as { id: string; name: string }[];
  const blockers: string[] = [];
  for (const extra of extras) {
    const parts: string[] = [];
    for (const block of BLOCKS) {
      const count = sqlite.prepare(`SELECT COUNT(*) AS n FROM ${block.table} WHERE competency_id = ?`).get(extra.id) as {
        n: number;
      };
      if (count.n > 0) parts.push(`${block.label}: ${count.n}`);
    }
    if (parts.length > 0) blockers.push(`«${extra.name}» — ${parts.join(", ")}`);
  }
  if (blockers.length > 0) {
    throw new Error(
      `Нельзя убрать компетенции, пока на них есть планы, задания или пометки. База не изменена.\n${blockers.join("\n")}`,
    );
  }

  let removedCompetencies = 0;
  for (;;) {
    const removed = sqlite
      .prepare(
        `DELETE FROM competencies
         WHERE id NOT IN (${idList})
           AND id NOT IN (SELECT parent_id FROM competencies WHERE parent_id IS NOT NULL)`,
      )
      .run(...ids);
    removedCompetencies += removed.changes;
    if (removed.changes === 0) break;
  }
  const left = sqlite.prepare(`SELECT COUNT(*) AS n FROM competencies WHERE id NOT IN (${idList})`).get(...ids) as {
    n: number;
  };
  if (left.n > 0) throw new Error("Не удалось убрать компетенции, которые остаются родителями других.");

  const renamePool = sqlite.prepare("UPDATE idp_pool SET competency_name = ? WHERE competency_id = ?");
  const renameItem = sqlite.prepare("UPDATE idp_items SET competency_name = ? WHERE competency_id = ?");
  for (const row of data.competencies) {
    renamePool.run(row.name, row.id);
    renameItem.run(row.name, row.id);
  }

  const skills = sqlite.prepare("SELECT COUNT(*) AS n FROM profile_skills").get() as { n: number };
  console.log(
    `synced competencies=${data.competencies.length} profiles=${data.profiles.length} skills=${skills.n} removed_competencies=${removedCompetencies} removed_skills=${removedSkillCount} removed_links=${removedLinks.changes}`,
  );
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: npm run db:sync-catalog -- <файл базы>");
    process.exit(1);
  }
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) {
    console.error(`Нет файла базы: ${abs}`);
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(path.join("seed", "data.json"), "utf8")) as Seed;
  process.env.DB_PATH = abs;
  resetDbConnection();
  migrate();
  try {
    getSqlite()
      .transaction(() => {
        apply(getSqlite(), data, now());
        return true;
      })
      .immediate(null);
    // Профили перезаписаны, а правила достижений читают их набор навыков (ADR 0010):
    // сверяем выдачи сотрудников сразу, иначе счётчик в кабинете ждёт открытия `/me/achievements`.
    const staff = getSqlite().prepare("SELECT id FROM employees").all() as { id: string }[];
    for (const row of staff) syncEmployeeAchievements(row.id);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  } finally {
    resetDbConnection();
  }
}

main();
