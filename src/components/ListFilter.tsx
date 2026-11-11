"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ListSort } from "@/lib/list-query";

const DELAY_MS = 250;

/**
 * Поиск и сортировка списка: поле и `select` пишут `q` и `sort` в адрес через 250 мс.
 * Форма `method="get"` остаётся для входа без JavaScript. Кнопка «Показать» шлёт её сразу.
 */
export function ListFilter({
  action,
  q,
  sort,
  sorts,
  competency,
}: {
  action: string;
  q: string;
  sort: ListSort;
  sorts: { value: ListSort; label: string }[];
  competency?: { value: string; options: { id: string; name: string }[] };
}) {
  const router = useRouter();
  const [query, setQuery] = useState(q);
  const [order, setOrder] = useState<ListSort>(sort);
  const [competencyId, setCompetencyId] = useState(competency?.value ?? "");
  const competencyRef = useRef(competencyId);
  competencyRef.current = competencyId;

  useEffect(() => {
    setQuery(q);
    setOrder(sort);
    setCompetencyId(competency?.value ?? "");
  }, [q, sort, competency?.value]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams();
      const text = query.trim();
      if (text) params.set("q", text);
      if (order !== "name") params.set("sort", order);
      if (competencyRef.current) params.set("competency", competencyRef.current);
      const current = new URLSearchParams(window.location.search);
      const same =
        window.location.pathname === action &&
        (current.get("q") ?? "") === (params.get("q") ?? "") &&
        (current.get("sort") ?? "name") === (params.get("sort") ?? "name") &&
        (current.get("competency") ?? "") === (params.get("competency") ?? "");
      if (same) return;
      const next = params.toString();
      router.replace(next ? `${action}?${next}` : action, { scroll: false });
    }, DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [action, order, query, router]);

  return (
    <form action={action} method="get" className="flex flex-wrap items-end gap-3">
      <label className="lbl">
        Поиск
        <input className="field" name="q" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <label className="lbl">
        Сортировка
        <select
          className="field"
          name="sort"
          aria-label="Сортировка"
          value={order}
          onChange={(event) => setOrder(event.target.value as ListSort)}
        >
          {sorts.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      {competency ? (
        <label className="lbl">
          Компетенция
          <select
            className="field"
            name="competency"
            aria-label="Фильтр компетенции"
            value={competencyId}
            onChange={(event) => setCompetencyId(event.target.value)}
          >
            <option value="">все</option>
            {competency.options.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <button className="btn" type="submit">
        Показать
      </button>
    </form>
  );
}
