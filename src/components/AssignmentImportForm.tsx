"use client";

import { useActionState } from "react";
import { importAssignmentsAction } from "@/app/idp-actions";
import { ASSIGNMENT_IMPORT_COLUMNS } from "@/lib/assignment-workbook";

export function AssignmentImportForm() {
  const [state, action, pending] = useActionState(importAssignmentsAction, null);
  return (
    <form action={action} className="panel panel-pad space-y-3 text-sm" aria-label="Загрузка">
      <h2 className="section-title mb-0">Загрузка</h2>
      <p className="muted">
        Колонки: {ASSIGNMENT_IMPORT_COLUMNS.join(", ")}. Строка — один вариант ответа. Признак «верный»: да или нет.
        Колонка «Уровень» необязательна: 1, 2 или 3. Пустая ячейка уже заданный уровень не меняет.
      </p>
      <label className="lbl">
        Файл Excel
        <input className="field" type="file" name="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required />
      </label>
      <button className="btn-primary w-fit" type="submit">
        Загрузить
      </button>
      {state?.error ? (
        <p className="form-error whitespace-pre-line" role="alert">
          {state.error}
        </p>
      ) : null}
      {state?.notice ? (
        <p className="whitespace-pre-line" role="status">
          {state.notice}
        </p>
      ) : null}
      {pending ? <p className="muted text-sm">Сохраняем…</p> : null}
    </form>
  );
}
