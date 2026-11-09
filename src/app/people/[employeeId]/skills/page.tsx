import { notFound, redirect } from "next/navigation";
import { SkillTree } from "@/components/SkillTree";
import { getSessionEmployee } from "@/lib/auth";
import { canManageEmployee, canViewEmployee } from "@/lib/invariants";
import { getEmployee } from "@/lib/queries";
import { SKILL_TREE_MOTTO, loadSkillTreeSnapshot } from "@/lib/skill-tree-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Дерево навыков сотрудника в контексте карточки: руководитель и админ видят профиль, цель ИПР,
 * предпосылки и подтверждения, но не личные пометки (ADR 0007). Сам сотрудник тоже может открыть
 * страницу — она покажет то же дерево без личного слоя, пометки ведутся на `/me/skills`.
 * Права те же, что у карточки: остальным 404, гостю — вход.
 */
export default async function EmployeeSkillTreePage({ params }: { params: Promise<{ employeeId: string }> }) {
  const actor = await getSessionEmployee();
  if (!actor) redirect("/login");
  const { employeeId } = await params;
  const row = getEmployee(employeeId);
  if (!row) notFound();
  if (!canViewEmployee(actor, employeeId)) notFound();

  const manage = canManageEmployee(actor, row.id);
  const snapshot = loadSkillTreeSnapshot(row.id, row.jobId, "review");
  const empty = !snapshot.hasProfile && !snapshot.hasConfirmed;

  return (
    <article className="space-y-6">
      <div className="page-kicker">
        <a href={`/people/${row.id}`} className="link-accent">
          {row.name}
        </a>
        <h1 className="page-title">Дерево навыков</h1>
      </div>
      {empty ? (
        <p className="muted" data-testid="skill-tree-no-profile">
          У должности сотрудника нет профиля с навыками, подтверждений тоже нет — дерево появится, когда профиль
          заполнят или компетенцию подтвердят.
        </p>
      ) : (
        <SkillTree
          data={snapshot.data}
          motto={SKILL_TREE_MOTTO}
          review={{ employeeId: row.id, canManage: manage, confirmations: snapshot.confirmations }}
        />
      )}
      <div className="skill-notes" data-testid="skill-notes">
        {!snapshot.data.planId ? (
          <p className="muted" data-testid="skill-tree-no-plan">
            Активного ИПР нет — дерево покажет только текущую должность. План открывает руководитель в разделе{" "}
            <a href="/idps" className="link-accent">
              ИПР
            </a>
            .
          </p>
        ) : null}
        <p className="muted">
          Личные пометки сотрудника здесь не показываются: их видит только он сам. Звезда — подтверждение приёмкой
          ИПР или вручную; у ручной записи в панели навыка видны основание, дата и автор, у приёмки — ссылка на план.
        </p>
      </div>
    </article>
  );
}
