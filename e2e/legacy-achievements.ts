/**
 * База «до появления таблиц достижений» для проверки переноса (ADR 0010, issue #116).
 *
 * DDL ниже — фрагмент схемы `main` до миграции: только таблицы, в которых лежат переносимые достижения.
 * Его нельзя выводить из `src/db/migrate.ts`, иначе проверка перестанет замечать, что миграция ветки
 * ломает базу из `main`. Остальные таблицы создаёт сам `migrate()`.
 *
 *   npx tsx e2e/legacy-achievements.ts tmp/legacy.sqlite           — собрать базу и прогнать migrate()
 *   npx tsx e2e/legacy-achievements.ts tmp/legacy.sqlite --migrate — только migrate() на готовой базе
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "../src/db/migrate";
import { resetDbConnection } from "../src/db";
import { removeDatabase } from "../scripts/lib/sqlite-tools";

/** Пять таблиц, в которых лежат прежние вычисляемые достижения: сотрудник, план, пул и строки плана. */
const LEGACY_DDL = `
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  rank_order INTEGER NOT NULL,
  lane TEXT NOT NULL,
  years_required INTEGER,
  professional_standard TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE employees (
  id TEXT PRIMARY KEY,
  login TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  manager_id TEXT REFERENCES employees(id),
  is_admin INTEGER NOT NULL,
  is_active INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE idps (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  source_job_id TEXT NOT NULL REFERENCES jobs(id),
  target_job_id TEXT NOT NULL REFERENCES jobs(id),
  created_by_id TEXT NOT NULL REFERENCES employees(id),
  period_start TEXT NOT NULL DEFAULT '1970-01-01',
  period_end TEXT NOT NULL DEFAULT '1970-01-01',
  status TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE idp_pool (
  idp_id TEXT NOT NULL REFERENCES idps(id),
  competency_id TEXT NOT NULL,
  competency_name TEXT NOT NULL,
  required_level INTEGER,
  UNIQUE (idp_id, competency_id)
);
-- Пустая таблица-родитель: на неё ссылается idp_items, а строка задания в fixture не нужна.
CREATE TABLE idp_assignments (
  id TEXT PRIMARY KEY,
  competency_id TEXT NOT NULL,
  name TEXT NOT NULL,
  learn_text TEXT NOT NULL,
  verify_text TEXT NOT NULL,
  level INTEGER,
  archived INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE idp_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idp_id TEXT NOT NULL REFERENCES idps(id),
  assignment_id TEXT REFERENCES idp_assignments(id),
  competency_id TEXT NOT NULL,
  competency_name TEXT NOT NULL,
  required_level INTEGER,
  assignment_name TEXT NOT NULL,
  assignment_level INTEGER,
  learn_text TEXT NOT NULL,
  verify_text TEXT NOT NULL,
  due_on TEXT,
  status TEXT NOT NULL,
  accepted_by_id TEXT REFERENCES employees(id),
  accepted_at INTEGER,
  sort_order INTEGER NOT NULL
);
`;

/**
 * Данные под все три переносимых правила: активный план с закрытым пулом (первая строка и пул)
 * и выполненный план без пула. У правил разные `source_ref`, поэтому перенос видно поштучно.
 */
function buildLegacyDb(file: string) {
  removeDatabase(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  try {
    db.exec(LEGACY_DDL);
    db.exec(`
      INSERT INTO jobs (id, name, rank_order, lane, years_required, professional_standard, updated_at) VALUES
        ('junior', 'Младший программист', 2, 'executor', NULL, NULL, 900),
        ('programmer', 'Программист', 3, 'executor', NULL, NULL, 900);
      INSERT INTO employees (id, login, name, password_hash, job_id, manager_id, is_admin, is_active, updated_at) VALUES
        ('emp-legacy', 'legacy', 'Сотрудник из main', 'legacy-hash', 'junior', NULL, 0, 1, 900);
      INSERT INTO idps (id, employee_id, source_job_id, target_job_id, created_by_id, period_start, period_end, status, updated_at) VALUES
        ('idp-legacy-active', 'emp-legacy', 'junior', 'programmer', 'emp-legacy', '2026-01-01', '2026-06-30', 'active', 1200),
        ('idp-legacy-done', 'emp-legacy', 'junior', 'programmer', 'emp-legacy', '2025-01-01', '2025-06-30', 'completed', 1300);
      INSERT INTO idp_pool (idp_id, competency_id, competency_name, required_level) VALUES
        ('idp-legacy-active', 'comp-legacy-a', 'Компетенция A', NULL),
        ('idp-legacy-active', 'comp-legacy-b', 'Компетенция B', NULL);
      INSERT INTO idp_items (idp_id, competency_id, competency_name, assignment_name, learn_text, verify_text, status, accepted_at, sort_order) VALUES
        ('idp-legacy-active', 'comp-legacy-a', 'Компетенция A', 'Задание A', 'Что изучить', 'Как проверить', 'done', 1000, 0),
        ('idp-legacy-active', 'comp-legacy-b', 'Компетенция B', 'Задание B', 'Что изучить', 'Как проверить', 'done', 1001, 1),
        ('idp-legacy-done', 'comp-legacy-c', 'Компетенция C', 'Задание C', 'Что изучить', 'Как проверить', 'done', 1250, 0);
    `);
  } finally {
    db.close();
  }
}

const given = process.argv[2];
if (!given) {
  console.error("Нужен путь к базе: npx tsx e2e/legacy-achievements.ts tmp/legacy.sqlite");
  process.exit(1);
}
const file = path.resolve(given);
const fromTmp = path.relative(path.resolve("tmp"), file);
if (fromTmp === "" || fromTmp.startsWith("..") || path.isAbsolute(fromTmp)) {
  console.error(`Путь к базе должен лежать в tmp/: ${given}`);
  process.exit(1);
}

if (!process.argv.includes("--migrate")) buildLegacyDb(file);

process.env.DB_PATH = file;
migrate();
resetDbConnection();

const db = new DatabaseSync(file, { readOnly: true });
try {
  const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  console.log(
    `legacy ok: achievements=${count("SELECT COUNT(*) AS n FROM achievements")} employee_achievements=${count(
      "SELECT COUNT(*) AS n FROM employee_achievements",
    )}`,
  );
} finally {
  db.close();
}
