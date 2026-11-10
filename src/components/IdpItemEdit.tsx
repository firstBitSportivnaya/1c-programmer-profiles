"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { deleteIdpItemAction, updateIdpItemAction } from "@/app/idp-actions";
import { ActionForm } from "@/components/ActionForm";
import { DateField } from "@/components/DateField";

export function IdpItemEdit({
  itemId,
  name,
  assignmentLevel,
  learnText,
  verifyText,
  dueOn,
  dueLabel,
  manage,
  learnExtra,
  test,
  status,
  confirm,
}: {
  itemId: number;
  name: string;
  assignmentLevel: number | null;
  learnText: string;
  verifyText: string;
  dueOn: string | null;
  /** Готовая подпись срока: `ДД.ММ.ГГГГ` или тире. В поле ввода остаётся ISO. */
  dueLabel: string;
  manage: boolean;
  learnExtra: ReactNode;
  test: ReactNode;
  status: ReactNode;
  confirm: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const formId = `idp-item-${itemId}`;

  useEffect(() => {
    setReady(true);
  }, []);

  return (
    <>
      <td>
        {open ? (
          <input className="field" name="name" form={formId} aria-label="Название" defaultValue={name} />
        ) : (
          <div className="font-medium">
            <span>{name}</span>
            {assignmentLevel != null ? <span className="muted font-normal"> · ур. {assignmentLevel}</span> : null}
          </div>
        )}
      </td>
      <td>
        {open ? (
          <textarea className="field" name="learnText" form={formId} aria-label="Узнать" rows={3} defaultValue={learnText} />
        ) : (
          <p className="whitespace-pre-wrap">{learnText}</p>
        )}
        {learnExtra}
      </td>
      <td>
        {open ? (
          <textarea className="field" name="verifyText" form={formId} aria-label="Проверить" rows={3} defaultValue={verifyText} />
        ) : (
          <p className="whitespace-pre-wrap">{verifyText}</p>
        )}
      </td>
      <td>{test}</td>
      <td>
        {open ? (
          <DateField name="dueOn" ariaLabel="Срок" form={formId} defaultValue={dueOn ?? ""} />
        ) : (
          dueLabel
        )}
      </td>
      <td>{status}</td>
      <td>{confirm}</td>
      <td>
        {manage && !open ? (
          <button className="btn" type="button" disabled={!ready} onClick={() => setOpen(true)}>
            Править
          </button>
        ) : null}
        {manage && open ? (
          <div className="flex flex-wrap items-center gap-2">
            <ActionForm id={formId} action={updateIdpItemAction} onSuccess={close}>
              <input type="hidden" name="itemId" value={itemId} />
              <button className="btn" type="submit">
                Сохранить
              </button>
            </ActionForm>
            <ActionForm action={deleteIdpItemAction}>
              <input type="hidden" name="itemId" value={itemId} />
              <button className="btn-danger" type="submit">
                Убрать из плана
              </button>
            </ActionForm>
          </div>
        ) : null}
      </td>
    </>
  );
}
