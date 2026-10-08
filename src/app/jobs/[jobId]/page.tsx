import { notFound, redirect } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { JobAdminPanel, JobFacts, NextJobs } from "@/components/JobOverview";
import { createProfileAction } from "@/app/actions";
import { isAdmin } from "@/lib/auth";
import { getJob, getProfileByJob } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function JobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = getJob(jobId);
  if (!job) notFound();
  if (getProfileByJob(jobId)) redirect(`/jobs/${jobId}/profile`);
  const admin = await isAdmin();

  return (
    <article className="space-y-6">
      <div className="page-kicker">
        <span className="pulse-dot" />
        <h1 className="page-title">{job.name}</h1>
      </div>
      <JobFacts job={job} />

      <div className="panel panel-pad" style={{ borderStyle: "dashed" }}>
        <p className="mb-3 muted">Профиль не заполнен.</p>
        {admin ? (
          <ActionForm action={createProfileAction}>
            <input type="hidden" name="jobId" value={jobId} />
            <button className="btn-primary" type="submit">
              Создать пустой профиль
            </button>
          </ActionForm>
        ) : null}
      </div>

      <NextJobs jobId={jobId} admin={admin} />
      {admin ? <JobAdminPanel job={job} /> : null}
    </article>
  );
}
