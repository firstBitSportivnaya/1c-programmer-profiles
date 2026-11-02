import { redirect } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { saveAssignmentAction } from "@/app/idp-actions";
import { getSessionEmployee } from "@/lib/auth";
import { canEditAssignmentCatalog } from "@/lib/invariants";
import { assignmentCompetencies } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function NewAssignmentPage() {
  const actor = await getSessionEmployee();
  if (!actor) redirect("/login");
  if (!canEditAssignmentCatalog(actor)) redirect("/idps");
  const competencies = assignmentCompetencies();

  return (
    <div className="space-y-6">
      <p>
        <a href="/assignments" className="link-accent">
          ← Все задания
        </a>
      </p>
      <div className="page-kicker">
        <span className="pulse-dot" />
        <h1 className="page-title">Новое задание</h1>
      </div>
      <ActionForm
        action={saveAssignmentAction}
        successPath="/assignments/{id}"
        className="panel panel-pad grid gap-3 md:grid-cols-2"
      >
        <label className="lbl">
          Компетенция
          <select className="field" name="competencyId">
            {competencies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="lbl">
          Уровень
          <select name="level" className="field" defaultValue="1">
            <option value="">не задан</option>
            <option value="1">1 · базовый</option>
            <option value="2">2 · уверенный</option>
            <option value="3">3 · эксперт</option>
          </select>
        </label>
        <label className="lbl">
          Название
          <input className="field" name="name" />
        </label>
        <label className="lbl">
          Узнать
          <textarea className="field" name="learnText" rows={4} />
        </label>
        <label className="lbl">
          Проверить
          <textarea className="field" name="verifyText" rows={4} />
        </label>
        <button className="btn-primary w-fit" type="submit">
          Создать
        </button>
      </ActionForm>
    </div>
  );
}
