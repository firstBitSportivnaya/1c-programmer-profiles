"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { setCompetencyMarkAction } from "@/app/people-actions";

type MarkStatus = "" | "has" | "lacks" | "in_progress";

const OPTIONS: { value: MarkStatus; label: string }[] = [
  { value: "", label: "не отмечено" },
  { value: "has", label: "есть" },
  { value: "lacks", label: "нет" },
  { value: "in_progress", label: "в процессе" },
];

function isMarkStatus(value: string): value is MarkStatus {
  return value === "" || value === "has" || value === "lacks" || value === "in_progress";
}

/**
 * Личная пометка прямо в карточке навыка (ADR 0007, 0008).
 * Статус уходит сразу после выбора, пояснение — при уходе из поля.
 * Свой FormData вместо `<form action>`: иначе useActionState сбрасывает форму к defaultValue.
 */
export function SkillMarkForm({
  competencyId,
  name,
  status,
  note,
}: {
  competencyId: string;
  name: string;
  status: string;
  note: string;
}) {
  const savedNote = useRef(note);
  const [current, setCurrent] = useState<MarkStatus>(isMarkStatus(status) ? status : "");
  const [text, setText] = useState(note);
  const [state, submit, pending] = useActionState(setCompetencyMarkAction, null);

  // Сервер вернул новое состояние после сохранения: подтягиваем его, не теряя набранный текст.
  useEffect(() => {
    setCurrent(isMarkStatus(status) ? status : "");
    setText(note);
    savedNote.current = note;
  }, [note, status]);

  function send(nextStatus: MarkStatus, nextNote: string) {
    const data = new FormData();
    data.set("competencyId", competencyId);
    data.set("status", nextStatus);
    data.set("note", nextStatus ? nextNote : "");
    savedNote.current = nextStatus ? nextNote : "";
    startTransition(() => {
      submit(data);
    });
  }

  return (
    <div className="skill-mark">
      <select
        className="field"
        aria-label={`Статус: ${name}`}
        value={current}
        onChange={(event) => {
          const next = event.target.value;
          if (!isMarkStatus(next)) return;
          setCurrent(next);
          send(next, next ? text : "");
        }}
      >
        {OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {current ? (
        <textarea
          className="field skill-mark__note"
          rows={2}
          aria-label={`Пояснение: ${name}`}
          placeholder="Пояснение: что уже получается, чему ещё учиться"
          maxLength={1000}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={(event) => {
            const value = event.currentTarget.value;
            if (value === savedNote.current) return;
            send(current, value);
          }}
        />
      ) : null}
      {state?.error ? (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      ) : null}
      {pending ? (
        <p className="muted text-sm" aria-live="polite">
          Сохраняем…
        </p>
      ) : null}
    </div>
  );
}
