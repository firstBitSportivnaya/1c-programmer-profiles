import fs from "node:fs";
import path from "node:path";
import { getDb, getSqlite, now } from "../src/db";
import { migrate } from "../src/db/migrate";
import { competencies, jobTransitions, jobs, profileSkills, profiles } from "../src/db/schema";

type Seed = {
  jobs: {
    id: string;
    name: string;
    rankOrder: number;
    lane: "executor" | "manager" | "other";
    yearsRequired: number | null;
    professionalStandard: string | null;
  }[];
  transitions: { fromJobId: string; toJobId: string; kind: "linear" | "level_change" }[];
  competencies: {
    id: string;
    name: string;
    description: string | null;
    type: "professional" | "universal" | "duty";
    parentId: string | null;
  }[];
  profiles: {
    jobId: string;
    skills: { competencyId: string; level: number | null; criteria: string | null; sortOrder: number }[];
  }[];
};

function backup(dbPath: string) {
  if (!fs.existsSync(dbPath)) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.copyFileSync(dbPath, `${dbPath}.${stamp}.bak`);
}

async function main() {
  const dbPath = path.join(process.cwd(), process.env.DB_PATH ?? "data/profiles.sqlite");
  backup(dbPath);

  const data: Seed = JSON.parse(fs.readFileSync(path.join("seed", "data.json"), "utf8"));
  migrate();
  const db = getDb();
  const t = now();

  getSqlite().transaction(() => {
    getSqlite().exec(`
      PRAGMA foreign_keys = OFF;
      DELETE FROM profile_skills;
      DELETE FROM profiles;
      DELETE FROM job_transitions;
      DELETE FROM competencies;
      DELETE FROM jobs;
      PRAGMA foreign_keys = ON;
    `);
    for (const job of data.jobs) {
      db.insert(jobs).values({ ...job, updatedAt: t }).run();
    }
    for (const tr of data.transitions) {
      db.insert(jobTransitions).values(tr).run();
    }
    const roots = data.competencies.filter((c) => !c.parentId);
    const leaves = data.competencies.filter((c) => c.parentId);
    for (const c of [...roots, ...leaves]) {
      db.insert(competencies)
        .values({
          id: c.id,
          name: c.name,
          description: c.description,
          type: c.type,
          parentId: c.parentId,
          updatedAt: t,
        })
        .run();
    }
    for (const p of data.profiles) {
      const profileId = `profile-${p.jobId}`;
      db.insert(profiles).values({ id: profileId, jobId: p.jobId, updatedAt: t }).run();
      for (const s of p.skills) {
        db.insert(profileSkills)
          .values({
            profileId,
            competencyId: s.competencyId,
            level: s.level,
            criteria: s.criteria,
            sortOrder: s.sortOrder,
            updatedAt: t,
          })
          .run();
      }
    }
    return true;
  }).deferred(null);

  console.log(
    `seeded jobs=${data.jobs.length} competencies=${data.competencies.length} profiles=${data.profiles.length}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
