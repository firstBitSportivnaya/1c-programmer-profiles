import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/** Число строк в каждой пользовательской таблице, по имени таблицы. */
export function tableCounts(file: string): Map<string, number> {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as { name: string }[];
    const counts = new Map<string, number>();
    for (const { name } of tables) {
      const row = db.prepare(`SELECT count(*) AS n FROM "${name}"`).get() as { n: number };
      counts.set(name, row.n);
    }
    return counts;
  } finally {
    db.close();
  }
}

/**
 * Согласованная копия базы через VACUUM INTO: включает записи из *-wal, которые теряет копирование файла.
 * Источник открывается только на чтение. Существующий файл назначения не перезаписывается.
 */
export function snapshot(source: string, target: string) {
  if (!fs.existsSync(source)) throw new Error(`нет файла ${source}`);
  if (fs.existsSync(target)) throw new Error(`${target} уже есть, снимок не перезаписывает файл`);
  fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    db.prepare("VACUUM INTO ?").run(path.resolve(target));
  } finally {
    db.close();
  }
}

/** Удаляет файл базы вместе с -wal и -shm. */
export function removeDatabase(file: string) {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${file}${suffix}`, { force: true });
}
