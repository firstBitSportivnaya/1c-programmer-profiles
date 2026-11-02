"use client";

import { useState } from "react";
import { addIdpItemAction } from "@/app/idp-actions";
import { ActionForm } from "@/components/ActionForm";
import { DateField } from "@/components/DateField";

type PoolRow = { competencyId: string; competencyName: string; requiredLevel: number | null };
type CatalogRow = { id: string; name: string; competencyId: string; competencyName: string; level: number | null };

export function AddIdpItemForm({
  idpId,
  pool,
  catalog,
}: {
  idpId: string;
  pool: PoolRow[];
  catalog: CatalogRow[];
}) {
  const [competencyId, setCompetencyId] = useState(pool[0]?.competencyId ?? "");
  const [fromCatalog, setFromCatalog] = useState(false);
  const [level, setLevel] = useState("1");
  const bar = pool.find((row) => row.competencyId === competencyId)?.requiredLevel ?? null;
  const choices = [1, 2, 3].filter((item) => bar == null || item <= bar);
  const levelValue = choices.some((item) => String(item) === level) ? level : String(choices[0] ?? "");
  const visible = catalog.filter(
    (row) => row.competencyId === competencyId && row.level != null && (bar == null || row.level <= bar),
  );

  return (
    <ActionForm
      action={addIdpItemAction}
      className="grid gap-2 md:grid-cols-2"
      beforeSubmit={(formData) => {
        if (String(formData.get("assignmentId") ?? "").trim()) return null;
        const name = String(formData.get("name") ?? "").trim();
        const learnText = String(formData.get("learnText") ?? "").trim();
        const verifyText = String(formData.get("verifyText") ?? "").trim();
        if (!name || !learnText || !verifyText) return "Нужны название, узнать и проверить";
        return null;
      }}
    >
      <h3 className="section-title md:col-span-2 mb-0">Добавить задание</h3>
      <input type="hidden" name="idpId" value={idpId} />
      <label className="lbl">
        Компетенция
        <select
          className="field"
          name="competencyId"
          required
          value={competencyId}
          onChange={(event) => {
            setCompetencyId(event.target.value);
            setFromCatalog(false);
          }}
        >
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
        <select
          key={competencyId}
          className="field"
          name="assignmentId"
          defaultValue=""
          onChange={(event) => setFromCatalog(event.target.value !== "")}
        >
          <option value="">новое задание</option>
          {visible.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
              {row.level != null ? ` · ур. ${row.level}` : ""}
            </option>
          ))}
        </select>
      </label>
      {fromCatalog ? null : (
        <label className="lbl">
          Уровень
          <select className="field" name="level" value={levelValue} onChange={(event) => setLevel(event.target.value)}>
            {choices.map((item) => (
              <option key={item} value={String(item)}>
                {item === 1 ? "1 · базовый" : item === 2 ? "2 · уверенный" : "3 · эксперт"}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="lbl">
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
      <DateField label="Срок" name="dueOn" />
      <button className="btn-primary w-fit" type="submit">
        Добавить
      </button>
    </ActionForm>
  );
}
