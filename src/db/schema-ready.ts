import { migrate } from "@/db/migrate";

const globalForSchema = globalThis as unknown as { schemaApplied?: boolean };

/**
 * Применяет `migrate()` один раз на процесс.
 * Признак лежит на `globalThis`: горячая замена модуля не должна гонять схему заново
 * и не должна требовать ручной счётчик версии.
 * Возвращает true, только если миграция выполнилась в этом вызове.
 */
export function applySchema(): boolean {
  if (globalForSchema.schemaApplied) return false;
  migrate();
  globalForSchema.schemaApplied = true;
  return true;
}
