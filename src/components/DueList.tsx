import { formatIsoDate } from "@/lib/dates";
import type { DueItem } from "@/lib/queries";

/** Строки сводки сроков: сотрудник, компетенция, задание, срок и ссылка на строку плана. */
export function DueList({ rows, empty }: { rows: DueItem[]; empty: string }) {
  if (rows.length === 0) return <p className="muted">{empty}</p>;
  return (
    <ul className="panel" data-testid="due-list">
      {rows.map((row) => (
        <li key={row.itemId} className="list-row">
          <div>
            <a className="link-accent font-medium" href={`/idps/${row.idpId}#item-${row.itemId}`}>
              {row.assignmentName}
            </a>
            <div className="mt-1 muted caption">
              {row.employeeName} · {row.competencyName} · {formatIsoDate(row.dueOn)}
              {row.overdue ? " · просрочено" : ""}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
