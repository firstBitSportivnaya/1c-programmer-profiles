"use client";

import { useRef, useState, type ReactNode } from "react";

/** Блоки профиля с одной кнопкой «Развернуть все / Свернуть все» для всех `details` внутри. Состояние не запоминается. */
export function ExpandAll({ className, children }: { className?: string; children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);

  function toggle() {
    const next = !expanded;
    rootRef.current?.querySelectorAll("details").forEach((details) => {
      details.open = next;
    });
    setExpanded(next);
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button className="btn" type="button" onClick={toggle}>
          {expanded ? "Свернуть все" : "Развернуть все"}
        </button>
      </div>
      <div ref={rootRef} className={className}>
        {children}
      </div>
    </div>
  );
}
