import { notFound, redirect } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { ExpandAll } from "@/components/ExpandAll";
import { JobAdminPanel, JobFacts, NextJobs } from "@/components/JobOverview";
import { deleteSkillAction, upsertSkillAction } from "@/app/actions";
import { isAdmin } from "@/lib/auth";
import { Fragment } from "react";
import { clusterSkillRows, getJob, groupedProfile, unusedCompetencies, type ProfileSkillRow } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LEVELS = [
  { value: "1", label: "1 · базовый" },
  { value: "2", label: "2 · уверенный" },
  { value: "3", label: "3 · эксперт" },
];

function levelLabel(level: number | null) {
  if (level === 1) return "базовый";
  if (level === 2) return "уверенный";
  if (level === 3) return "эксперт";
  return "—";
}

function skillCountLabel(n: number) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} навык`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} навыка`;
  return `${n} навыков`;
}

function SkillCard({
  row,
  admin,
  jobId,
}: {
  row: ProfileSkillRow;
  admin: boolean;
  jobId: string;
}) {
  return (
    <details className="skill-card">
      <summary className="skill-summary">
        <span className="skill-summary-body">
          <span className="skill-name">{row.competency.name}</span>
          {row.competency.type !== "duty" && row.skill.level != null ? (
            <span className="skill-level">
              Уровень {row.skill.level}: {levelLabel(row.skill.level)}
            </span>
          ) : null}
        </span>
      </summary>
      {admin ? (
        <ActionForm action={upsertSkillAction} className="mt-2 space-y-2 text-sm">
          <input type="hidden" name="jobId" value={jobId} />
          <input type="hidden" name="competencyId" value={row.competency.id} />
          {row.competency.type !== "duty" ? (
            <select name="level" defaultValue={row.skill.level == null ? "" : String(row.skill.level)} className="field">
              <option value="">уровень не задан</option>
              {LEVELS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          ) : (
            <p className="muted">Входит в профиль</p>
          )}
          <textarea name="criteria" defaultValue={row.skill.criteria ?? ""} rows={3} className="field" />
          <button className="btn-primary" type="submit">
            Сохранить
          </button>
        </ActionForm>
      ) : row.skill.criteria ? (
        <p className="skill-criteria">{row.skill.criteria}</p>
      ) : null}
      {admin ? (
        <ActionForm action={deleteSkillAction} className="mt-2">
          <input type="hidden" name="jobId" value={jobId} />
          <input type="hidden" name="skillId" value={row.skill.id} />
          <button className="btn-quiet" type="submit">
            Убрать строку
          </button>
        </ActionForm>
      ) : null}
    </details>
  );
}

function Section({
  title,
  className,
  rows,
  admin,
  jobId,
  type,
  unused,
}: {
  title: string;
  className: string;
  rows: ProfileSkillRow[];
  admin: boolean;
  jobId: string;
  type: string;
  unused: ReturnType<typeof unusedCompetencies>;
}) {
  const clusters = clusterSkillRows(rows);
  return (
    <section className={`panel panel-pad ${className}`}>
      <h2 className="section-title">{title}</h2>
      <div className="space-y-3">
        {clusters.map((cluster) =>
          cluster.title ? (
            <details key={cluster.key} className="skill-card">
              <summary className="skill-summary">
                <span className="skill-summary-body">
                  <span className="skill-name">{cluster.title}</span>
                  <span className="skill-level">{skillCountLabel(cluster.rows.length)}</span>
                </span>
              </summary>
              <div className="skill-group-body">
                {cluster.rows.map((row) => (
                  <SkillCard key={row.skill.id} row={row} admin={admin} jobId={jobId} />
                ))}
              </div>
            </details>
          ) : (
            <Fragment key={cluster.key}>
              {cluster.rows.map((row) => (
                <SkillCard key={row.skill.id} row={row} admin={admin} jobId={jobId} />
              ))}
            </Fragment>
          ),
        )}
      </div>
      {admin && unused.length > 0 ? (
        <ActionForm action={upsertSkillAction} className="mt-4 space-y-2 text-sm">
          <input type="hidden" name="jobId" value={jobId} />
          {type === "duty" ? <input type="hidden" name="level" value="" /> : null}
          <select name="competencyId" className="field">
            {unused.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {type !== "duty" ? (
            <select name="level" defaultValue="" className="field">
              <option value="">уровень не задан</option>
              {LEVELS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          ) : null}
          <textarea name="criteria" placeholder="Ожидание на грейде" className="field" rows={2} />
          <button className="btn" type="submit">
            Добавить
          </button>
        </ActionForm>
      ) : null}
    </section>
  );
}

export default async function ProfilePage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = getJob(jobId);
  if (!job) notFound();
  const grouped = groupedProfile(jobId);
  if (!grouped) {
    redirect(`/jobs/${jobId}`);
  }
  const admin = await isAdmin();
  const unusedTech = unusedCompetencies(grouped.profile.id, "professional");
  const unusedSoft = unusedCompetencies(grouped.profile.id, "universal");
  const unusedDuty = unusedCompetencies(grouped.profile.id, "duty");

  return (
    <article className="space-y-6">
      <div className="page-kicker">
        <span className="pulse-dot" />
        <h1 className="page-title">{job.name}</h1>
      </div>
      <JobFacts job={job} />
      <NextJobs jobId={jobId} admin={admin} />
      <ExpandAll className="grid gap-4 md:grid-cols-3">
        <Section
          title="Технические навыки"
          className="lane-tech"
          rows={grouped.technical}
          admin={admin}
          jobId={jobId}
          type="professional"
          unused={unusedTech}
        />
        <Section
          title="Личные навыки"
          className="lane-soft"
          rows={grouped.personal}
          admin={admin}
          jobId={jobId}
          type="universal"
          unused={unusedSoft}
        />
        <Section
          title="Функциональные обязанности"
          className="lane-duty"
          rows={grouped.duties}
          admin={admin}
          jobId={jobId}
          type="duty"
          unused={unusedDuty}
        />
      </ExpandAll>
      {admin ? <JobAdminPanel job={job} /> : null}
    </article>
  );
}
