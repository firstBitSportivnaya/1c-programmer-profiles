import { InvariantError } from "@/lib/invariants";
import { groupedProfile } from "@/lib/queries";

export type GapSnapshotItem = {
  competencyId: string;
  competencyName: string;
  requiredLevel: number | null;
};

export function gapSnapshot(currentJobId: string, targetJobId: string): GapSnapshotItem[] {
  const target = groupedProfile(targetJobId);
  if (!target) {
    throw new InvariantError("У целевой должности нет профиля");
  }
  const currentGrouped = groupedProfile(currentJobId);
  const current = new Map(
    (currentGrouped ? currentGrouped.technical.concat(currentGrouped.personal) : []).map((row) => [
      row.competency.id,
      row,
    ]),
  );
  const items: GapSnapshotItem[] = [];
  for (const row of target.technical.concat(target.personal)) {
    const have = current.get(row.competency.id);
    if (!have) {
      items.push({
        competencyId: row.competency.id,
        competencyName: row.competency.name,
        requiredLevel: row.skill.level,
      });
      continue;
    }
    const need = row.skill.level ?? 0;
    const got = have.skill.level ?? 0;
    if (need > got) {
      items.push({
        competencyId: row.competency.id,
        competencyName: row.competency.name,
        requiredLevel: row.skill.level,
      });
    }
  }
  return items;
}
