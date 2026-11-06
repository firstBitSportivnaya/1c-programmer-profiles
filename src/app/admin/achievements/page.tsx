import { redirect } from "next/navigation";
import { AchievementIcon } from "@/components/skill-icons";
import { ACHIEVEMENT_CATEGORY_LABELS, ACHIEVEMENT_RULE_LABELS } from "@/lib/achievement-catalog";
import { isAdmin } from "@/lib/auth";
import { listAchievements } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Каталог достижений для админа (ADR 0010): ключ, название, категория, правило, иконка и признак «скрыто».
 * Скрытые записи остаются в списке — иначе их нечем вернуть, — но к выдаче не предлагаются.
 */
export default async function AchievementsAdminPage() {
  if (!(await isAdmin())) redirect("/admin/login");
  const items = listAchievements();
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="page-kicker">
          <span className="pulse-dot" />
          <h1 className="page-title">Каталог достижений</h1>
        </div>
        <a href="/admin/achievements/new" className="btn-primary">
          Новое достижение
        </a>
      </div>
      <p className="muted">
        Запись не удаляют, а скрывают: скрытая не предлагается к выдаче, уже выданные достижения остаются у сотрудников.
        Ключ после создания не меняется.
      </p>
      <ul className="panel" data-testid="achievements-catalog">
        {items.map((item) => (
          <li key={item.id} className="list-row">
            <span className="achievement-row__main">
              <AchievementIcon icon={item.icon} className="achievement-row__glyph" />
              <span>
                <a href={`/admin/achievements/${encodeURIComponent(item.id)}`} className="link-accent font-medium">
                  {item.title}
                </a>
                <span className="muted caption block">{item.id}</span>
              </span>
            </span>
            <span className="flex flex-wrap items-center justify-end gap-2">
              <span className="chip">{ACHIEVEMENT_CATEGORY_LABELS[item.category]}</span>
              <span className="chip">{ACHIEVEMENT_RULE_LABELS[item.rule]}</span>
              {item.archived !== 0 ? <span className="chip">скрыто</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
