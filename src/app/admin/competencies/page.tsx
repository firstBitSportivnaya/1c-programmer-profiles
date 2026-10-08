import { redirect } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { CompetencyLinks, LINK_KINDS } from "@/components/CompetencyLinks";
import {
  addCompetencyLinkAction,
  deleteCompetencyAction,
  deleteCompetencyLinkAction,
  saveCompetencyAction,
} from "@/app/actions";
import { isAdmin } from "@/lib/auth";
import { listCompetencies, listCompetencyLinks } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES = [
  { value: "professional", label: "Профессиональная" },
  { value: "universal", label: "Универсальная" },
  { value: "duty", label: "Обязанность" },
];

function typeChip(type: string) {
  if (type === "professional") return "chip chip-frontend";
  if (type === "universal") return "chip chip-backend";
  return "chip chip-cloud";
}

export default async function CompetenciesPage() {
  if (!(await isAdmin())) redirect("/admin/login");
  const items = listCompetencies();
  const roots = items.filter((c) => !c.parentId);
  const links = listCompetencyLinks();
  return (
    <div className="space-y-6">
      <div className="page-kicker">
        <span className="pulse-dot" />
        <h1 className="page-title">Компетенции</h1>
      </div>
      <ActionForm action={saveCompetencyAction} className="panel panel-pad grid gap-3 text-sm md:grid-cols-2">
        <input name="id" placeholder="id (латиница)" className="field" required />
        <input name="name" placeholder="Название" className="field" required />
        <select name="type" className="field">
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <select name="parentId" className="field">
          <option value="">без родителя</option>
          {roots.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <textarea name="description" placeholder="Описание" className="field md:col-span-2" />
        <button className="btn-primary w-fit" type="submit">
          Добавить / сохранить
        </button>
      </ActionForm>
      <ul className="space-y-2 text-sm">
        {items.map((c) => (
          <li key={c.id} className="panel panel-pad">
            <div className="flex flex-wrap items-center gap-2 font-medium">
              {c.name} <span className={typeChip(c.type)}>{c.type}</span>
            </div>
            {c.parentId ? <div className="mt-1 text-xs muted">родитель: {c.parentId}</div> : null}
            <ActionForm action={saveCompetencyAction} className="mt-3 grid gap-2 md:grid-cols-4">
              <input type="hidden" name="id" value={c.id} />
              <input name="name" defaultValue={c.name} className="field md:col-span-2" />
              <select name="type" defaultValue={c.type} className="field">
                {TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <select name="parentId" defaultValue={c.parentId ?? ""} className="field">
                <option value="">без родителя</option>
                {roots
                  .filter((r) => r.id !== c.id)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
              </select>
              <button className="btn w-fit" type="submit">
                Ок
              </button>
            </ActionForm>
            <div role="group" aria-label={`Материалы: ${c.name}`} className="mt-3">
              <CompetencyLinks
                links={links.get(c.id) ?? []}
                action={(link) => (
                  <ActionForm action={deleteCompetencyLinkAction}>
                    <input type="hidden" name="linkId" value={link.id} />
                    <button className="btn-quiet" type="submit">
                      Удалить ссылку
                    </button>
                  </ActionForm>
                )}
              />
              <ActionForm action={addCompetencyLinkAction} className="mt-2 grid gap-2 md:grid-cols-4">
                <input type="hidden" name="competencyId" value={c.id} />
                <label className="lbl">
                  Вид
                  <select name="kind" className="field">
                    {LINK_KINDS.map((k) => (
                      <option key={k.value} value={k.value}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="lbl">
                  Название ссылки
                  <input name="title" className="field" />
                </label>
                <label className="lbl">
                  Адрес
                  <input name="url" className="field" placeholder="https://" />
                </label>
                <button className="btn w-fit self-end" type="submit">
                  Добавить ссылку
                </button>
              </ActionForm>
            </div>
            <ActionForm action={deleteCompetencyAction} className="mt-2">
              <input type="hidden" name="id" value={c.id} />
              <button className="btn-danger" type="submit">
                Удалить
              </button>
            </ActionForm>
          </li>
        ))}
      </ul>
    </div>
  );
}
