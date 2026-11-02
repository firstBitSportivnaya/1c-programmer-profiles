/**
 * Запускается перед тестовым сервером: удаляет прошлую базу воркера, seed загружает её заново.
 * Путь к базе — первый аргумент: у каждого сервера своя, иначе параллельные прогоны делят данные.
 * Путь приходит извне и уходит в удаление файла вместе с `-wal` и `-shm`, поэтому разрешена только `tmp/`.
 */
import path from "node:path";
import { removeDatabase } from "../scripts/lib/sqlite-tools";

const dbPath = process.argv[2];
if (!dbPath) {
  console.error("Нужен путь к базе: npx tsx e2e/prepare-db.ts tmp/e2e-1.sqlite");
  process.exit(1);
}
const fromTmp = path.relative(path.resolve("tmp"), path.resolve(dbPath));
if (fromTmp === "" || fromTmp.startsWith("..") || path.isAbsolute(fromTmp)) {
  console.error(`Путь к базе должен лежать в tmp/: ${dbPath}`);
  process.exit(1);
}
removeDatabase(dbPath);
