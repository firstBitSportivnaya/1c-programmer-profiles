import { ActionForm } from "@/components/ActionForm";
import { addTransitionAction, deleteJobAction, deleteTransitionAction, saveJobAction } from "@/app/actions";
import type { jobs } from "@/db/schema";
import { jobHref, listJobs, outgoingTransitions } from "@/lib/queries";

type Job = typeof jobs.$inferSelect;

const LANE = {
  executor: "Исполнитель",
  manager: "Руководитель",
  other: "Другое",
} as const;

/** Ветка, требуемый опыт и профстандарт должности. */
export function JobFacts({ job }: { job: Job }) {
  return (
    <dl className="panel panel-pad grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
      <dt className="muted">Ветка</dt>
      <dd>{LANE[job.lane]}</dd>
      <dt className="muted">Требуемый опыт, лет</dt>
      <dd>{job.yearsRequired ?? "—"}</dd>
      <dt className="muted">Профстандарт</dt>
      <dd>{job.professionalStandard ?? "—"}</dd>
    </dl>
  );
}

/** Исходящие рёбра должности; админ может убрать ребро. */
export function NextJobs({ jobId, admin }: { jobId: string; admin: boolean }) {
  const outs = outgoingTransitions(jobId);
  const nameById = Object.fromEntries(listJobs().map((j) => [j.id, j.name]));
  return (
    <section>
      <h2 className="section-title">Следующие должности</h2>
      <ul className="panel">
        {outs.map((tr) => (
          <li key={`${tr.fromJobId}-${tr.toJobId}`} className="list-row text-sm">
            <div className="flex items-center gap-3">
              <a className="link-accent" href={jobHref(tr.toJobId)}>
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
  );
}

/** Правка полей должности, добавление ребра и удаление должности. Только для админа. */
export function JobAdminPanel({ job }: { job: Job }) {
  const allJobs = listJobs();
  return (
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
      <a className="link-accent text-sm" href="/">
        К схеме
      </a>
    </section>
  );
}
