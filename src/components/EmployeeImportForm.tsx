"use client";

import { useActionState } from "react";
import { importEmployeesAction } from "@/app/people-actions";
import { EMPLOYEE_IMPORT_COLUMNS } from "@/lib/employee-workbook";

export function EmployeeImportForm() {
  const [state, action, pending] = useActionState(importEmployeesAction, null);
  return (
    <form action={action} className="panel panel-pad space-y-3" aria-label="Загрузка сотрудников">
      <h2 className="section-title mb-0">Загрузка сотрудников</h2>
      <p className="muted">
        Excel. Колонки: {EMPLOYEE_IMPORT_COLUMNS.join(", ")}. Должность и руководитель — id или точное имя.
        «Админ»: да или нет. Существующий логин не меняется.
      </p>
      <label className="lbl">
        Файл
        <input
          className="field"
          type="file"
          name="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          required
        />
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
      {pending ? <p className="muted">Сохраняем…</p> : null}
    </form>
  );
}
