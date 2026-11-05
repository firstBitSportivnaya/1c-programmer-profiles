import catalogSeed from "../../seed/achievements.json";
import { getSqlite, now } from "./index";
import type { AchievementRecord } from "../lib/achievement-catalog";

const DDL = `
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  rank_order INTEGER NOT NULL,
  lane TEXT NOT NULL,
  years_required INTEGER,
  professional_standard TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS job_transitions (
  from_job_id TEXT NOT NULL REFERENCES jobs(id),
  to_job_id TEXT NOT NULL REFERENCES jobs(id),
  kind TEXT NOT NULL,
  UNIQUE (from_job_id, to_job_id)
);
CREATE TABLE IF NOT EXISTS competencies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL,
  parent_id TEXT REFERENCES competencies(id),
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id),
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS profile_skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id TEXT NOT NULL REFERENCES profiles(id),
  competency_id TEXT NOT NULL REFERENCES competencies(id),
  level INTEGER,
  criteria TEXT,
  sort_order INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (profile_id, competency_id)
);
CREATE TABLE IF NOT EXISTS employees (
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
CREATE TABLE IF NOT EXISTS idps (
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
CREATE TABLE IF NOT EXISTS idp_assignments (
  id TEXT PRIMARY KEY,
  competency_id TEXT NOT NULL REFERENCES competencies(id),
  name TEXT NOT NULL,
  learn_text TEXT NOT NULL,
  verify_text TEXT NOT NULL,
  level INTEGER,
  archived INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS idp_assignment_questions (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES idp_assignments(id),
  prompt TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS idp_assignment_options (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES idp_assignment_questions(id),
  text TEXT NOT NULL,
  is_correct INTEGER NOT NULL,
  sort_order INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS idp_pool (
  idp_id TEXT NOT NULL REFERENCES idps(id),
  competency_id TEXT NOT NULL,
  competency_name TEXT NOT NULL,
  required_level INTEGER,
  UNIQUE (idp_id, competency_id)
);
CREATE TABLE IF NOT EXISTS idp_items (
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
CREATE TABLE IF NOT EXISTS idp_item_questions (
  id TEXT PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES idp_items(id),
  prompt TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS idp_item_options (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES idp_item_questions(id),
  text TEXT NOT NULL,
  is_correct INTEGER NOT NULL,
  sort_order INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS idp_item_attempts (
  id TEXT PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES idp_items(id),
  passed INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS employee_competency_marks (
  employee_id TEXT NOT NULL REFERENCES employees(id),
  competency_id TEXT NOT NULL REFERENCES competencies(id),
  status TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  UNIQUE (employee_id, competency_id)
);
CREATE TABLE IF NOT EXISTS competency_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  competency_id TEXT NOT NULL REFERENCES competencies(id),
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

function ensureCompetenciesParentFk() {
  const sqlite = getSqlite();
  const row = sqlite
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'competencies'")
    .get() as { sql?: string } | undefined;
  const sql = row?.sql ?? "";
  if (/parent_id TEXT REFERENCES competencies\(id\)/i.test(sql)) return;
  sqlite.exec(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE competencies_new (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL,
      parent_id TEXT REFERENCES competencies_new(id),
      updated_at INTEGER NOT NULL
    );
    INSERT INTO competencies_new SELECT id, name, description, type, parent_id, updated_at FROM competencies;
    DROP TABLE competencies;
    ALTER TABLE competencies_new RENAME TO competencies;
    PRAGMA foreign_keys = ON;
  `);
}

function ensureParentNameIndex() {
  const sqlite = getSqlite();
  sqlite.exec(`
    DROP INDEX IF EXISTS competencies_parent_name;
    CREATE UNIQUE INDEX competencies_parent_name
      ON competencies (IFNULL(parent_id, ''), name);
  `);
}

function ensureIdpActiveIndex() {
  getSqlite().exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idps_one_active
      ON idps (employee_id) WHERE status = 'active';
  `);
}

function idpColumnNames() {
  return new Set(
    (getSqlite().prepare("PRAGMA table_info(idps)").all() as { name: string }[]).map((row) => row.name),
  );
}

function ensureIdpDocumentColumns() {
  const sqlite = getSqlite();
  const names = idpColumnNames();
  if (!names.has("source_job_id")) {
    sqlite.exec("ALTER TABLE idps ADD COLUMN source_job_id TEXT REFERENCES jobs(id)");
  }
  if (!names.has("created_by_id")) {
    sqlite.exec("ALTER TABLE idps ADD COLUMN created_by_id TEXT REFERENCES employees(id)");
  }
  sqlite.exec(`
    UPDATE idps
    SET source_job_id = (
      SELECT job_id FROM employees WHERE employees.id = idps.employee_id
    )
    WHERE source_job_id IS NULL OR source_job_id = '';
    UPDATE idps
    SET created_by_id = (
      SELECT COALESCE(manager_id, id) FROM employees WHERE employees.id = idps.employee_id
    )
    WHERE created_by_id IS NULL OR created_by_id = '';
  `);
}

function addColumnIfMissing(table: string, name: string, ddl: string) {
  const sqlite = getSqlite();
  const names = new Set(
    (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((row) => row.name),
  );
  if (!names.has(name)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

function isoDateFromUnix(unix: number) {
  const d = new Date(unix * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function ensureIdpPeriodColumns() {
  addColumnIfMissing("idps", "period_start", "period_start TEXT NOT NULL DEFAULT '1970-01-01'");
  addColumnIfMissing("idps", "period_end", "period_end TEXT NOT NULL DEFAULT '1970-01-01'");
  const sqlite = getSqlite();
  const rows = sqlite.prepare("SELECT id, updated_at, period_start, period_end FROM idps").all() as {
    id: string;
    updated_at: number;
    period_start: string;
    period_end: string;
  }[];
  for (const row of rows) {
    if (row.period_start !== "1970-01-01" && row.period_end !== "1970-01-01") continue;
    const start = isoDateFromUnix(row.updated_at || Math.floor(Date.now() / 1000));
    sqlite
      .prepare("UPDATE idps SET period_start = ?, period_end = ? WHERE id = ?")
      .run(start, addDays(start, 120), row.id);
  }
}

const ESB_ID = "comp-integracionnye-platformy-i-esb";
const ESB_NAME = "Интеграционные платформы, ESB и брокеры сообщений";
const BROKER_ID = "comp-rabota-s-brokerami-soobschenii";
const RELEASES_ID = "comp-upravlenie-vypuskami-i-konfiguraciyami";

function tableExists(name: string) {
  return Boolean(
    getSqlite().prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name),
  );
}

/** Пометки, пул, пункты и ссылки seed не пересобирает. Слияние компетенций переносит их до удаления справочника. */
function retargetMergedCompetencies() {
  const sqlite = getSqlite();
  if (!tableExists("competencies")) return;
  if (sqlite.prepare("SELECT 1 FROM competencies WHERE id = ?").get(ESB_ID)) {
    sqlite.prepare("UPDATE competencies SET name = ? WHERE id = ?").run(ESB_NAME, ESB_ID);
  }

  const move = (table: string, keyColumns: string[], nameColumn?: string) => {
    if (!tableExists(table)) return;
    const keys = keyColumns.map((column) => `${table}.${column}`).join(", ");
    sqlite
      .prepare(
        `DELETE FROM ${table}
         WHERE competency_id = ?
           AND (${keys}) IN (SELECT ${keyColumns.join(", ")} FROM ${table} WHERE competency_id = ?)`,
      )
      .run(BROKER_ID, ESB_ID);
    if (nameColumn) {
      sqlite
        .prepare(`UPDATE ${table} SET competency_id = ?, ${nameColumn} = ? WHERE competency_id = ?`)
        .run(ESB_ID, ESB_NAME, BROKER_ID);
      sqlite.prepare(`UPDATE ${table} SET ${nameColumn} = ? WHERE competency_id = ?`).run(ESB_NAME, ESB_ID);
    } else {
      sqlite.prepare(`UPDATE ${table} SET competency_id = ? WHERE competency_id = ?`).run(ESB_ID, BROKER_ID);
    }
    sqlite.prepare(`DELETE FROM ${table} WHERE competency_id = ?`).run(RELEASES_ID);
  };

  move("employee_competency_marks", ["employee_id"]);
  move("idp_pool", ["idp_id"], "competency_name");
  move("idp_items", ["id"], "competency_name");
  if (tableExists("idp_assignments")) {
    if (tableExists("idp_items")) {
      sqlite
        .prepare(
          `UPDATE idp_items SET assignment_id = NULL
           WHERE assignment_id IN (
             SELECT id FROM idp_assignments
             WHERE competency_id = ?
               AND EXISTS (
                 SELECT 1 FROM idp_assignments AS kept
                 WHERE kept.competency_id = ?
                   AND kept.name = idp_assignments.name
                   AND kept.archived = 0
               )
           )`,
        )
        .run(BROKER_ID, ESB_ID);
      sqlite
        .prepare(
          `UPDATE idp_items SET assignment_id = NULL
           WHERE assignment_id IN (SELECT id FROM idp_assignments WHERE competency_id = ?)`,
        )
        .run(RELEASES_ID);
    }
    const dropTests = (whereSql: string, ...params: string[]) => {
      if (!tableExists("idp_assignment_questions")) return;
      if (tableExists("idp_assignment_options")) {
        sqlite
          .prepare(
            `DELETE FROM idp_assignment_options
             WHERE question_id IN (
               SELECT id FROM idp_assignment_questions
               WHERE assignment_id IN (SELECT id FROM idp_assignments WHERE ${whereSql})
             )`,
          )
          .run(...params);
      }
      sqlite
        .prepare(
          `DELETE FROM idp_assignment_questions
           WHERE assignment_id IN (SELECT id FROM idp_assignments WHERE ${whereSql})`,
        )
        .run(...params);
    };
    const duplicateWhere = `competency_id = ?
           AND EXISTS (
             SELECT 1 FROM idp_assignments AS kept
             WHERE kept.competency_id = ?
               AND kept.name = idp_assignments.name
               AND kept.archived = 0
           )`;
    dropTests(duplicateWhere, BROKER_ID, ESB_ID);
    sqlite.prepare(`DELETE FROM idp_assignments WHERE ${duplicateWhere}`).run(BROKER_ID, ESB_ID);
    sqlite.prepare("UPDATE idp_assignments SET competency_id = ? WHERE competency_id = ?").run(ESB_ID, BROKER_ID);
    dropTests("competency_id = ?", RELEASES_ID);
    sqlite.prepare("DELETE FROM idp_assignments WHERE competency_id = ?").run(RELEASES_ID);
  }
  move("competency_links", ["id"]);
}

function ensureAssignmentTables() {
  const sqlite = getSqlite();
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS idp_assignments (
      id TEXT PRIMARY KEY,
      competency_id TEXT NOT NULL REFERENCES competencies(id),
      name TEXT NOT NULL,
      learn_text TEXT NOT NULL,
      verify_text TEXT NOT NULL,
      level INTEGER,
      archived INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idp_assignments_active_name
      ON idp_assignments (competency_id, name) WHERE archived = 0;
    CREATE TABLE IF NOT EXISTS idp_pool (
      idp_id TEXT NOT NULL REFERENCES idps(id),
      competency_id TEXT NOT NULL,
      competency_name TEXT NOT NULL,
      required_level INTEGER,
      UNIQUE (idp_id, competency_id)
    );
  `);
}

function idpItemHasKind() {
  const sqlite = getSqlite();
  const names = new Set(
    (sqlite.prepare("PRAGMA table_info(idp_items)").all() as { name: string }[]).map((row) => row.name),
  );
  return names.has("kind") || !names.has("assignment_name");
}

function rebuildIdpItems() {
  if (!idpItemHasKind()) return;
  const sqlite = getSqlite();
  sqlite.exec(`
    PRAGMA foreign_keys = OFF;
    DROP TABLE IF EXISTS idp_items;
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
    PRAGMA foreign_keys = ON;
  `);
}

/**
 * Схема каталога и выдач (ADR 0010). Таблиц нет в общем `DDL`, потому что сразу после их создания
 * выполняется однократный перенос прежних вычисляемых достижений, а он должен видеть, были ли таблицы.
 * Создание и заполнение идут одной транзакцией: иначе сбой между ними оставил бы базу без переноса.
 */
function ensureAchievementTables() {
  // Перенос идёт один раз: в базе main нет таблицы выдач, а создаётся она вместе с каталогом.
  const fresh = !tableExists("employee_achievements");
  const sqlite = getSqlite();
  sqlite
    .transaction(() => {
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS achievements (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          category TEXT NOT NULL,
          rule TEXT NOT NULL,
          rule_param TEXT,
          icon TEXT NOT NULL,
          archived INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS employee_achievements (
          employee_id TEXT NOT NULL REFERENCES employees(id),
          achievement_id TEXT NOT NULL REFERENCES achievements(id),
          source TEXT NOT NULL,
          rule_key TEXT,
          source_ref TEXT,
          granted_at INTEGER NOT NULL,
          granted_by_id TEXT REFERENCES employees(id),
          revoked_at INTEGER,
          revoked_by_id TEXT REFERENCES employees(id),
          revoke_reason TEXT,
          PRIMARY KEY (employee_id, achievement_id)
        );
        CREATE INDEX IF NOT EXISTS employee_achievements_achievement ON employee_achievements (achievement_id);
      `);
      fillAchievementCatalog();
      if (fresh) backfillLegacyAchievements();
      return true;
    })
    .immediate(null);
}

/** Дополняет каталог записями seed по ключу. Существующие строки, включая правки админа, не перезаписываются. */
function fillAchievementCatalog() {
  const sqlite = getSqlite();
  const insert = sqlite.prepare(`
    INSERT OR IGNORE INTO achievements
      (id, title, description, category, rule, rule_param, icon, archived, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
  `);
  const t = now();
  for (const row of catalogSeed.achievements as AchievementRecord[]) {
    insert.run(row.id, row.title, row.description, row.category, row.rule, row.ruleParam, row.icon, t);
  }
}

/** Ачивка, которую до появления таблиц считали по приёмкам, и правило, под которым она выдавалась. */
const LEGACY_ACHIEVEMENTS = {
  firstStep: { id: "idp-first-step", rule: "idp.first-accepted-item" },
  poolClosed: { id: "idp-pool-closed", rule: "idp.pool-confirmed" },
  completed: { id: "idp-completed", rule: "idp.completed" },
} as const;

/**
 * Переносит прежние вычисляемые достижения в выдачи (ADR 0010): по одной строке на сотрудника.
 * Подтверждение конкретной компетенции не переносится — это блок страницы, а не достижение.
 * `INSERT OR IGNORE` не трогает уже выданное: отозванная вручную строка не оживает.
 */
function backfillLegacyAchievements() {
  const sqlite = getSqlite();
  const insert = sqlite.prepare(`
    INSERT OR IGNORE INTO employee_achievements
      (employee_id, achievement_id, source, rule_key, source_ref, granted_at)
    VALUES (?, ?, 'auto', ?, ?, ?)
  `);
  /** Выдаёт достижение, но не больше одного раза на сотрудника: строки уже упорядочены, берём первую. */
  const grant = (rows: { employeeId: string; idpId: string; grantedAt: number }[], achievement: { id: string; rule: string }) => {
    const seen = new Set<string>();
    for (const row of rows) {
      if (seen.has(row.employeeId)) continue;
      seen.add(row.employeeId);
      insert.run(row.employeeId, achievement.id, achievement.rule, row.idpId, row.grantedAt);
    }
  };

  // Первая принятая строка за всё время: самое раннее подтверждение, при равном времени — меньший id строки.
  grant(
    sqlite
      .prepare(
        `SELECT i.employee_id AS employeeId, it.idp_id AS idpId, it.accepted_at AS grantedAt
         FROM idp_items AS it
         JOIN idps AS i ON i.id = it.idp_id
         WHERE it.accepted_at IS NOT NULL AND i.status <> 'cancelled'
         ORDER BY i.employee_id, it.accepted_at, it.id`,
      )
      .all() as { employeeId: string; idpId: string; grantedAt: number }[],
    LEGACY_ACHIEVEMENTS.firstStep,
  );

  // Пул закрыт: в плане есть пул и у каждой его компетенции все строки приняты.
  // План выбирается по id, дата — последняя приёмка плана: момента «пул закрылся» в базе нет.
  grant(
    sqlite
      .prepare(
        `SELECT i.employee_id AS employeeId, i.id AS idpId,
                (SELECT MAX(it.accepted_at) FROM idp_items AS it WHERE it.idp_id = i.id) AS grantedAt
         FROM idps AS i
         WHERE i.status <> 'cancelled'
           AND EXISTS (SELECT 1 FROM idp_pool AS p WHERE p.idp_id = i.id)
           AND NOT EXISTS (
             SELECT 1 FROM idp_pool AS p
             WHERE p.idp_id = i.id
               AND (
                 NOT EXISTS (
                   SELECT 1 FROM idp_items AS it
                   WHERE it.idp_id = i.id AND it.competency_id = p.competency_id
                 )
                 OR EXISTS (
                   SELECT 1 FROM idp_items AS it
                   WHERE it.idp_id = i.id AND it.competency_id = p.competency_id AND it.accepted_at IS NULL
                 )
               )
           )
         ORDER BY i.employee_id, i.id`,
      )
      .all() as { employeeId: string; idpId: string; grantedAt: number }[],
    LEGACY_ACHIEVEMENTS.poolClosed,
  );

  // ИПР выполнен: достаточно одного выполненного плана. Дату выполнения отдельно не хранят,
  // поэтому в `granted_at` идёт `updated_at` — последняя правка плана.
  grant(
    sqlite
      .prepare(
        `SELECT employee_id AS employeeId, id AS idpId, updated_at AS grantedAt
         FROM idps
         WHERE status = 'completed'
         ORDER BY employee_id, id`,
      )
      .all() as { employeeId: string; idpId: string; grantedAt: number }[],
    LEGACY_ACHIEVEMENTS.completed,
  );
}

export function migrate() {
  getSqlite().exec(DDL);
  addColumnIfMissing("employee_competency_marks", "note", "note TEXT NOT NULL DEFAULT ''");
  ensureCompetenciesParentFk();
  ensureParentNameIndex();
  ensureIdpActiveIndex();
  ensureIdpDocumentColumns();
  ensureIdpPeriodColumns();
  ensureAssignmentTables();
  rebuildIdpItems();
  addColumnIfMissing("idp_assignments", "level", "level INTEGER");
  addColumnIfMissing("idp_items", "assignment_level", "assignment_level INTEGER");
  retargetMergedCompetencies();
  ensureAchievementTables();
}
