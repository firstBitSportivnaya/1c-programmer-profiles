import { redirect } from "next/navigation";
import { SkillTree } from "@/components/SkillTree";
import { getSessionEmployee } from "@/lib/auth";
import { SKILL_TREE_MOTTO, loadSkillTreeSnapshot } from "@/lib/skill-tree-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Страница дерева: снимок собирает общая функция, её же использует карточка сотрудника. */
export default async function SkillTreePage() {
  const employee = await getSessionEmployee();
  if (!employee) redirect("/login");

  const { data, hasProfile, hasMarks, hasConfirmed } = loadSkillTreeSnapshot(employee.id, employee.jobId, "own");

  return (
    <article className="space-y-6">
      <div className="page-kicker">
        <a href="/me" className="link-accent">
          Кабинет
        </a>
        <h1 className="page-title">Дерево навыков</h1>
      </div>
      {hasProfile || hasMarks || hasConfirmed ? (
        <SkillTree data={data} motto={SKILL_TREE_MOTTO} />
      ) : (
        <p className="muted" data-testid="skill-tree-no-profile">
          У должности нет профиля с навыками — дерево появится, когда профиль заполнят. Личные пометки можно вести в
          разделе{" "}
          <a href="/me/marks" className="link-accent">
            Мои пометки по компетенциям
          </a>
          .
        </p>
      )}
      {/* Пояснения стоят под деревом: при открытии страницы на экране сразу холст, а не текст. */}
      <div className="skill-notes" data-testid="skill-notes">
        {!data.planId ? (
          <p className="muted" data-testid="skill-tree-no-plan">
            Активного ИПР нет — дерево покажет только текущую должность. План открывает руководитель в разделе{" "}
            <a href="/idps" className="link-accent">
              ИПР
            </a>
            .
          </p>
        ) : null}
        <p className="muted">
          Стрелка — предпосылка: навык открывает следующий, а не подтверждает его. Плашка — тема навыка, заливка —
          ваша пометка, звезда — подтверждение приёмкой или вручную. Пометку видит только её автор; подтверждение
          видно в карточке сотрудника и собирается на странице{" "}
          <a href="/me/achievements" className="link-accent">
            Достижения
          </a>
          .
        </p>
      </div>
    </article>
  );
}
