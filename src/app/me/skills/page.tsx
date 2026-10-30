import { redirect } from "next/navigation";
import { Achievements } from "@/components/Achievements";
import { SkillTree } from "@/components/SkillTree";
import { employeeAchievements } from "@/lib/achievements";
import { getSessionEmployee } from "@/lib/auth";
import { sectionForType } from "@/lib/invariants";
import {
  competencyMarkViews,
  getActiveIdp,
  getJob,
  groupedProfile,
  jobHref,
  listCompetencies,
  listCompetencyLinks,
  listIdpItems,
  listIdpPool,
} from "@/lib/queries";
import {
  buildSkillTree,
  type TreeLink,
  type TreeMarkRow,
  type TreeOutsideRow,
  type TreeProfileSkill,
} from "@/lib/skill-tree";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GroupedProfile = NonNullable<ReturnType<typeof groupedProfile>>;

/** Строки профиля должности без обязанностей: только навыки, как в разрыве. */
function profileSkills(grouped: GroupedProfile, parentNames: Map<string, string>): TreeProfileSkill[] {
  return [...grouped.technical, ...grouped.personal].map((row) => ({
    id: row.competency.id,
    name: row.competency.name,
    section: sectionForType(row.competency.type) === "personal" ? "personal" : "technical",
    groupId: row.competency.parentId ?? null,
    groupName: row.competency.parentId ? (parentNames.get(row.competency.parentId) ?? null) : null,
    level: row.skill.level,
    criteria: row.skill.criteria?.trim() ? row.skill.criteria : null,
  }));
}

/** Страница дерева: собирает пометки, профили и активный план в один снимок. */
export default async function SkillTreePage() {
  const employee = await getSessionEmployee();
  if (!employee) redirect("/login");

  const parentNames = new Map(listCompetencies().map((row) => [row.id, row.name]));
  const currentJob = getJob(employee.jobId);
  const currentProfile = groupedProfile(employee.jobId);
  const active = getActiveIdp(employee.id);
  const targetJob = active ? getJob(active.targetJobId) : null;
  const targetProfile = active ? groupedProfile(active.targetJobId) : null;

  const { current, outside } = competencyMarkViews(employee.id, employee.jobId);
  const marks: TreeMarkRow[] = [];
  for (const row of current) {
    if (row.status === "has" || row.status === "lacks" || row.status === "in_progress") {
      marks.push({ competencyId: row.id, status: row.status, note: row.note });
    }
  }
  const outsideRows: TreeOutsideRow[] = [];
  for (const row of outside) {
    if (row.status === "has" || row.status === "lacks" || row.status === "in_progress") {
      outsideRows.push({ id: row.id, name: row.name, section: row.section, status: row.status, note: row.note });
      marks.push({ competencyId: row.id, status: row.status, note: row.note });
    }
  }

  const materials = new Map<string, TreeLink[]>();
  for (const [competencyId, links] of listCompetencyLinks()) {
    materials.set(
      competencyId,
      links.map((link) => ({ kind: link.kind, title: link.title, url: link.url })),
    );
  }

  const confirmed = new Set(
    employeeAchievements(employee.id)
      .filter((row) => row.key.startsWith("competency:"))
      .map((row) => row.key.slice("competency:".length)),
  );

  const data = buildSkillTree({
    currentJob: currentJob ? { id: currentJob.id, name: currentJob.name, href: jobHref(currentJob.id) } : null,
    targetJob: targetJob ? { id: targetJob.id, name: targetJob.name, href: jobHref(targetJob.id) } : null,
    planId: active?.id ?? null,
    currentSkills: currentProfile ? profileSkills(currentProfile, parentNames) : [],
    targetSkills: targetProfile ? profileSkills(targetProfile, parentNames) : [],
    pool: active ? listIdpPool(active.id) : [],
    items: active
      ? listIdpItems(active.id).map((item) => ({
          id: item.id,
          competencyId: item.competencyId,
          name: item.assignmentName,
          status: item.status,
          dueOn: item.dueOn,
          accepted: item.acceptedAt != null,
        }))
      : [],
    marks,
    outside: outsideRows,
    materials,
    confirmed,
  });

  return (
    <article className="space-y-6">
      <div className="page-kicker">
        <a href="/me" className="link-accent text-sm">
          Кабинет
        </a>
        <h1 className="page-title">Дерево навыков</h1>
      </div>
      <p className="muted text-sm">
        Заливка узла — ваша пометка, свечение — подтверждение руководителем. Планка уровня — требование должности, а не
        оценка. Видите только вы.
      </p>
      <Achievements employeeId={employee.id} />
      {!data.planId ? (
        <p className="muted text-sm" data-testid="skill-tree-no-plan">
          Активного ИПР нет — дерево покажет только вашу текущую должность. План открывает руководитель в разделе{" "}
          <a href="/idps" className="link-accent">
            ИПР
          </a>
          .
        </p>
      ) : null}
      {data.current || data.target || data.outside.length > 0 ? (
        <SkillTree data={data} />
      ) : (
        <p className="muted text-sm" data-testid="skill-tree-no-profile">
          У должности нет профиля с навыками — дерево появится, когда профиль заполнят. Личные пометки можно вести в
          разделе{" "}
          <a href="/me/marks" className="link-accent">
            Мои компетенции
          </a>
          .
        </p>
      )}
    </article>
  );
}
