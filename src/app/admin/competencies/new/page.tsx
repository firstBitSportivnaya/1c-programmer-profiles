import { redirect } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { CompetencyFields } from "@/components/CompetencyFields";
import { saveCompetencyAction } from "@/app/actions";
import { isAdmin } from "@/lib/auth";
import { listCompetencies } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function NewCompetencyPage() {
  if (!(await isAdmin())) redirect("/admin/login");
  const roots = listCompetencies().filter((item) => !item.parentId);
  return (
    <div className="space-y-6">
      <p>
        <a href="/admin/competencies" className="link-accent">
          ← Все компетенции
        </a>
      </p>
      <div className="page-kicker">
        <span className="pulse-dot" />
        <h1 className="page-title">Новая компетенция</h1>
      </div>
      <ActionForm
        action={saveCompetencyAction}
        successPath="/admin/competencies/{id}"
        className="panel panel-pad grid gap-3 md:grid-cols-2"
      >
        <input type="hidden" name="create" value="1" />
        <CompetencyFields roots={roots} />
        <button className="btn-primary w-fit" type="submit">
          Создать
        </button>
      </ActionForm>
    </div>
  );
}
