import { compareJobs, getJob, getProfileByJob, listJobs } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function changeLabel(change: string) {
  if (change === "added") return "появилось";
  if (change === "removed") return "пропало";
  if (change === "level") return "изменился уровень";
  if (change === "criteria") return "изменилось ожидание";
  return "без изменений";
}

function formatPresence(type: string, present: boolean, level: number | null) {
  if (!present) return "—";
  if (type === "duty") return "есть";
  if (level == null) return "уровень не задан";
  return `ур. ${level}`;
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const jobs = listJobs().filter((j) => getProfileByJob(j.id));
  const sp = await searchParams;
  const a = sp.a ?? jobs[0]?.id ?? "";
  const b = sp.b ?? jobs[1]?.id ?? "";
  const result = a && b ? compareJobs(a, b) : null;
  const aJob = a ? getJob(a) : null;
  const bJob = b ? getJob(b) : null;

  return (
    <div className="space-y-6">
      <div className="page-kicker">
        <span className="pulse-dot" />
        <h1 className="page-title">Сравнение профилей</h1>
      </div>
      <form className="panel panel-pad flex flex-wrap items-end gap-4 text-sm" method="get">
        <label className="lbl">
          A
          <select name="a" defaultValue={a} className="field">
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.name}
              </option>
            ))}
          </select>
        </label>
        <label className="lbl">
          B
          <select name="b" defaultValue={b} className="field">
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.name}
              </option>
            ))}
          </select>
        </label>
        <button className="btn-primary" type="submit">
          Сравнить
        </button>
      </form>
      {result && "error" in result ? (
        <p className="muted">Сравнивать можно только должности с заполненным профилем.</p>
      ) : result ? (
        <div className="panel panel-pad overflow-x-auto">
          <table className="compare-table">
            <thead>
              <tr>
                <th>Компетенция</th>
                <th>{aJob?.name}</th>
                <th>{bJob?.name}</th>
                <th>Изменение</th>
              </tr>
            </thead>
            <tbody>
              {result.lines.map((line) => (
                <tr key={line.id} data-change={line.change}>
                  <td>{line.name}</td>
                  <td>
                    {formatPresence(line.type, line.presentA, line.levelA)}
                    {line.change === "criteria" && line.criteriaA ? (
                      <div className="mt-1 text-xs muted">{line.criteriaA}</div>
                    ) : null}
                  </td>
                  <td>
                    {formatPresence(line.type, line.presentB, line.levelB)}
                    {line.change === "criteria" && line.criteriaB ? (
                      <div className="mt-1 text-xs muted">{line.criteriaB}</div>
                    ) : null}
                  </td>
                  <td>{changeLabel(line.change)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">Нет профилей для сравнения.</p>
      )}
      <p className="text-sm">
        <a href="/" className="link-accent">
          На граф
        </a>
      </p>
    </div>
  );
}
