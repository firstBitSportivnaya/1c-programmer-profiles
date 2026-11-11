"use client";

import { useEffect, useState } from "react";

/** Поле даты: клавиатура и системный календарь справа. До гидратации поле выключено, иначе ранний ввод стирается. */
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
  const [value, setValue] = useState(defaultValue);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
  }, []);

  const input = (
    <input
      className="field"
      type="date"
      name={name}
      required={required}
      value={value}
      form={form}
      disabled={!ready}
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
    </div>
  );
}
