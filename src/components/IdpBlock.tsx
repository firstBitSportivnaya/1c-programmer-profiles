import { ActionForm } from "@/components/ActionForm";
import { AddIdpItemForm } from "@/components/AddIdpItemForm";
import { CompetencyLinks } from "@/components/CompetencyLinks";
import {
  acceptIdpItemAction,
  cancelIdpAction,
  deleteIdpItemAction,
  refreshIdpPoolAction,
  setIdpItemStatusAction,
  unacceptIdpItemAction,
  updateIdpItemAction,
} from "@/app/idp-actions";
import type { SessionEmployee } from "@/lib/auth";
import { canManageEmployee, canTickIdpItem } from "@/lib/invariants";
import {
  getActiveIdp,
  getJob,
  listActiveIdpAssignmentsFor,
  listCompetencyLinks,
  listIdpItems,
  listIdps,
} from "@/lib/queries";
import type { idpItems, idpPool, idps } from "@/db/schema";

const ITEM_STATUS: Record<string, string> = {
  not_started: "не начат",
  in_progress: "в работе",
  done: "сделал",
};

const IDP_STATUS: Record<string, string> = {
  active: "активен",
  completed: "выполнен",
  cancelled: "отменён",
};

export function EmployeeIdpSummary({ employeeId }: { employeeId: string }) {
  const active = getActiveIdp(employeeId);
  const history = listIdps(employeeId).filter((row) => row.id !== active?.id);
  const items = active ? listIdpItems(active.id) : [];
  const accepted = items.filter((item) => item.acceptedAt != null).length;
  return (
    <section className="space-y-3">
      <h2 className="section-title">ИПР</h2>
      {active ? (
        <p>
          <a href={`/idps/${active.id}`} className="link-accent">
            Активный план: {getJob(active.sourceJobId)?.name ?? active.sourceJobId} →{" "}
            {getJob(active.targetJobId)?.name ?? active.targetJobId}
          </a>
          <span className="muted ml-2">
            принято {accepted} из {items.length}
          </span>
        </p>
      ) : (
        <p className="muted text-sm">
          Активного плана нет. Создать можно в разделе{" "}
          <a href="/idps" className="link-accent">
            ИПР
          </a>
          .
        </p>
      )}
      {history.length > 0 ? (
        <ul className="panel">
          {history.map((row) => (
            <li key={row.id} className="list-row text-sm">
              <a href={`/idps/${row.id}`} className="link-accent">
                {getJob(row.sourceJobId)?.name ?? row.sourceJobId} → {getJob(row.targetJobId)?.name ?? row.targetJobId}
              </a>
              <span className="chip">{IDP_STATUS[row.status] ?? row.status}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function groupItems(items: (typeof idpItems.$inferSelect)[]) {
  const order: string[] = [];
  const byComp = new Map<string, (typeof idpItems.$inferSelect)[]>();
  for (const item of items) {
    if (!byComp.has(item.competencyId)) {
      byComp.set(item.competencyId, []);
      order.push(item.competencyId);
    }
    byComp.get(item.competencyId)!.push(item);
  }
  return order.map((competencyId) => {
    const rows = byComp.get(competencyId)!;
    const confirmed = rows.length > 0 && rows.every((row) => row.acceptedAt != null);
    return { competencyId, name: rows[0].competencyName, requiredLevel: rows[0].requiredLevel, confirmed, rows };
  });
}

export function IdpBlock({
  actor,
  idp,
  items,
  pool,
}: {
  actor: SessionEmployee;
  idp: typeof idps.$inferSelect;
  items: (typeof idpItems.$inferSelect)[];
  pool: (typeof idpPool.$inferSelect)[];
}) {
  const open = idp.status === "active";
  const manage = open && canManageEmployee(actor, idp.employeeId);
  const reopen = idp.status === "completed" && canManageEmployee(actor, idp.employeeId);
  const tick = open && canTickIdpItem(actor, idp.employeeId);
  const accepted = items.filter((item) => item.acceptedAt != null).length;
  const groups = groupItems(items);
  const links = listCompetencyLinks();
  const competencyName = new Map(pool.map((row) => [row.competencyId, row.competencyName]));
  const catalog = listActiveIdpAssignmentsFor(pool.map((row) => row.competencyId)).map((assignment) => ({
    ...assignment,
    competencyName: competencyName.get(assignment.competencyId) ?? assignment.competencyId,
  }));

  return (
    <section className="space-y-4">
      <div className="panel panel-pad space-y-4">
        <p>
          <span className="chip">{IDP_STATUS[idp.status] ?? idp.status}</span>
          <span className="muted ml-2">
            принято {accepted} из {items.length}
          </span>
        </p>
        {manage ? (
          <div className="flex flex-wrap gap-2">
            <ActionForm action={refreshIdpPoolAction}>
              <input type="hidden" name="idpId" value={idp.id} />
              <button className="btn" type="submit">
                Обновить разрыв
              </button>
            </ActionForm>
            <ActionForm action={cancelIdpAction}>
              <input type="hidden" name="idpId" value={idp.id} />
              <button className="btn-quiet" type="submit">
                Отменить
              </button>
            </ActionForm>
          </div>
        ) : null}
        {groups.map((group) => (
          <div key={group.competencyId} className="space-y-2">
            <h3 className="section-title mb-0">
              {group.name}
              {group.requiredLevel != null ? (
                <span className="muted font-normal"> · уровень {group.requiredLevel}</span>
              ) : null}
              <span className="chip ml-2">{group.confirmed ? "компетенция подтверждена" : "не подтверждена"}</span>
            </h3>
            <CompetencyLinks links={links.get(group.competencyId) ?? []} />
            <ul className="space-y-3">
              {group.rows.map((item) => {
                const acceptedRow = item.acceptedAt != null;
                const canTickRow = tick && !acceptedRow;
                return (
                  <li key={item.id} className="panel panel-pad space-y-3 text-sm">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="font-medium">{item.assignmentName}</div>
                        {item.dueOn ? <div className="muted text-xs">срок {item.dueOn}</div> : null}
                      </div>
                      <span className="chip">{acceptedRow ? "принято" : ITEM_STATUS[item.status] ?? item.status}</span>
                    </div>
                    <div>
                      <div className="muted text-xs">Узнать</div>
                      <p className="whitespace-pre-wrap">{item.learnText}</p>
                    </div>
                    <div>
                      <div className="muted text-xs">Проверить</div>
                      <p className="whitespace-pre-wrap">{item.verifyText}</p>
                    </div>
                    {canTickRow ? (
                      <ActionForm action={setIdpItemStatusAction} className="flex flex-wrap items-end gap-2">
                        <input type="hidden" name="itemId" value={item.id} />
                        <label className="lbl">
                          Ход
                          <select className="field" name="status" defaultValue={item.status}>
                            <option value="not_started">не начат</option>
                            <option value="in_progress">в работе</option>
                            <option value="done">сделал</option>
                          </select>
                        </label>
                        <button className="btn-quiet" type="submit">
                          Ок
                        </button>
                      </ActionForm>
                    ) : null}
                    {manage && !acceptedRow ? (
                      <ActionForm action={acceptIdpItemAction}>
                        <input type="hidden" name="itemId" value={item.id} />
                        <button className="btn" type="submit">
                          Принять
                        </button>
                      </ActionForm>
                    ) : null}
                    {(manage || reopen) && acceptedRow ? (
                      <ActionForm action={unacceptIdpItemAction}>
                        <input type="hidden" name="itemId" value={item.id} />
                        <button className="btn-quiet" type="submit">
                          Снять приёмку
                        </button>
                      </ActionForm>
                    ) : null}
                    {manage ? (
                      <ActionForm action={updateIdpItemAction} className="grid gap-2">
                        <input type="hidden" name="itemId" value={item.id} />
                        <label className="lbl">
                          Название
                          <input className="field" name="name" defaultValue={item.assignmentName} />
                        </label>
                        <label className="lbl">
                          Узнать
                          <textarea className="field" name="learnText" rows={3} defaultValue={item.learnText} />
                        </label>
                        <label className="lbl">
                          Проверить
                          <textarea className="field" name="verifyText" rows={3} defaultValue={item.verifyText} />
                        </label>
                        <label className="lbl">
                          Срок
                          <input
                            className="field"
                            type="date"
                            name="dueOn"
                            defaultValue={item.dueOn ?? ""}
                            min={idp.periodStart}
                            max={idp.periodEnd}
                          />
                        </label>
                        <button className="btn w-fit" type="submit">
                          Сохранить тексты
                        </button>
                      </ActionForm>
                    ) : null}
                    {manage ? (
                      <ActionForm action={deleteIdpItemAction}>
                        <input type="hidden" name="itemId" value={item.id} />
                        <button className="btn-danger" type="submit">
                          Убрать из плана
                        </button>
                      </ActionForm>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {items.length === 0 ? (
          <p className="muted text-sm">
            Заданий пока нет. ИПР станет выполненным, когда добавите хотя бы одно и примете все.
          </p>
        ) : null}
        {manage && pool.length > 0 ? (
          <AddIdpItemForm
            idpId={idp.id}
            periodStart={idp.periodStart}
            periodEnd={idp.periodEnd}
            pool={pool}
            catalog={catalog}
          />
        ) : null}
        {manage && pool.length === 0 ? (
          <p className="muted text-sm">В пуле нет компетенций. Нажмите «Обновить разрыв».</p>
        ) : null}
      </div>
    </section>
  );
}
