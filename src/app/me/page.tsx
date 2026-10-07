import { redirect } from "next/navigation";
import { CompetencyMarks } from "@/components/CompetencyMarks";
import { EmployeeIdpSummary } from "@/components/IdpBlock";
import { getSessionEmployee } from "@/lib/auth";
import { getJob } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function MePage() {
  const employee = await getSessionEmployee();
  if (!employee) redirect("/login");
  const job = getJob(employee.jobId);
  return (
    <article className="space-y-6">
      <div className="page-kicker">
        <span className="pulse-dot" />
        <h1 className="page-title">{employee.name}</h1>
      </div>
      <dl className="panel panel-pad grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
        <dt className="muted">Логин</dt>
        <dd>{employee.login}</dd>
        <dt className="muted">Текущая должность</dt>
        <dd>
          {job ? (
            <a className="link-accent" href={`/jobs/${job.id}`}>
              {job.name}
            </a>
          ) : (
            employee.jobId
          )}
        </dd>
      </dl>
      <CompetencyMarks employeeId={employee.id} jobId={employee.jobId} />
      <EmployeeIdpSummary employeeId={employee.id} />
    </article>
  );
}
