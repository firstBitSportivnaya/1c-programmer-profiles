import { getSqlite } from "./index";

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
  status TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS idp_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idp_id TEXT NOT NULL REFERENCES idps(id),
  kind TEXT NOT NULL,
  competency_id TEXT,
  competency_name TEXT,
  required_level INTEGER,
  body TEXT,
  status TEXT NOT NULL,
  sort_order INTEGER NOT NULL
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

export function migrate() {
  getSqlite().exec(DDL);
  ensureCompetenciesParentFk();
  ensureParentNameIndex();
  ensureIdpActiveIndex();
  ensureIdpDocumentColumns();
}
