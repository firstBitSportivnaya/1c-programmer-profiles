"use client";

import { useActionState, useState } from "react";
import { addIdpItemAction } from "@/app/idp-actions";

type PoolRow = { competencyId: string; competencyName: string; requiredLevel: number | null };
type CatalogRow = { id: string; name: string; competencyName: string };

const DOT_DATE_RE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;

function toIsoDate(raw: string) {
  const value = raw.trim();
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const dotted = value.match(DOT_DATE_RE);
  if (!dotted) return null;
  return `${dotted[3]}-${dotted[2].padStart(2, "0")}-${dotted[1].padStart(2, "0")}`;
}

export function AddIdpItemForm({
  idpId,
  periodStart,
  periodEnd,
  pool,
  catalog,
}: {
  idpId: string;
  periodStart: string;
  periodEnd: string;
  pool: PoolRow[];
  catalog: CatalogRow[];
}) {
  const [state, formAction, pending] = useActionState(addIdpItemAction, null);
  const [localError, setLocalError] = useState<string | null>(null);
  const error = localError ?? state?.error ?? null;

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    setLocalError(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    const assignmentId = String(data.get("assignmentId") ?? "").trim();
    if (!assignmentId) {
      const name = String(data.get("name") ?? "").trim();
      const learnText = String(data.get("learnText") ?? "").trim();
      const verifyText = String(data.get("verifyText") ?? "").trim();
      if (!name || !learnText || !verifyText) {
        event.preventDefault();
        setLocalError("Нужны название, узнать и проверить");
        return;
      }
    }
    const dueField = form.elements.namedItem("dueOn");
    if (!(dueField instanceof HTMLInputElement)) return;
    const iso = toIsoDate(dueField.value);
    if (dueField.value && iso == null) {
      event.preventDefault();
      setLocalError("Срок задания: нужна дата ГГГГ-ММ-ДД");
      return;
    }
    if (iso) {
      if (iso < periodStart || iso > periodEnd) {
        event.preventDefault();
        setLocalError("Срок задания должен быть внутри периода ИПР");
        return;
      }
      dueField.value = iso;
    }
  }

  return (
    <form action={formAction} onSubmit={onSubmit} noValidate className="grid gap-2 text-sm md:grid-cols-2">
      <h3 className="section-title md:col-span-2 mb-0">Добавить задание</h3>
      <input type="hidden" name="idpId" value={idpId} />
      <label className="lbl">
        Компетенция
        <select className="field" name="competencyId" required>
          {pool.map((row) => (
            <option key={row.competencyId} value={row.competencyId}>
              {row.competencyName}
              {row.requiredLevel != null ? ` · ур. ${row.requiredLevel}` : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="lbl">
        Из справочника
        <select className="field" name="assignmentId">
          <option value="">новое задание</option>
          {catalog.map((row) => (
            <option key={row.id} value={row.id}>
              {row.competencyName}: {row.name}
            </option>
          ))}
        </select>
      </label>
      <label className="lbl md:col-span-2">
        Название (если новое)
        <input className="field" name="name" />
      </label>
      <label className="lbl">
        Узнать
        <textarea className="field" name="learnText" rows={3} />
      </label>
      <label className="lbl">
        Проверить
        <textarea className="field" name="verifyText" rows={3} />
      </label>
      <label className="lbl">
        Срок
        <input className="field" type="date" name="dueOn" />
      </label>
      <div className="flex flex-col items-start gap-2">
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <button className="btn-primary w-fit" type="submit" disabled={pending}>
          {pending ? "Добавляем…" : "Добавить"}
        </button>
      </div>
    </form>
  );
}
