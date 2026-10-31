import { ActionForm } from "@/components/ActionForm";
import { AddIdpItemForm } from "@/components/AddIdpItemForm";
import { IdpItemEdit } from "@/components/IdpItemEdit";
import { IdpItemStatus } from "@/components/IdpItemStatus";
import {
  acceptIdpItemAction,
  cancelIdpAction,
  refreshIdpPoolAction,
  unacceptIdpItemAction,
} from "@/app/idp-actions";
import type { SessionEmployee } from "@/lib/auth";
import { canManageEmployee, canTickIdpItem } from "@/lib/invariants";
import {
  getActiveIdp,
  getJob,
  listActiveIdpAssignmentsFor,
  listCompetencyLinks,
  listIdpItems,
  listItemAttemptState,
  listItemQuestionPrompts,
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
  const prompts = listItemQuestionPrompts(items.map((item) => item.id));
  const attempts = listItemAttemptState(items.map((item) => item.id));
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
                Обновить доступные компетенции
              </button>
            </ActionForm>
            <ActionForm action={cancelIdpAction}>
              <input type="hidden" name="idpId" value={idp.id} />
              <button className="btn-warn" type="submit">
                Отменить
              </button>
            </ActionForm>
          </div>
        ) : null}
        {groups.map((group) => {
          const materialCount = (links.get(group.competencyId) ?? []).length;
          const materialHref = actor.isAdmin
            ? `/admin/competencies/${encodeURIComponent(group.competencyId)}`
            : `/competencies/${encodeURIComponent(group.competencyId)}`;
          return (
          <div key={group.competencyId} className="space-y-2">
            <h3 className="section-title mb-0 flex flex-wrap items-baseline gap-2">
              <span>
                {group.name}
                {group.requiredLevel != null ? (
                  <span className="muted font-normal"> · уровень {group.requiredLevel}</span>
                ) : null}
                <span className="chip ml-2">{group.confirmed ? "компетенция подтверждена" : "не подтверждена"}</span>
              </span>
              {materialCount > 0 ? (
                <a className="link-accent ml-auto text-sm font-normal" href={materialHref}>
                  Материалы
                </a>
              ) : null}
            </h3>
            <div className="idp-table-scroll">
            <table className="idp-table">
              <thead>
                <tr>
                  <th>Цель</th>
                  <th>Узнать</th>
                  <th>Проверить</th>
                  <th>Тест</th>
                  <th>Срок</th>
                  <th>Статус</th>
                  <th>Подтверждение</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map((item) => {
                  const acceptedRow = item.acceptedAt != null;
                  const canTickRow = tick && !acceptedRow;
                  const questionCount = (prompts.get(item.id) ?? []).length;
                  const attemptCount = attempts.get(item.id)?.count ?? 0;
                  const canTake = actor.id === idp.employeeId && open && !acceptedRow && questionCount > 0;
                  return (
                    <tr key={item.id} id={`item-${item.id}`}>
                      <IdpItemEdit
                        itemId={item.id}
                        name={item.assignmentName}
                        assignmentLevel={item.assignmentLevel}
                        learnText={item.learnText}
                        verifyText={item.verifyText}
                        dueOn={item.dueOn}
                        manage={manage}
                        learnExtra={null}
                        test={
                          <>
                            {questionCount === 0 ? <p className="muted">нет</p> : null}
                            {attemptCount > 0 ? (
                              <p className="text-sm">
                                Итог теста: {attempts.get(item.id)?.passed ? "сдан" : "не сдан"}, попыток {attemptCount}
                              </p>
                            ) : null}
                            {questionCount > 0 && attemptCount === 0 && !canTake ? <p className="text-sm">Тест есть</p> : null}
                            {canTake ? (
                              <p className="mt-2">
                                <a className="link-accent" href={`/idps/${idp.id}/items/${item.id}`}>
                                  Сдать тест
                                </a>
                              </p>
                            ) : null}
                          </>
                        }
                        status={
                          canTickRow ? (
                            <IdpItemStatus itemId={item.id} status={item.status} />
                          ) : (
                            ITEM_STATUS[item.status] ?? item.status
                          )
                        }
                        confirm={
                          <>
                            <div className="idp-confirm-line">
                              {manage && !acceptedRow ? (
                                <ActionForm action={acceptIdpItemAction}>
                                  <input type="hidden" name="itemId" value={item.id} />
                                  <button className="btn-success" type="submit">
                                    Подтвердить
                                  </button>
                                </ActionForm>
                              ) : null}
                              {(manage || reopen) && acceptedRow ? (
                                <ActionForm action={unacceptIdpItemAction}>
                                  <input type="hidden" name="itemId" value={item.id} />
                                  <button className="btn-warn" type="submit">
                                    Снять подтверждение
                                  </button>
                                </ActionForm>
                              ) : null}
                              {acceptedRow ? <span className="chip">принято</span> : null}
                            </div>
                          </>
                        }
                      />
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </div>
          );
        })}
        {items.length === 0 ? (
          <p className="muted text-sm">
            Заданий пока нет. ИПР станет выполненным, когда добавите хотя бы одно и примете все.
          </p>
        ) : null}
        {(manage || reopen) && pool.length > 0 ? (
          <AddIdpItemForm idpId={idp.id} pool={pool} catalog={catalog} />
        ) : null}
        {manage && pool.length === 0 ? (
          <p className="muted text-sm">В пуле нет компетенций. Нажмите «Обновить доступные компетенции».</p>
        ) : null}
      </div>
    </section>
  );
}
