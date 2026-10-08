import type { ReactNode } from "react";
import type { CompetencyLinkKind } from "@/db/schema";
import type { CompetencyLink } from "@/lib/queries";

export const LINK_KINDS: { value: CompetencyLinkKind; label: string }[] = [
  { value: "its", label: "ИТС" },
  { value: "training", label: "Обучение" },
  { value: "video", label: "Видео" },
];

function kindLabel(kind: string) {
  return LINK_KINDS.find((k) => k.value === kind)?.label ?? kind;
}

/** Ссылки на материалы по компетенции. `action` — элемент справа от ссылки (например, удаление у админа). */
export function CompetencyLinks({
  links,
  action,
}: {
  links: CompetencyLink[];
  action?: (link: CompetencyLink) => ReactNode;
}) {
  if (links.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1 text-sm" aria-label="Материалы">
      {links.map((link) => (
        <li key={link.id} className="flex flex-wrap items-center gap-2">
          <span className="chip">{kindLabel(link.kind)}</span>
          <a className="link-accent" href={link.url} target="_blank" rel="noopener noreferrer">
            {link.title}
          </a>
          {action ? action(link) : null}
        </li>
      ))}
    </ul>
  );
}
