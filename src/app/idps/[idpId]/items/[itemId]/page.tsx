import { notFound, redirect } from "next/navigation";
import { ItemTestRun } from "@/components/ItemTestRun";
import { getSessionEmployee } from "@/lib/auth";
import { getIdpItem } from "@/lib/idp";
import { getIdp, listItemAttemptState, listItemTestsForTake } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function IdpItemTestPage({ params }: { params: Promise<{ idpId: string; itemId: string }> }) {
  const actor = await getSessionEmployee();
  if (!actor) redirect("/login");
  const { idpId, itemId: itemIdRaw } = await params;
  const itemId = Number(itemIdRaw);
  if (!Number.isInteger(itemId)) notFound();
  const idp = getIdp(idpId);
  if (!idp) notFound();
  const item = getIdpItem(itemId);
  if (!item || item.idpId !== idp.id) notFound();
  if (actor.id !== idp.employeeId) notFound();

  const questions = listItemTestsForTake([item.id]).get(item.id) ?? [];
  const attempt = listItemAttemptState([item.id]).get(item.id);
  const canTake = idp.status === "active" && item.acceptedAt == null && questions.length > 0;

  return (
    <article className="space-y-6">
      <p>
        <a href={`/idps/${idp.id}`} className="link-accent">
          ← ИПР
        </a>
      </p>
      <div className="page-kicker">
        <span className="pulse-dot" />
        <h1 className="page-title">{item.assignmentName}</h1>
      </div>
      <section className="panel panel-pad space-y-3">
        <h2 className="section-title mb-0">Проверить</h2>
        <p className="whitespace-pre-wrap">{item.verifyText}</p>
        {attempt?.passed === true ? <p>сдан</p> : null}
        {attempt?.passed === false ? <p>не сдан</p> : null}
        {(attempt?.count ?? 0) > 0 ? <p className="muted">Попыток: {attempt?.count}</p> : null}
      </section>
      {canTake ? <ItemTestRun itemId={item.id} questions={questions} /> : null}
    </article>
  );
}
