import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { addTransitionAction, createProfileAction, deleteJobAction, deleteTransitionAction, saveJobAction } from "@/app/actions";
import { isAdmin } from "@/lib/auth";
import { getJob, getProfileByJob, listJobs, outgoingTransitions } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LANE = {
  executor: "Исполнитель",
  manager: "Руководитель",
  other: "Другое",
} as const;

export default async function JobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = getJob(jobId);
  if (!job) notFound();
  const profile = getProfileByJob(jobId);
  const admin = await isAdmin();
  const outs = outgoingTransitions(jobId);
  const allJobs = listJobs();
  const nameById = Object.fromEntries(allJobs.map((j) => [j.id, j.name]));

  return (
    <article className="space-y-6">
      <div className="page-kicker">
        <span className="pulse-dot" />
        <h1 className="page-title">{job.name}</h1>
      </div>
      <dl className="panel panel-pad grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
        <dt className="muted">Ветка</dt>
        <dd>{LANE[job.lane]}</dd>
        <dt className="muted">Требуемый опыт, лет</dt>
        <dd>{job.yearsRequired ?? "—"}</dd>
        <dt className="muted">Профстандарт</dt>
        <dd>{job.professionalStandard ?? "—"}</dd>
      </dl>

      {profile ? (
        <p>
          <a className="btn-primary" href={`/jobs/${jobId}/profile`}>
            Открыть профиль
          </a>
        </p>
      ) : (
        <div className="panel panel-pad" style={{ borderStyle: "dashed" }}>
          <p className="mb-3 muted">Профиль не заполнен.</p>
          {admin ? (
            <ActionForm action={createProfileAction}>
              <input type="hidden" name="jobId" value={jobId} />
              <button className="btn-primary" type="submit">
                Создать пустой профиль
              </button>
            </ActionForm>
          ) : null}
        </div>
      )}

      <section>
        <h2 className="section-title">Следующие должности</h2>
        <ul className="panel">
          {outs.map((tr) => (
            <li key={`${tr.fromJobId}-${tr.toJobId}`} className="list-row text-sm">
              <div className="flex items-center gap-3">
                <a className="link-accent" href={`/jobs/${tr.toJobId}`}>
                  {nameById[tr.toJobId] ?? tr.toJobId}
                </a>
                <span className={tr.kind === "linear" ? "chip chip-frontend" : "chip chip-cloud"}>
                  {tr.kind === "linear" ? "линейный" : "смена уровня"}
                </span>
              </div>
              {admin ? (
                <ActionForm action={deleteTransitionAction}>
                  <input type="hidden" name="fromJobId" value={tr.fromJobId} />
                  <input type="hidden" name="toJobId" value={tr.toJobId} />
                  <button className="btn-quiet" type="submit">
                    Убрать
                  </button>
                </ActionForm>
              ) : null}
            </li>
          ))}
          {outs.length === 0 ? <li className="list-row muted">Нет исходящих рёбер</li> : null}
        </ul>
      </section>

      {admin ? (
        <section className="panel panel-pad space-y-4">
          <h2 className="section-title">Правка должности</h2>
          <ActionForm action={saveJobAction} className="grid grid-cols-2 gap-3 text-sm">
            <input type="hidden" name="id" value={job.id} />
            <label className="lbl">
              Название
              <input className="field" name="name" defaultValue={job.name} />
            </label>
            <label className="lbl">
              Порядок
              <input className="field" name="rankOrder" type="number" defaultValue={job.rankOrder} />
            </label>
            <label className="lbl">
              Ветка
              <select className="field" name="lane" defaultValue={job.lane}>
                <option value="executor">Исполнитель</option>
                <option value="manager">Руководитель</option>
                <option value="other">Другое</option>
              </select>
            </label>
            <label className="lbl">
              Опыт, лет
              <input className="field" name="yearsRequired" defaultValue={job.yearsRequired ?? ""} />
            </label>
            <label className="lbl col-span-2">
              Профстандарт
              <input className="field" name="professionalStandard" defaultValue={job.professionalStandard ?? ""} />
            </label>
            <button className="btn-primary w-fit" type="submit">
              Сохранить
            </button>
          </ActionForm>
          <ActionForm action={addTransitionAction} className="flex flex-wrap items-end gap-3 text-sm">
            <input type="hidden" name="fromJobId" value={job.id} />
            <label className="lbl">
              Куда
              <select className="field" name="toJobId">
                {allJobs
                  .filter((j) => j.id !== job.id)
                  .map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="lbl">
              Тип
              <select className="field" name="kind">
                <option value="linear">линейный</option>
                <option value="level_change">смена уровня</option>
              </select>
            </label>
            <button className="btn" type="submit">
              Добавить ребро
            </button>
          </ActionForm>
          <ActionForm action={deleteJobAction}>
            <input type="hidden" name="id" value={job.id} />
            <button className="btn-danger" type="submit">
              Удалить должность
            </button>
          </ActionForm>
        </section>
      ) : null}
    </article>
  );
}
