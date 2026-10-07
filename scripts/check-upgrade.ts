/**
 * Проверка обновления (docs/workflow.md, G4): база старой версии открывается кодом этой ветки.
 *
 *   npm run check:upgrade -- <база main>
 *
 * Работает на снимке во временной папке, исходный файл не меняет. Запускает migrate() ветки,
 * затем integrity_check и foreign_key_check, и сравнивает число строк до и после.
 * Падает, если таблица пропала или в ней стало меньше строк.
 */
import os from "node:os";
import path from "node:path";
import { getSqlite, resetDbConnection } from "../src/db";
import { migrate } from "../src/db/migrate";
import { removeDatabase, snapshot, tableCounts } from "./lib/sqlite-tools";

/**
 * Таблицы, в которых pull request сознательно теряет строки (например, пересоздаёт таблицу).
 * Заполнять только вместе с таким изменением и очищать следующим pull request.
 */
const ALLOWED_LOSS = new Set<string>([]);

function main() {
  const source = process.argv[2];
  if (!source) {
    console.error("usage: npm run check:upgrade -- <база main>");
    process.exit(1);
  }
  const copy = path.join(os.tmpdir(), `check-upgrade-${process.pid}-${Date.now()}.sqlite`);
  const errors: string[] = [];
  try {
    snapshot(source, copy);
    const before = tableCounts(copy);

    process.env.DB_PATH = copy;
    migrate();
    const integrity = getSqlite().prepare("PRAGMA integrity_check").all() as { integrity_check: string }[];
    if (integrity.length !== 1 || integrity[0].integrity_check !== "ok") {
      errors.push(`integrity_check: ${integrity.map((r) => r.integrity_check).join("; ")}`);
    }
    const foreignKeys = getSqlite().prepare("PRAGMA foreign_key_check").all() as { table: string; parent: string }[];
    for (const fk of foreignKeys) errors.push(`foreign_key_check: ${fk.table} ссылается на несуществующую строку ${fk.parent}`);
    resetDbConnection();

    const after = tableCounts(copy);
    console.log("таблица до после");
    for (const table of new Set([...before.keys(), ...after.keys()])) {
      const was = before.get(table);
      const now = after.get(table);
      console.log(`  ${table} ${was ?? "—"} ${now ?? "—"}`);
      if (was === undefined || ALLOWED_LOSS.has(table)) continue;
      if (now === undefined) errors.push(`${table}: таблица пропала`);
      else if (now < was) errors.push(`${table}: строк было ${was}, стало ${now}`);
    }
  } catch (error) {
    errors.push(error instanceof Error ? (error.stack ?? error.message) : String(error));
  } finally {
    resetDbConnection();
    removeDatabase(copy);
  }

  if (errors.length > 0) {
    console.error(`upgrade: ${errors.length} нарушений`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log("upgrade ok");
}

main();
