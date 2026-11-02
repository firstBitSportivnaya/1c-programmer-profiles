/**
 * Запускается перед тестовым сервером: удаляет прошлую базу воркера, seed загружает её заново.
 * Путь к базе — первый аргумент: у каждого сервера своя, иначе параллельные прогоны делят данные.
 */
import { removeDatabase } from "../scripts/lib/sqlite-tools";

const dbPath = process.argv[2];
if (!dbPath) {
  console.error("Нужен путь к базе: npx tsx e2e/prepare-db.ts tmp/e2e-1.sqlite");
  process.exit(1);
}
removeDatabase(dbPath);
