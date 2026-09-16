import { ActionForm } from "@/components/ActionForm";
import {
  addFreeIdpItemAction,
  closeIdpAction,
  refreshIdpSnapshotAction,
  setIdpItemStatusAction,
} from "@/app/people-actions";
import type { SessionEmployee } from "@/lib/auth";
import { canManageEmployee, canTickIdpItem } from "@/lib/invariants";
import { getActiveIdp, getJob, listIdpItems, listIdps } from "@/lib/queries";
import type { idpItems, idps } from "@/db/schema";

const ITEM_STATUS: Record<string, string> = {
  not_started: "не начат",
  in_progress: "в работе",
  done: "закрыт",
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
  const done = items.filter((item) => item.status === "done").length;
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
            {done} из {items.length}
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

export function IdpBlock({
  actor,
  idp,
  items,
}: {
  actor: SessionEmployee;
  idp: typeof idps.$inferSelect;
  items: (typeof idpItems.$inferSelect)[];
}) {
  const open = idp.status === "active";
  const manage = open && canManageEmployee(actor, idp.employeeId);
  const tick = open && canTickIdpItem(actor, idp.employeeId);
  const doneCount = items.filter((item) => item.status === "done").length;

  return (
    <section className="space-y-4">
      <div className="panel panel-pad space-y-4">
        <p>
          <span className="chip">{IDP_STATUS[idp.status] ?? idp.status}</span>
          <span className="muted ml-2">
            {doneCount} из {items.length} пунктов закрыто
          </span>
        </p>
        {manage ? (
          <div className="flex flex-wrap gap-2">
            <ActionForm action={refreshIdpSnapshotAction}>
              <input type="hidden" name="idpId" value={idp.id} />
              <button className="btn" type="submit">
                Обновить снимок
              </button>
            </ActionForm>
            <ActionForm action={closeIdpAction}>
              <input type="hidden" name="idpId" value={idp.id} />
              <input type="hidden" name="status" value="completed" />
              <button className="btn" type="submit">
                Выполнен
              </button>
            </ActionForm>
            <ActionForm action={closeIdpAction}>
              <input type="hidden" name="idpId" value={idp.id} />
              <input type="hidden" name="status" value="cancelled" />
              <button className="btn-quiet" type="submit">
                Отменить
              </button>
            </ActionForm>
          </div>
        ) : null}
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="list-row text-sm">
              <div>
                <div>{item.kind === "free" ? item.body : item.competencyName}</div>
                {item.kind === "gap" && item.requiredLevel != null ? (
                  <div className="muted text-xs">нужен уровень {item.requiredLevel}</div>
                ) : null}
              </div>
              {tick ? (
                <ActionForm action={setIdpItemStatusAction} className="flex items-center gap-2">
                  <input type="hidden" name="itemId" value={item.id} />
                  <select className="field" name="status" defaultValue={item.status}>
                    <option value="not_started">не начат</option>
                    <option value="in_progress">в работе</option>
                    <option value="done">закрыт</option>
                  </select>
                  <button className="btn-quiet" type="submit">
                    Ок
                  </button>
                </ActionForm>
              ) : (
                <span className="chip">{ITEM_STATUS[item.status] ?? item.status}</span>
              )}
            </li>
          ))}
          {items.length === 0 ? <li className="muted text-sm">Пунктов нет</li> : null}
        </ul>
        {manage ? (
          <ActionForm action={addFreeIdpItemAction} className="flex flex-wrap items-end gap-2 text-sm">
            <input type="hidden" name="idpId" value={idp.id} />
            <label className="lbl grow">
              Свободный пункт
              <input className="field" name="body" />
            </label>
            <button className="btn" type="submit">
              Добавить
            </button>
          </ActionForm>
        ) : null}
      </div>
    </section>
  );
}
