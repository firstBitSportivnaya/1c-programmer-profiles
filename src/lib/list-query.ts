/**
 * Поиск и сортировка коротких списков в памяти.
 * `LIKE` в SQLite не складывает регистр кириллицы, поэтому сравнение — `toLocaleLowerCase("ru")`.
 */

export type ListSort = "name" | "name-desc" | "level" | "level-desc";

const SORTS = new Set<ListSort>(["name", "name-desc", "level", "level-desc"]);

export const NAME_SORTS: { value: ListSort; label: string }[] = [
  { value: "name", label: "Название А→Я" },
  { value: "name-desc", label: "Название Я→А" },
];

export const LEVEL_SORTS: { value: ListSort; label: string }[] = [
  ...NAME_SORTS,
  { value: "level", label: "Уровень по возрастанию" },
  { value: "level-desc", label: "Уровень по убыванию" },
];

/** Пустой и неизвестный параметр — сортировка по названию от А к Я. */
export function pickedSort(sort: string | undefined, allowed: readonly ListSort[]): ListSort {
  if (sort && SORTS.has(sort as ListSort) && allowed.includes(sort as ListSort)) return sort as ListSort;
  return "name";
}

/** Иголка поиска: пробелы по краям сняты, регистр кириллицы сложен. Пустая строка — фильтр выключен. */
export function queryNeedle(query: string | undefined): string {
  return (query ?? "").trim().toLocaleLowerCase("ru");
}

/** Совпадение любого поля. Пустая иголка пропускает строку. */
export function matchesText(needle: string, ...fields: string[]): boolean {
  if (!needle) return true;
  return fields.some((field) => field.toLocaleLowerCase("ru").includes(needle));
}

function byName(a: string, b: string, direction: 1 | -1): number {
  return direction * a.localeCompare(b, "ru");
}

/**
 * Сортирует копию списка. Уровень без числа всегда в конце.
 * При равном уровне порядок — по названию от А к Я.
 */
export function sortRows<T>(
  rows: T[],
  sort: ListSort,
  nameOf: (row: T) => string,
  levelOf?: (row: T) => number | null,
): T[] {
  const copy = [...rows];
  const nameDirection: 1 | -1 = sort === "name-desc" ? -1 : 1;
  const byLevel = sort === "level" || sort === "level-desc";
  copy.sort((a, b) => {
    if (byLevel && levelOf) {
      const left = levelOf(a);
      const right = levelOf(b);
      if (left == null && right != null) return 1;
      if (left != null && right == null) return -1;
      if (left != null && right != null && left !== right) {
        return sort === "level-desc" ? right - left : left - right;
      }
    }
    return byName(nameOf(a), nameOf(b), byLevel ? 1 : nameDirection);
  });
  return copy;
}
