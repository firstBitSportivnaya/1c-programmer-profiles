/**
 * Проверка seed/data.json и seed/fixtures/junior.json по docs/seed-contract.md.
 * Базу не открывает: годится и для локальной проверки, и для CI.
 */
import fs from "node:fs";
import path from "node:path";

type Job = {
  id: string;
  name: string;
  rankOrder: number;
  lane: string;
  yearsRequired: number | null;
  professionalStandard: string | null;
};
type Transition = { fromJobId: string; toJobId: string; kind: string };
type Competency = { id: string; name: string; description: string | null; type: string; parentId: string | null };
type Skill = { competencyId: string; level: number | null; criteria: string | null; sortOrder: number };
type Profile = { jobId: string; skills: Skill[] };
type Seed = { jobs: Job[]; transitions: Transition[]; competencies: Competency[]; profiles: Profile[] };

const FILLED_PROFILES = ["intern", "junior", "programmer", "senior", "lead", "architect", "team-lead"];
const LANES = new Set(["executor", "manager", "other"]);
const KINDS = new Set(["linear", "level_change"]);
const TYPES = new Set(["professional", "universal", "duty"]);

/** Читает JSON seed и проверяет, что файл кончается переводом строки. */
function readSeed(rel: string, errors: string[]): Seed {
  const text = fs.readFileSync(path.join(process.cwd(), rel), "utf8");
  if (!text.endsWith("\n")) errors.push(`${rel}: нет перевода строки в конце файла`);
  return JSON.parse(text) as Seed;
}

/** Возвращает значения, встречающиеся больше одного раза. */
function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
}

/** Инварианты должностей и переходов между ними. */
function checkJobs(data: Seed, errors: string[]) {
  for (const id of duplicates(data.jobs.map((j) => j.id))) errors.push(`jobs: повтор id ${id}`);
  for (const name of duplicates(data.jobs.map((j) => j.name))) errors.push(`jobs: повтор name ${name}`);
  for (const job of data.jobs) {
    if (!LANES.has(job.lane)) errors.push(`jobs.${job.id}: lane ${job.lane} вне ${[...LANES].join("|")}`);
  }

  const jobIds = new Set(data.jobs.map((j) => j.id));
  for (const tr of data.transitions) {
    const key = `${tr.fromJobId} -> ${tr.toJobId}`;
    if (!jobIds.has(tr.fromJobId) || !jobIds.has(tr.toJobId)) errors.push(`transitions ${key}: нет такой должности`);
    if (tr.fromJobId === tr.toJobId) errors.push(`transitions ${key}: переход в саму себя`);
    if (!KINDS.has(tr.kind)) errors.push(`transitions ${key}: kind ${tr.kind} вне ${[...KINDS].join("|")}`);
  }
  for (const pair of duplicates(data.transitions.map((t) => `${t.fromJobId} -> ${t.toJobId}`))) {
    errors.push(`transitions: повтор ${pair}`);
  }
}

/** Инварианты справочника компетенций: тип, глубина дерева, уникальность имени в корне. */
function checkCompetencies(data: Seed, errors: string[]) {
  const byId = new Map(data.competencies.map((c) => [c.id, c]));
  for (const id of duplicates(data.competencies.map((c) => c.id))) errors.push(`competencies: повтор id ${id}`);
  for (const c of data.competencies) {
    if (!TYPES.has(c.type)) errors.push(`competencies.${c.id}: type ${c.type} вне ${[...TYPES].join("|")}`);
    if (!c.parentId) continue;
    const parent = byId.get(c.parentId);
    if (!parent) {
      errors.push(`competencies.${c.id}: нет родителя ${c.parentId}`);
      continue;
    }
    if (parent.parentId) errors.push(`competencies.${c.id}: родитель ${parent.id} не корень (глубина > 1)`);
    if (parent.type !== c.type) errors.push(`competencies.${c.id}: type ${c.type} не совпадает с корнем ${parent.type}`);
  }
  for (const key of duplicates(data.competencies.map((c) => `${c.parentId ?? ""}/${c.name}`))) {
    errors.push(`competencies: повтор имени внутри корня ${key}`);
  }
}

/** Инварианты профилей: состав заполненных должностей и уровни строк. */
function checkProfiles(data: Seed, errors: string[]) {
  const jobIds = new Set(data.jobs.map((j) => j.id));
  const competencyById = new Map(data.competencies.map((c) => [c.id, c]));
  const profileJobIds = data.profiles.map((p) => p.jobId);

  for (const id of duplicates(profileJobIds)) errors.push(`profiles: повтор jobId ${id}`);
  const expected = [...FILLED_PROFILES].sort().join(",");
  const actual = [...new Set(profileJobIds)].sort().join(",");
  if (expected !== actual) errors.push(`profiles: ожидаются ровно ${expected}, есть ${actual}`);

  for (const profile of data.profiles) {
    if (!jobIds.has(profile.jobId)) errors.push(`profiles.${profile.jobId}: нет такой должности`);
    for (const id of duplicates(profile.skills.map((s) => s.competencyId))) {
      errors.push(`profiles.${profile.jobId}: компетенция ${id} дважды`);
    }
    for (const skill of profile.skills) {
      const where = `profiles.${profile.jobId}.${skill.competencyId}`;
      const competency = competencyById.get(skill.competencyId);
      if (!competency) {
        errors.push(`${where}: нет такой компетенции`);
        continue;
      }
      if (competency.type === "duty" && skill.level !== null) errors.push(`${where}: у обязанности level должен быть null`);
      if (competency.type !== "duty" && ![1, 2, 3].includes(skill.level as number)) {
        errors.push(`${where}: level ${skill.level}, ожидается 1, 2 или 3`);
      }
    }
  }
}

/**
 * Фикстура — подмножество data.json: каждая её запись совпадает с одноимённой в основных данных.
 * И сама по себе целая: ссылки профиля, переходов и родителей ведут внутрь фикстуры.
 */
function checkFixture(data: Seed, fixture: Seed, errors: string[]) {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const compare = <T>(section: string, items: T[], source: T[], key: (item: T) => string) => {
    const sourceByKey = new Map(source.map((item) => [key(item), item]));
    for (const item of items) {
      const original = sourceByKey.get(key(item));
      if (!original) errors.push(`fixture ${section}.${key(item)}: нет в data.json`);
      else if (!same(item, original)) errors.push(`fixture ${section}.${key(item)}: расходится с data.json`);
    }
  };
  compare("jobs", fixture.jobs, data.jobs, (j) => j.id);
  compare("transitions", fixture.transitions, data.transitions, (t) => `${t.fromJobId}->${t.toJobId}`);
  compare("competencies", fixture.competencies, data.competencies, (c) => c.id);
  compare("profiles", fixture.profiles, data.profiles, (p) => p.jobId);

  const jobIds = new Set(fixture.jobs.map((j) => j.id));
  const competencyIds = new Set(fixture.competencies.map((c) => c.id));
  for (const c of fixture.competencies) {
    if (c.parentId && !competencyIds.has(c.parentId)) errors.push(`fixture competencies.${c.id}: нет родителя ${c.parentId}`);
  }
  for (const tr of fixture.transitions) {
    if (!jobIds.has(tr.fromJobId) || !jobIds.has(tr.toJobId)) {
      errors.push(`fixture transitions ${tr.fromJobId} -> ${tr.toJobId}: нет должности в фикстуре`);
    }
  }
  for (const profile of fixture.profiles) {
    if (!jobIds.has(profile.jobId)) errors.push(`fixture profiles.${profile.jobId}: нет должности в фикстуре`);
    for (const skill of profile.skills) {
      if (!competencyIds.has(skill.competencyId)) {
        errors.push(`fixture profiles.${profile.jobId}.${skill.competencyId}: нет компетенции в фикстуре`);
      }
    }
  }
}

function main() {
  const errors: string[] = [];
  const data = readSeed(path.join("seed", "data.json"), errors);
  const fixture = readSeed(path.join("seed", "fixtures", "junior.json"), errors);

  checkJobs(data, errors);
  checkCompetencies(data, errors);
  checkProfiles(data, errors);
  checkFixture(data, fixture, errors);

  if (errors.length > 0) {
    console.error(`seed: ${errors.length} нарушений`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(
    `seed ok: jobs=${data.jobs.length} transitions=${data.transitions.length} competencies=${data.competencies.length} profiles=${data.profiles.length}`,
  );
}

main();
