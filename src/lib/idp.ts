import { eq } from "drizzle-orm";
import { getDb, now } from "@/db";
import { idpItems, idpPool, idps } from "@/db/schema";
import { gapSnapshot } from "@/lib/gap";
import { InvariantError } from "@/lib/invariants";
import { getIdp, listIdpItems } from "@/lib/queries";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DOT_DATE_RE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;

export function parseIsoDate(raw: string, label: string) {
  let value = raw.trim();
  const dotted = value.match(DOT_DATE_RE);
  if (dotted) {
    value = `${dotted[3]}-${dotted[2].padStart(2, "0")}-${dotted[1].padStart(2, "0")}`;
  }
  if (!DATE_RE.test(value)) {
    throw new InvariantError(`${label}: нужна дата ГГГГ-ММ-ДД`);
  }
  const stamp = Date.parse(`${value}T00:00:00`);
  if (Number.isNaN(stamp)) {
    throw new InvariantError(`${label}: несуществующая дата`);
  }
  return value;
}

export function parsePeriod(startRaw: string, endRaw: string) {
  const periodStart = parseIsoDate(startRaw, "Начало периода");
  const periodEnd = parseIsoDate(endRaw, "Конец периода");
  if (periodStart > periodEnd) {
    throw new InvariantError("Начало периода не может быть позже конца");
  }
  return { periodStart, periodEnd };
}

export function parseOptionalDue(raw: string, periodStart: string, periodEnd: string) {
  const value = raw.trim();
  if (!value) return null;
  const dueOn = parseIsoDate(value, "Срок задания");
  if (dueOn < periodStart || dueOn > periodEnd) {
    throw new InvariantError("Срок задания должен быть внутри периода ИПР");
  }
  return dueOn;
}

export function fillIdpPool(idpId: string, sourceJobId: string, targetJobId: string) {
  const db = getDb();
  for (const item of gapSnapshot(sourceJobId, targetJobId)) {
    db.insert(idpPool)
      .values({
        idpId,
        competencyId: item.competencyId,
        competencyName: item.competencyName,
        requiredLevel: item.requiredLevel,
      })
      .run();
  }
}

export function expandIdpPool(idpId: string, sourceJobId: string, targetJobId: string) {
  const db = getDb();
  const have = new Set(
    db.select().from(idpPool).where(eq(idpPool.idpId, idpId)).all().map((row) => row.competencyId),
  );
  for (const item of gapSnapshot(sourceJobId, targetJobId)) {
    if (have.has(item.competencyId)) continue;
    db.insert(idpPool)
      .values({
        idpId,
        competencyId: item.competencyId,
        competencyName: item.competencyName,
        requiredLevel: item.requiredLevel,
      })
      .run();
  }
}

export function maybeCompleteIdp(idpId: string) {
  const idp = getIdp(idpId);
  if (!idp || idp.status !== "active") return;
  const items = listIdpItems(idpId);
  if (items.length === 0) return;
  if (items.some((item) => item.acceptedAt == null)) return;
  getDb().update(idps).set({ status: "completed", updatedAt: now() }).where(eq(idps.id, idpId)).run();
}

export function nextItemSort(idpId: string) {
  return listIdpItems(idpId).reduce((max, item) => Math.max(max, item.sortOrder), -1) + 1;
}

export function getIdpItem(itemId: number) {
  return getDb().select().from(idpItems).where(eq(idpItems.id, itemId)).get();
}
