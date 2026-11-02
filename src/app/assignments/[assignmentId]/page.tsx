import { notFound, redirect } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { AssignmentTestFields } from "@/components/AssignmentTestFields";
import { archiveAssignmentAction, saveAssignmentAction, saveAssignmentTestAction } from "@/app/idp-actions";
import { getSessionEmployee } from "@/lib/auth";
import { canEditAssignmentCatalog } from "@/lib/invariants";
import { assignmentCompetencies, getCompetency, getIdpAssignment, listAssignmentTest } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AssignmentPage({ params }: { params: Promise<{ assignmentId: string }> }) {
  const actor = await getSessionEmployee();
  if (!actor) redirect("/login");
  if (!canEditAssignmentCatalog(actor)) redirect("/idps");
  const { assignmentId } = await params;
  const row = getIdpAssignment(assignmentId);
  if (!row) notFound();
  const competency = getCompetency(row.competencyId);
  const listed = assignmentCompetencies();
  const competencies = listed.some((item) => item.id === row.competencyId)
    ? listed
    : [{ id: row.competencyId, name: competency?.name ?? row.competencyId }, ...listed];
  const test = listAssignmentTest(row.id);

  return (
    <div className="space-y-6">
      <p>
        <a href="/assignments" className="link-accent">
          ← Все задания
        </a>
      </p>
      <div className="page-kicker">
        <span className="pulse-dot" />
        <h1 className="page-title">{row.name}</h1>
      </div>
      {row.archived !== 0 ? (
        <p>
          <span className="lbl">Компетенция</span>
          <span className="mt-1 block">{competency?.name ?? row.competencyId}</span>
        </p>
      ) : null}
      {row.archived === 0 ? (
        <ActionForm action={saveAssignmentAction} className="panel panel-pad grid gap-3 md:grid-cols-2">
          <input type="hidden" name="id" value={row.id} />
          <label className="lbl md:col-span-2">
            Компетенция
            <select name="competencyId" className="field mt-1" defaultValue={row.competencyId}>
              {competencies.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="lbl">
            Уровень
            <select name="level" className="field" defaultValue={row.level == null ? "" : String(row.level)}>
              <option value="">не задан</option>
              <option value="1">1 · базовый</option>
              <option value="2">2 · уверенный</option>
              <option value="3">3 · эксперт</option>
            </select>
          </label>
          <label className="lbl md:col-span-2">
            Название
            <input className="field" name="name" defaultValue={row.name} />
          </label>
          <label className="lbl">
            Узнать
            <textarea className="field" name="learnText" rows={4} defaultValue={row.learnText} />
          </label>
          <label className="lbl">
            Проверить
            <textarea className="field" name="verifyText" rows={4} defaultValue={row.verifyText} />
          </label>
          <button className="btn-primary w-fit" type="submit">
            Сохранить
          </button>
        </ActionForm>
      ) : null}
      <ActionForm action={saveAssignmentTestAction} className="panel panel-pad space-y-3">
        <h2 className="section-title mb-0">Тест</h2>
        <input type="hidden" name="id" value={row.id} />
        <AssignmentTestFields
          initial={test.map((question) => ({
            prompt: question.prompt,
            options: question.options.map((option) => ({ text: option.text, isCorrect: option.isCorrect })),
          }))}
        />
        <button className="btn-primary" type="submit">
          Сохранить тест
        </button>
      </ActionForm>
      <ActionForm action={archiveAssignmentAction}>
        <input type="hidden" name="id" value={row.id} />
        <button className={row.archived === 1 ? "btn" : "btn-archive w-fit"} type="submit">
          {row.archived === 1 ? "Вернуть" : "Перенести в архив"}
        </button>
      </ActionForm>
    </div>
  );
}
