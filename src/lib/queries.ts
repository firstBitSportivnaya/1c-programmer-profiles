import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { migrate } from "@/db/migrate";
import { competencies, jobTransitions, jobs, profileSkills, profiles } from "@/db/schema";
import { sectionForType } from "@/lib/invariants";

let migrated = false;
export function ensureSchema() {
  if (!migrated) {
    migrate();
    migrated = true;
  }
}

export function listJobs() {
  ensureSchema();
  return getDb().select().from(jobs).orderBy(asc(jobs.rankOrder), asc(jobs.name)).all();
}

export function getJob(id: string) {
  ensureSchema();
  return getDb().select().from(jobs).where(eq(jobs.id, id)).get();
}

export function listTransitions() {
  ensureSchema();
  return getDb().select().from(jobTransitions).all();
}

export function outgoingTransitions(jobId: string) {
  ensureSchema();
  return getDb().select().from(jobTransitions).where(eq(jobTransitions.fromJobId, jobId)).all();
}

export function getProfileByJob(jobId: string) {
  ensureSchema();
  return getDb().select().from(profiles).where(eq(profiles.jobId, jobId)).get();
}

export function listCompetencies() {
  ensureSchema();
  return getDb().select().from(competencies).orderBy(asc(competencies.name)).all();
}

export function getCompetency(id: string) {
  ensureSchema();
  return getDb().select().from(competencies).where(eq(competencies.id, id)).get();
}

export function profileSkillRows(profileId: string) {
  ensureSchema();
  return getDb()
    .select({
      skill: profileSkills,
      competency: competencies,
    })
    .from(profileSkills)
    .innerJoin(competencies, eq(profileSkills.competencyId, competencies.id))
    .where(eq(profileSkills.profileId, profileId))
    .orderBy(asc(profileSkills.sortOrder))
    .all();
}

export type ProfileSkillRow = ReturnType<typeof profileSkillRows>[number];

export type SkillCluster = {
  key: string;
  title: string | null;
  rows: ProfileSkillRow[];
};

export function clusterSkillRows(rows: ProfileSkillRow[]): SkillCluster[] {
  const byId = new Map(listCompetencies().map((c) => [c.id, c]));
  const buckets = new Map<string, ProfileSkillRow[]>();
  const order: string[] = [];
  for (const row of rows) {
    const parent = row.competency.parentId ? byId.get(row.competency.parentId) : undefined;
    const key = parent ? parent.id : `skill:${row.competency.id}`;
    if (!buckets.has(key)) {
      buckets.set(key, []);
      order.push(key);
    }
    buckets.get(key)!.push(row);
  }
  return order.map((key) => {
    const clusterRows = buckets.get(key)!;
    const parent = byId.get(key);
    if (!parent) {
      return { key, title: null, rows: clusterRows };
    }
    return { key, title: parent.name, rows: clusterRows };
  });
}

export function groupedProfile(jobId: string) {
  const profile = getProfileByJob(jobId);
  if (!profile) return null;
  const rows = profileSkillRows(profile.id);
  return {
    profile,
    technical: rows.filter((r) => sectionForType(r.competency.type) === "technical"),
    personal: rows.filter((r) => sectionForType(r.competency.type) === "personal"),
    duties: rows.filter((r) => sectionForType(r.competency.type) === "duties"),
  };
}

export function compareJobs(aId: string, bId: string) {
  const a = groupedProfile(aId);
  const b = groupedProfile(bId);
  if (!a || !b) return { error: "both-need-profiles" as const };
  const mapA = new Map(a.technical.concat(a.personal, a.duties).map((r) => [r.competency.id, r]));
  const mapB = new Map(b.technical.concat(b.personal, b.duties).map((r) => [r.competency.id, r]));
  const ids = new Set([...mapA.keys(), ...mapB.keys()]);
  const lines = [...ids].map((id) => {
    const left = mapA.get(id);
    const right = mapB.get(id);
    const name = left?.competency.name ?? right!.competency.name;
    const type = left?.competency.type ?? right!.competency.type;
    const levelA = left?.skill.level ?? null;
    const levelB = right?.skill.level ?? null;
    const criteriaA = left?.skill.criteria ?? null;
    const criteriaB = right?.skill.criteria ?? null;
    const presentA = Boolean(left);
    const presentB = Boolean(right);
    let change: "added" | "removed" | "level" | "criteria" | "same" = "same";
    if (presentA && !presentB) change = "removed";
    else if (!presentA && presentB) change = "added";
    else if (type !== "duty" && levelA !== levelB) change = "level";
    else if ((criteriaA ?? "") !== (criteriaB ?? "")) change = "criteria";
    return { id, name, type, presentA, presentB, levelA, levelB, criteriaA, criteriaB, change };
  });
  lines.sort((x, y) => x.name.localeCompare(y.name, "ru"));
  return { aJobId: aId, bJobId: bId, lines };
}

export function unusedCompetencies(profileId: string, type: string) {
  ensureSchema();
  const used = getDb()
    .select()
    .from(profileSkills)
    .where(eq(profileSkills.profileId, profileId))
    .all()
    .map((s) => s.competencyId);
  const all = listCompetencies();
  return all.filter((c) => {
    if (c.type !== type) return false;
    if (used.includes(c.id)) return false;
    if (all.some((x) => x.parentId === c.id)) return false;
    return true;
  });
}
