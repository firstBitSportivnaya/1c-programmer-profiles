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

export function migrate() {
  getSqlite().exec(DDL);
  ensureCompetenciesParentFk();
  ensureParentNameIndex();
}
