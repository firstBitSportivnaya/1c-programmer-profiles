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
  parent_id TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id),
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS competencies_parent_name
  ON competencies (IFNULL(parent_id, ''), name);
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

export function migrate() {
  getSqlite().exec(DDL);
}
