"use client";

import { startTransition, useActionState, useEffect, useLayoutEffect, useRef, useState } from "react";
import { setCompetencyMarkAction } from "@/app/people-actions";

type MarkStatus = "" | "has" | "lacks" | "in_progress";

type MarkBoardRow = {
  id: string;
  name: string;
  section: "technical" | "personal";
  onlyInTarget: boolean;
  criteria: string | null;
  status: MarkStatus;
  note: string;
  outside: boolean;
};

const SECTIONS = [
  { key: "technical", title: "Технические навыки", outside: false },
  { key: "personal", title: "Личные навыки", outside: false },
  { key: "outside", title: "Вне текущего профиля", outside: true },
] as const;

type StatusFilter = "" | "unmarked" | "has" | "lacks" | "in_progress";

function rowClass(status: MarkStatus) {
  if (status === "has") return "mark-has";
  if (status === "lacks") return "mark-lacks";
  if (status === "in_progress") return "mark-progress";
  return "mark-empty";
}

function isMarkStatus(value: string): value is MarkStatus {
  return value === "" || value === "has" || value === "lacks" || value === "in_progress";
}

function MarkRow({ row }: { row: MarkBoardRow }) {
  const formRef = useRef<HTMLFormElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const savedNote = useRef(row.note);
  const [status, setStatus] = useState(row.status);
  const [note, setNote] = useState(row.note);
  const [state, submitMark, pending] = useActionState(setCompetencyMarkAction, null);

  // Свой FormData, без <form action>: иначе useActionState вызывает form.reset() и возвращает список к старому значению.
  function submit(nextStatus: string, nextNote: string) {
    const data = new FormData();
    const competency = formRef.current?.elements.namedItem("competencyId");
    data.set("competencyId", competency instanceof HTMLInputElement ? competency.value : row.id);
    data.set("status", nextStatus);
    data.set("note", nextStatus ? nextNote : "");
    savedNote.current = nextStatus ? nextNote : "";
    startTransition(() => {
      submitMark(data);
    });
  }

  useEffect(() => {
    setStatus(row.status);
    if (selectRef.current) selectRef.current.value = row.status;
  }, [row.status]);

  useEffect(() => {
    savedNote.current = row.note;
    setNote(row.note);
  }, [row.note]);

  useLayoutEffect(() => {
    if (!state?.error) return;
    setStatus(row.status);
    if (selectRef.current) selectRef.current.value = row.status;
  }, [state, row.status]);

  return (
    <li className={`list-row mark-row ${rowClass(status)}`}>
      <div>
        <div>
          {row.name}
          {row.onlyInTarget ? <span className="chip ml-2">цель ИПР</span> : null}
        </div>
        {row.criteria ? <p className="skill-criteria">{row.criteria}</p> : null}
      </div>
      <form ref={formRef} className="space-y-2" onSubmit={(event) => event.preventDefault()}>
        <fieldset className="form-fields space-y-2">
          <input type="hidden" name="competencyId" value={row.id} />
          <select
            ref={selectRef}
            className="field"
            aria-label={`Статус: ${row.name}`}
            defaultValue={row.status}
            onChange={(event) => {
              const next = event.target.value;
              if (isMarkStatus(next)) setStatus(next);
              submit(next, next ? note : "");
            }}
          >
            <option value="">не отмечено</option>
            <option value="has">есть</option>
            <option value="lacks">нет</option>
            <option value="in_progress">в процессе</option>
          </select>
          {status ? (
            <textarea
              className="field w-full"
              name="note"
              rows={2}
              aria-label={`Пояснение: ${row.name}`}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              onBlur={(event) => {
                const value = event.currentTarget.value;
                setNote(value);
                if (value !== savedNote.current) submit(status, value);
              }}
            />
          ) : null}
        </fieldset>
        {state?.error ? (
          <p className="form-error" role="alert">
            {state.error}
          </p>
        ) : null}
        {pending ? (
          <p className="muted" aria-live="polite">
            Сохраняем…
          </p>
        ) : null}
      </form>
    </li>
  );
}

/** Список пометок: фильтр, автозапись статуса и пояснения. */
export function CompetencyMarkBoard({ rows }: { rows: MarkBoardRow[] }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [targetOnly, setTargetOnly] = useState(false);
  const needle = query.trim().toLocaleLowerCase("ru");
  const visible = rows.filter((row) => {
    if (targetOnly && (row.outside || !row.onlyInTarget)) return false;
    if (statusFilter === "unmarked" && row.status !== "") return false;
    if (statusFilter && statusFilter !== "unmarked" && row.status !== statusFilter) return false;
    if (needle && !row.name.toLocaleLowerCase("ru").includes(needle)) return false;
    return true;
  });

  if (rows.length === 0) {
    return <p className="muted">У должности нет профиля с навыками.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="lbl">
          Поиск
          <input
            className="field"
            aria-label="Поиск навыка"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label className="lbl">
          Статус
          <select
            className="field"
            aria-label="Фильтр статуса"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
          >
            <option value="">все</option>
            <option value="unmarked">не отмечено</option>
            <option value="has">есть</option>
            <option value="lacks">нет</option>
            <option value="in_progress">в процессе</option>
          </select>
        </label>
        <button
          type="button"
          className={targetOnly ? "chip chip-frontend" : "chip"}
          aria-pressed={targetOnly}
          onClick={() => setTargetOnly((value) => !value)}
        >
          только цель ИПР
        </button>
      </div>
      {visible.length === 0 ? <p className="muted">Ничего не найдено.</p> : null}
      {SECTIONS.map((section) => {
        const items = visible.filter((row) => (section.outside ? row.outside : !row.outside && row.section === section.key));
        if (items.length === 0) return null;
        return (
          <div key={section.key} className="space-y-2">
            <h2 className="section-title mb-0">{section.title}</h2>
            {section.outside ? (
              <p className="muted">
                «Не отмечено» убирает навык, пока он снова не войдёт в должность или цель ИПР.
              </p>
            ) : null}
            <ul className="panel">
              {items.map((row) => (
                <MarkRow key={row.id} row={row} />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
