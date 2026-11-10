/**
 * Даты в интерфейсе — `ДД.ММ.ГГГГ`.
 * Календарный день из базы (`ГГГГ-ММ-ДД`) не переводится в часовой пояс: это дата, не момент.
 * Секунды Unix считаются в поясе процесса, как карточка сотрудника и панель навыка.
 * Строку собирает сервер и отдаёт готовой; клиентский компонент дату из базы не форматирует.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Секунды Unix → `ДД.ММ.ГГГГ` по времени сервера. */
export function formatUnixDate(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}.${month}.${date.getFullYear()}`;
}

/** Календарная дата `ГГГГ-ММ-ДД` → `ДД.ММ.ГГГГ`. Пустая и неразборчивая строка — тире. */
export function formatIsoDate(iso: string | null | undefined): string {
  const match = ISO_DATE.exec(iso ?? "");
  if (!match) return "—";
  return `${match[3]}.${match[2]}.${match[1]}`;
}

/** Период плана: `ДД.ММ.ГГГГ — ДД.ММ.ГГГГ`. */
export function formatPeriod(start: string, end: string): string {
  return `${formatIsoDate(start)} — ${formatIsoDate(end)}`;
}
