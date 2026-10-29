"use client";

import { useRef, useState } from "react";

const MONTHS = [
  "январь",
  "февраль",
  "март",
  "апрель",
  "май",
  "июнь",
  "июль",
  "август",
  "сентябрь",
  "октябрь",
  "ноябрь",
  "декабрь",
];

type MonthCursor = { year: number; month: number };

function todayCursor(): MonthCursor {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() };
}

function cursorFromValue(value: string): MonthCursor {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(value);
  if (!match) return todayCursor();
  return { year: Number(match[1]), month: Number(match[2]) - 1 };
}

function shiftMonth(cursor: MonthCursor, delta: number): MonthCursor {
  const next = new Date(Date.UTC(cursor.year, cursor.month + delta, 1));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() };
}

function monthStamp(cursor: MonthCursor) {
  return `${cursor.year}-${String(cursor.month + 1).padStart(2, "0")}`;
}

function dayIso(cursor: MonthCursor, day: number) {
  return `${monthStamp(cursor)}-${String(day).padStart(2, "0")}`;
}

function leadingBlanks(cursor: MonthCursor) {
  const sunday = new Date(Date.UTC(cursor.year, cursor.month, 1)).getUTCDay();
  return (sunday + 6) % 7;
}

function daysInMonth(cursor: MonthCursor) {
  return new Date(Date.UTC(cursor.year, cursor.month + 1, 0)).getUTCDate();
}

/** Поле даты: ввод с клавиатуры и выбор дня кнопкой календаря. */
export function DateField({
  name,
  label,
  ariaLabel,
  defaultValue = "",
  required = false,
  form,
}: {
  name: string;
  label?: string;
  ariaLabel?: string;
  defaultValue?: string;
  required?: boolean;
  form?: string;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(() => cursorFromValue(defaultValue));
  const [place, setPlace] = useState({ top: 0, left: 0 });
  const blanks = leadingBlanks(cursor);
  const days = daysInMonth(cursor);

  function toggle() {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      const width = 264;
      const height = 340;
      const below = rect.bottom + 4;
      const top = below + height > window.innerHeight ? Math.max(8, rect.top - height - 4) : below;
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      setPlace({ top, left });
    }
    setCursor(cursorFromValue(value));
    setOpen((current) => !current);
  }

  const input = (
    <input
      className="field"
      type="date"
      name={name}
      required={required}
      value={value}
      form={form}
      aria-label={label ? undefined : ariaLabel}
      onChange={(event) => setValue(event.target.value)}
    />
  );

  return (
    <div className="date-field">
      {label ? (
        <label className="lbl">
          {label}
          {input}
        </label>
      ) : (
        input
      )}
      <button
        ref={buttonRef}
        className="btn date-calendar-open"
        type="button"
        aria-expanded={open}
        aria-label="Показать календарь"
        onClick={toggle}
      >
        Календарь
      </button>
      {open ? (
        <div
          className="date-calendar panel panel-pad"
          role="dialog"
          aria-label="Календарь"
          data-month={monthStamp(cursor)}
          style={{ top: place.top, left: place.left }}
        >
          <div className="date-calendar-bar">
            <button className="btn" type="button" aria-label="Предыдущий месяц" onClick={() => setCursor((current) => shiftMonth(current, -1))}>
              ‹
            </button>
            <span>
              {MONTHS[cursor.month]} {cursor.year}
            </span>
            <button className="btn" type="button" aria-label="Следующий месяц" onClick={() => setCursor((current) => shiftMonth(current, 1))}>
              ›
            </button>
          </div>
          <div className="date-calendar-grid">
            {Array.from({ length: blanks }, (_, index) => (
              <span key={`blank-${index}`} />
            ))}
            {Array.from({ length: days }, (_, index) => {
              const iso = dayIso(cursor, index + 1);
              return (
                <button
                  key={iso}
                  className="btn"
                  type="button"
                  aria-label={iso}
                  aria-pressed={value === iso}
                  onClick={() => {
                    setValue(iso);
                    setOpen(false);
                  }}
                >
                  {index + 1}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
