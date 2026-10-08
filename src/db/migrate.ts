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
  archived INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
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
  learn_text TEXT NOT NULL,
  verify_text TEXT NOT NULL,
  due_on TEXT,
  status TEXT NOT NULL,
  accepted_by_id TEXT REFERENCES employees(id),
  accepted_at INTEGER,
  sort_order INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS employee_competency_marks (
  employee_id TEXT NOT NULL REFERENCES employees(id),
  competency_id TEXT NOT NULL REFERENCES competencies(id),
  status TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (employee_id, competency_id)
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

function ensureAssignmentTables() {
  const sqlite = getSqlite();
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS idp_assignments (
      id TEXT PRIMARY KEY,
      competency_id TEXT NOT NULL REFERENCES competencies(id),
      name TEXT NOT NULL,
      learn_text TEXT NOT NULL,
      verify_text TEXT NOT NULL,
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

export function migrate() {
  getSqlite().exec(DDL);
  ensureCompetenciesParentFk();
  ensureParentNameIndex();
  ensureIdpActiveIndex();
  ensureIdpDocumentColumns();
  ensureIdpPeriodColumns();
  ensureAssignmentTables();
  rebuildIdpItems();
}
