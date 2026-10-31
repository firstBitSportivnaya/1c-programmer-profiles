import { competencyMarkViews } from "@/lib/queries";

/** Сводка личных пометок в кабинете. Списки — на `/me/marks`. */
export function CompetencyMarkSummary({ employeeId, jobId }: { employeeId: string; jobId: string }) {
  const { current, outside, summary } = competencyMarkViews(employeeId, jobId);
  const empty = current.length === 0 && outside.length === 0;
  return (
    <section className="space-y-3">
      <h2 className="section-title">Мои пометки по компетенциям</h2>
      <p className="muted text-sm">Видите только вы. Статусы не меняют разрыв, ИПР и должность.</p>
      {empty ? <p className="muted text-sm">У должности нет профиля с навыками.</p> : null}
      {!empty && current.length > 0 ? (
        <p className="text-sm">
          не отмечено <span data-testid="marks-unmarked">{summary.unmarked}</span>
          {" · есть "}
          <span data-testid="marks-has">{summary.has}</span>
          {" · нет "}
          <span data-testid="marks-lacks">{summary.lacks}</span>
          {" · в процессе "}
          <span data-testid="marks-progress">{summary.inProgress}</span>
        </p>
      ) : null}
      {!empty ? (
        <a className="link-accent" href="/me/marks">
          Открыть пометки
        </a>
      ) : null}
    </section>
  );
}
