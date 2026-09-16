import Link from "next/link";
import { CareerGraphView } from "@/components/CareerGraphView";
import { NewJobForm } from "@/components/NewJobForm";
import { getProfileByJob, listJobs, listTransitions } from "@/lib/queries";

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
  const profileJobIds = jobs.filter((j) => getProfileByJob(j.id)).map((j) => j.id);

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
                <Link href={`/jobs/${job.id}`} className="link-accent font-medium">
                  {job.name}
                </Link>
                <div className="mt-1 text-xs muted">
                  {LANE[job.lane]}
                  {profileJobIds.includes(job.id) ? " · профиль есть" : " · профиль не заполнен"}
                </div>
              </div>
              {profileJobIds.includes(job.id) ? (
                <Link href={`/jobs/${job.id}/profile`} className="nav-link">
                  Профиль
                </Link>
              ) : (
                <span className="chip">пусто</span>
              )}
            </li>
          ))}
        </ul>
        <NewJobForm />
      </section>
    </div>
  );
}
