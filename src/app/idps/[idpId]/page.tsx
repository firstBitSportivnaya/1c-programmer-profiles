import { notFound, redirect } from "next/navigation";
import { IdpBlock } from "@/components/IdpBlock";
import { getSessionEmployee, type SessionEmployee } from "@/lib/auth";
import { canViewEmployee } from "@/lib/invariants";
import { getEmployee, getIdp, getJob, listIdpItems } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function JobName({ jobId }: { jobId: string }) {
  const job = getJob(jobId);
  if (!job) return jobId;
  return (
    <a className="link-accent" href={`/jobs/${job.id}`}>
      {job.name}
    </a>
  );
}

function PersonName({ actor, employeeId }: { actor: SessionEmployee; employeeId: string }) {
  const person = getEmployee(employeeId);
  if (!person) return employeeId;
  if (!canViewEmployee(actor, employeeId)) return person.name;
  const href = person.id === actor.id ? "/me" : `/people/${employeeId}`;
  return (
    <a className="link-accent" href={href}>
      {person.name}
    </a>
  );
}

export default async function IdpPage({ params }: { params: Promise<{ idpId: string }> }) {
  const actor = await getSessionEmployee();
  if (!actor) redirect("/login");
  const { idpId } = await params;
  const idp = getIdp(idpId);
  if (!idp) notFound();
  if (!canViewEmployee(actor, idp.employeeId)) notFound();
  const target = getJob(idp.targetJobId);
  const items = listIdpItems(idp.id);

  return (
    <article className="space-y-6">
      <p className="text-sm">
        <a href="/idps" className="link-accent">
          ← Все ИПР
        </a>
      </p>
      <div className="page-kicker">
        <span className="pulse-dot" />
        <h1 className="page-title">ИПР: {target?.name ?? idp.targetJobId}</h1>
      </div>
      <dl className="panel panel-pad grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
        <dt className="muted">Сотрудник</dt>
        <dd>
          <PersonName actor={actor} employeeId={idp.employeeId} />
        </dd>
        <dt className="muted">Текущая должность</dt>
        <dd>
          <JobName jobId={idp.sourceJobId} />
        </dd>
        <dt className="muted">Целевая должность</dt>
        <dd>
          <JobName jobId={idp.targetJobId} />
        </dd>
        <dt className="muted">Создал</dt>
        <dd>
          <PersonName actor={actor} employeeId={idp.createdById} />
        </dd>
      </dl>
      <IdpBlock actor={actor} idp={idp} items={items} />
    </article>
  );
}
