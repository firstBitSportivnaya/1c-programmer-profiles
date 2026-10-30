import { redirect } from "next/navigation";
import { Achievements } from "@/components/Achievements";
import { SkillTree } from "@/components/SkillTree";
import { employeeAchievements } from "@/lib/achievements";
import { getSessionEmployee } from "@/lib/auth";
import {
  competencyMarkViews,
  getActiveIdp,
  getJob,
  groupedProfile,
  jobHref,
  listCompetencies,
  listCompetencyLinks,
  listIdpItems,
} from "@/lib/queries";
import {
  buildSkillTree,
  type TreeLink,
  type TreeMarkRow,
  type TreeSkillRow,
} from "@/lib/skill-tree";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProfileRow = { level: number | null; criteria: string | null };

/** Строки профиля по компетенциям: планка и критерий. У обязанностей уровня нет. */
function profileRows(jobId: string | null): Map<string, ProfileRow> {
  const map = new Map<string, ProfileRow>();
  if (!jobId) return map;
  const grouped = groupedProfile(jobId);
  if (!grouped) return map;
  for (const row of grouped.technical.concat(grouped.personal)) {
    map.set(row.competency.id, {
      level: row.skill.level,
      criteria: row.skill.criteria?.trim() ? row.skill.criteria : null,
    });
  }
  return map;
}

/** Уровни навыков профиля. */
function levelMap(rows: Map<string, ProfileRow>): Map<string, number | null> {
  return new Map([...rows].map(([id, row]) => [id, row.level]));
}

/**
 * Критерий читается по той планке, которую требует план: если цель выше текущей,
 * показываем критерий цели, иначе критерий текущей должности.
 */
function criteriaMap(current: Map<string, ProfileRow>, target: Map<string, ProfileRow>) {
  const map = new Map<string, string | null>();
  for (const id of new Set([...current.keys(), ...target.keys()])) {
    const now = current.get(id);
    const goal = target.get(id);
    const fromTarget = goal !== undefined && (now === undefined || (goal.level ?? 0) > (now.level ?? 0));
    map.set(id, (fromTarget ? goal.criteria : now?.criteria) ?? goal?.criteria ?? null);
  }
  return map;
}

/** Все навыки справочника: группы без родителя и обязанности в дерево не входят. */
function treeSkills(): TreeSkillRow[] {
  const all = listCompetencies();
  const names = new Map(all.map((row) => [row.id, row.name]));
  return all
    .filter((row) => row.parentId !== null && row.type !== "duty")
    .map((row) => ({
      id: row.id,
      name: row.name,
      groupName: row.parentId ? (names.get(row.parentId) ?? null) : null,
    }));
}

/** Страница дерева: собирает пометки, оба профиля и активный план в один снимок. */
export default async function SkillTreePage() {
  const employee = await getSessionEmployee();
  if (!employee) redirect("/login");

  const currentJob = getJob(employee.jobId);
  const active = getActiveIdp(employee.id);
  const targetJob = active ? getJob(active.targetJobId) : null;

  const { current, outside } = competencyMarkViews(employee.id, employee.jobId);
  const marks: TreeMarkRow[] = [];
  for (const row of [...current, ...outside]) {
    if (row.status === "has" || row.status === "lacks" || row.status === "in_progress") {
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

  const currentRows = profileRows(employee.jobId);
  const targetRows = profileRows(active?.targetJobId ?? null);

  const criteria = criteriaMap(currentRows, targetRows);

  const confirmed = new Set(
    employeeAchievements(employee.id)
      .filter((row) => row.key.startsWith("competency:"))
      .map((row) => row.key.slice("competency:".length)),
  );

  const data = buildSkillTree({
    currentJob: currentJob ? { id: currentJob.id, name: currentJob.name, href: jobHref(currentJob.id) } : null,
    targetJob: targetJob ? { id: targetJob.id, name: targetJob.name, href: jobHref(targetJob.id) } : null,
    planId: active?.id ?? null,
    skills: treeSkills(),
    currentLevels: levelMap(currentRows),
    targetLevels: levelMap(targetRows),
    criteria,
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
    materials,
    confirmed,
  });

  const hasProfile = data.nodes.some((node) => node.relation !== "none");
  const hasMarks = data.nodes.some((node) => node.mark !== "");

  return (
    <article className="space-y-6">
      <div className="page-kicker">
        <a href="/me" className="link-accent text-sm">
          Кабинет
        </a>
        <h1 className="page-title">Дерево навыков</h1>
      </div>
      <p className="muted text-sm">
        Стрелка — предпосылка: навык открывает следующий, а не подтверждает его. Заливка узла — ваша пометка, значок —
        шаг активного ИПР, свечение — подтверждение приёмкой. Видите только вы.
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
      {hasProfile || hasMarks ? (
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
