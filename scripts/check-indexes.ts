/**
 * Индексы чтений (#140): есть после migrate, повтор не падает,
 * на базе без idp_items таблица создаётся раньше индекса, план запроса не сканирует таблицу.
 * Живую data/profiles.sqlite не открывает.
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const INDEXES = [
  "employees_manager",
  "idps_employee",
  "idps_one_active",
  "idp_assignments_competency",
  "idp_assignment_questions_assignment",
  "idp_pool_competency",
  "idp_items_idp",
  "idp_items_competency",
  "idp_item_questions_item",
  "idp_item_options_question",
  "employee_competency_marks_competency",
  "employee_achievements_achievement",
];

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function indexNames(sqlite: { prepare: (sql: string) => { all: () => unknown[] } }) {
  return new Set(
    (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as { name: string }[]).map(
      (row) => row.name,
    ),
  );
}

function assertIndexes(sqlite: { prepare: (sql: string) => { all: () => unknown[] } }) {
  const names = indexNames(sqlite);
  for (const name of INDEXES) {
    if (!names.has(name)) fail(`нет индекса ${name}`);
  }
  const rebuilt = (
    sqlite.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%\\_new' ESCAPE '\\'").all() as { name: string }[]
  ).map((row) => row.name);
  if (rebuilt.length > 0) fail(`пересборка таблиц: ${rebuilt.join(", ")}`);
}

function plan(sqlite: { prepare: (sql: string) => { all: () => unknown[] } }, sql: string) {
  return (sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[]).map((row) => row.detail).join("\n");
}

function assertSearch(detail: string, index: string) {
  if (detail.includes("SCAN")) fail(`план сканирует таблицу:\n${detail}`);
  if (!detail.includes(index) || !/USING (COVERING )?INDEX/.test(detail)) {
    fail(`план без индекса ${index}:\n${detail}`);
  }
}

async function openMigrated(file: string) {
  process.env.DB_PATH = file;
  const { resetDbConnection, getSqlite } = await import("../src/db");
  const { migrate } = await import("../src/db/migrate");
  resetDbConnection();
  migrate();
  return { migrate, getSqlite, resetDbConnection };
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "indexes-"));
  try {
    const fresh = path.join(dir, "fresh.sqlite");
    const opened = await openMigrated(fresh);
    const sqlite = opened.getSqlite();
    assertIndexes(sqlite);
    const before = (sqlite.prepare("SELECT COUNT(*) AS n FROM jobs").get() as { n: number }).n;
    opened.migrate();
    assertIndexes(sqlite);
    const after = (sqlite.prepare("SELECT COUNT(*) AS n FROM jobs").get() as { n: number }).n;
    if (before !== after) fail(`повторная миграция изменила jobs: ${before} → ${after}`);

    sqlite.exec(`
      INSERT INTO jobs (id, name, rank_order, lane, updated_at) VALUES ('j', 'J', 1, 'executor', 1);
      INSERT INTO employees (id, login, name, password_hash, job_id, manager_id, is_admin, is_active, updated_at)
        VALUES ('e0', 'l0', 'N', 'x', 'j', NULL, 0, 1, 1);
      INSERT INTO competencies (id, name, type, updated_at) VALUES ('c', 'C', 'professional', 1);
      INSERT INTO idp_assignments (id, competency_id, name, learn_text, verify_text, archived, updated_at)
        VALUES ('a', 'c', 'A', 'L', 'V', 0, 1);
    `);
    const insertEmployee = sqlite.prepare(
      `INSERT INTO employees (id, login, name, password_hash, job_id, manager_id, is_admin, is_active, updated_at)
       VALUES (?, ?, 'N', 'x', 'j', 'e0', 0, 1, 1)`,
    );
    const insertPlan = sqlite.prepare(
      `INSERT INTO idps (id, employee_id, source_job_id, target_job_id, created_by_id, period_start, period_end, status, updated_at)
       VALUES (?, ?, 'j', 'j', 'e0', '2026-01-01', '2026-06-01', 'active', 1)`,
    );
    const insertItem = sqlite.prepare(
      `INSERT INTO idp_items (idp_id, competency_id, competency_name, assignment_name, learn_text, verify_text, status, sort_order)
       VALUES (?, 'c', 'C', 'A', 'L', 'V', 'not_started', 1)`,
    );
    const insertQuestion = sqlite.prepare(
      `INSERT INTO idp_item_questions (id, item_id, prompt, sort_order) VALUES (?, ?, 'Q', 1)`,
    );
    for (let i = 1; i <= 200; i += 1) {
      insertEmployee.run(`e${i}`, `l${i}`);
      insertPlan.run(`p${i}`, `e${i}`);
      insertItem.run(`p${i}`);
      const row = sqlite.prepare("SELECT last_insert_rowid() AS id").get() as { id: number };
      insertQuestion.run(`q${i}`, row.id);
    }
    const insertAssignment = sqlite.prepare(
      `INSERT INTO competencies (id, name, type, updated_at) VALUES (?, ?, 'professional', 1)`,
    );
    const insertAssignmentRow = sqlite.prepare(
      `INSERT INTO idp_assignments (id, competency_id, name, learn_text, verify_text, archived, updated_at)
       VALUES (?, ?, 'A', 'L', 'V', 0, 1)`,
    );
    for (let i = 1; i <= 200; i += 1) {
      insertAssignment.run(`c${i}`, `C${i}`);
      insertAssignmentRow.run(`a${i}`, `c${i}`);
    }
    sqlite.exec("ANALYZE");
    assertSearch(plan(sqlite, "SELECT id FROM idp_items WHERE idp_id = 'p1'"), "idp_items_idp");
    assertSearch(
      plan(sqlite, "SELECT id FROM idp_assignments WHERE competency_id = 'c1' AND archived = 0"),
      "idp_assignments_competency",
    );
    assertSearch(plan(sqlite, "SELECT id FROM employees WHERE manager_id = 'e0'"), "employees_manager");
    const activePlan = plan(sqlite, "SELECT id FROM idps WHERE employee_id = 'e1' AND status = 'active'");
    if (activePlan.includes("SCAN")) fail(`план сканирует таблицу:\n${activePlan}`);
    if (!activePlan.includes("idps_employee") && !activePlan.includes("idps_one_active")) {
      fail(`план активного ИПР без индекса:\n${activePlan}`);
    }
    assertSearch(plan(sqlite, "SELECT id FROM idp_item_questions WHERE item_id = 1"), "idp_item_questions_item");
    console.log("план: USING INDEX");
    opened.resetDbConnection();

    const old = path.join(dir, "old.sqlite");
    const raw = new DatabaseSync(old);
    raw.exec(`CREATE TABLE jobs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      rank_order INTEGER NOT NULL,
      lane TEXT NOT NULL,
      years_required INTEGER,
      professional_standard TEXT,
      updated_at INTEGER NOT NULL
    )`);
    raw.close();
    const again = await openMigrated(old);
    const oldSqlite = again.getSqlite();
    const hadItems = oldSqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'idp_items'").get();
    if (!hadItems) fail("idp_items не создана");
    assertIndexes(oldSqlite);
    console.log("старая база: индексы после таблиц");
    again.resetDbConnection();
  } finally {
    const { resetDbConnection } = await import("../src/db");
    resetDbConnection();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
