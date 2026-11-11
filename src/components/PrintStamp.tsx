import { formatUnixDate } from "@/lib/dates";

/** Дата печати собирается на сервере: в браузере часовой пояс дал бы другой день. */
export function PrintStamp() {
  const on = formatUnixDate(Math.floor(Date.now() / 1000));
  return (
    <p className="print-only">
      Дата печати: {on}. версия на {on}
    </p>
  );
}
