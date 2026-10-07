import { CareerGraphView } from "@/components/CareerGraphView";
import { NewJobForm } from "@/components/NewJobForm";
import { jobsWithProfiles, listJobs, listTransitions } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LANE: Record<string, string> = {
  executor: "Исполнитель",
  manager: "Руководитель",
  other: "Другое",
};

export default function HomePage() {
  const jobs = listJobs();
  const transitions = listTransitions();
  const profiled = new Set(jobsWithProfiles().map((job) => job.id));
  const profileJobIds = jobs.filter((job) => profiled.has(job.id)).map((job) => job.id);

  return (
    <div className="space-y-10">
      <section>
        <div className="page-kicker">
          <span className="pulse-dot" />
          <h1 className="page-title">Схема развития</h1>
        </div>
        <CareerGraphView jobs={jobs} transitions={transitions} profileJobIds={profileJobIds} />
      </section>
      <section>
        <h2 className="section-title">Должности</h2>
        <ul className="panel">
          {jobs.map((job) => (
            <li key={job.id} className="list-row">
              <div>
                <a
                  href={profiled.has(job.id) ? `/jobs/${job.id}/profile` : `/jobs/${job.id}`}
                  className="link-accent font-medium"
                >
                  {job.name}
                </a>
                <div className="mt-1 text-xs muted">
                  {LANE[job.lane]}
                  {profiled.has(job.id) ? " · профиль есть" : " · профиль не заполнен"}
                </div>
              </div>
              {profiled.has(job.id) ? null : <span className="chip">пусто</span>}
            </li>
          ))}
        </ul>
        <NewJobForm />
      </section>
    </div>
  );
}
