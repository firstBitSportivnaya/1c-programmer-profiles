import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  rankOrder: integer("rank_order").notNull(),
  lane: text("lane", { enum: ["executor", "manager", "other"] }).notNull(),
  yearsRequired: integer("years_required"),
  professionalStandard: text("professional_standard"),
  updatedAt: integer("updated_at").notNull(),
});

export const jobTransitions = sqliteTable(
  "job_transitions",
  {
    fromJobId: text("from_job_id")
      .notNull()
      .references(() => jobs.id),
    toJobId: text("to_job_id")
      .notNull()
      .references(() => jobs.id),
    kind: text("kind", { enum: ["linear", "level_change"] }).notNull(),
  },
  (t) => [uniqueIndex("job_transitions_unique").on(t.fromJobId, t.toJobId)],
);

export const competencies = sqliteTable(
  "competencies",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    type: text("type", { enum: ["professional", "universal", "duty"] }).notNull(),
    parentId: text("parent_id").references((): AnySQLiteColumn => competencies.id),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [uniqueIndex("competencies_parent_name").on(sql`IFNULL(${t.parentId}, '')`, t.name)],
);

export const profiles = sqliteTable("profiles", {
  id: text("id").primaryKey(),
  jobId: text("job_id")
    .notNull()
    .unique()
    .references(() => jobs.id),
  updatedAt: integer("updated_at").notNull(),
});

export const profileSkills = sqliteTable(
  "profile_skills",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id),
    competencyId: text("competency_id")
      .notNull()
      .references(() => competencies.id),
    level: integer("level"),
    criteria: text("criteria"),
    sortOrder: integer("sort_order").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [uniqueIndex("profile_skills_unique").on(t.profileId, t.competencyId)],
);

export const employees = sqliteTable("employees", {
  id: text("id").primaryKey(),
  login: text("login").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  jobId: text("job_id")
    .notNull()
    .references(() => jobs.id),
  managerId: text("manager_id").references((): AnySQLiteColumn => employees.id),
  isAdmin: integer("is_admin").notNull(),
  isActive: integer("is_active").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const idps = sqliteTable("idps", {
  id: text("id").primaryKey(),
  employeeId: text("employee_id")
    .notNull()
    .references(() => employees.id),
  sourceJobId: text("source_job_id")
    .notNull()
    .references(() => jobs.id),
  targetJobId: text("target_job_id")
    .notNull()
    .references(() => jobs.id),
  createdById: text("created_by_id")
    .notNull()
    .references(() => employees.id),
  status: text("status", { enum: ["active", "completed", "cancelled"] }).notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const idpItems = sqliteTable("idp_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  idpId: text("idp_id")
    .notNull()
    .references(() => idps.id),
  kind: text("kind", { enum: ["gap", "free"] }).notNull(),
  competencyId: text("competency_id"),
  competencyName: text("competency_name"),
  requiredLevel: integer("required_level"),
  body: text("body"),
  status: text("status", { enum: ["not_started", "in_progress", "done"] }).notNull(),
  sortOrder: integer("sort_order").notNull(),
});

export type JobLane = "executor" | "manager" | "other";
export type TransitionKind = "linear" | "level_change";
export type CompetencyType = "professional" | "universal" | "duty";
export type IdpStatus = "active" | "completed" | "cancelled";
export type IdpItemStatus = "not_started" | "in_progress" | "done";
export type IdpItemKind = "gap" | "free";
