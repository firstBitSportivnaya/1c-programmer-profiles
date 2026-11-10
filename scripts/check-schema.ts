/**
 * Паритет схемы (#139): колонки и внешние ключи Drizzle против базы после `migrate()`.
 * `scripts/upgrade-base.ts` пишет теми же таблицами Drizzle, поэтому колонка вне схемы
 * не компилируется; здесь ловится расхождение с ручным DDL.
 * Живую `data/profiles.sqlite` не открывает.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { is } from "drizzle-orm";
import { getTableConfig, type SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import * as schema from "../src/db/schema";

type Col = { name: string; notNull: boolean; dflt: string | null; pk: boolean };
type Fk = { from: string; table: string; to: string };
type Shape = { cols: Col[]; fks: Fk[] };

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function sqliteDefault(value: string | null): string | null {
  if (value == null) return null;
  const quoted = value.match(/^'(.*)'$/);
  if (!quoted) return value;
  return quoted[1].replace(/''/g, "'");
}

function columnDefault(column: SQLiteColumn): string | null {
  if (!column.hasDefault) return null;
  const value = column.default;
  if (value == null) return null;
  if (typeof value === "number" || typeof value === "boolean") return String(Number(value));
  if (typeof value === "string") return value;
  return null;
}

function drizzleShape(): Map<string, Shape> {
  const tables = new Map<string, Shape>();
  for (const value of Object.values(schema)) {
    if (!is(value, SQLiteTable)) continue;
    const config = getTableConfig(value);
    const cols = config.columns.map((column) => ({
      name: column.name,
      notNull: column.notNull,
      dflt: columnDefault(column),
      pk: column.primary,
    }));
    const fks = config.foreignKeys.flatMap((key) => {
      const ref = key.reference();
      return ref.columns.map((column, index) => ({
        from: column.name,
        table: getTableConfig(ref.foreignTable).name,
        to: ref.foreignColumns[index]?.name ?? "",
      }));
    });
    tables.set(config.name, { cols, fks });
  }
  return tables;
}

function fkKey(fk: Fk) {
  return `${fk.from}->${fk.table}.${fk.to}`;
}

/**
 * Drizzle не повторяет значения по умолчанию, которые DDL ставит только чтобы
 * дописать колонку в старую таблицу. Такое значение в базе не считается расхождением,
 * пока в схеме у колонки значения по умолчанию нет.
 */
export function diffTable(table: string, left: Shape, right: Shape): string[] {
  const problems: string[] = [];
  const leftCols = new Map(left.cols.map((col) => [col.name, col]));
  const rightCols = new Map(right.cols.map((col) => [col.name, col]));
  for (const name of leftCols.keys()) {
    if (!rightCols.has(name)) problems.push(`${table}.${name}: только в Drizzle`);
  }
  for (const name of rightCols.keys()) {
    if (!leftCols.has(name)) problems.push(`${table}.${name}: только в DDL`);
  }
  for (const [name, col] of leftCols) {
    const other = rightCols.get(name);
    if (!other) continue;
    // У PRIMARY KEY SQLite часто пишет notnull=0, хотя NULL туда не кладётся. Сравниваем notnull у остальных колонок.
    if (!col.pk && !other.pk && col.notNull !== other.notNull) {
      problems.push(`${table}.${name}: notnull не совпадает (${col.notNull} / ${other.notNull})`);
    }
    if (col.dflt != null && col.dflt !== other.dflt) {
      problems.push(`${table}.${name}: default не совпадает (${JSON.stringify(col.dflt)} / ${JSON.stringify(other.dflt)})`);
    }
  }
  const leftFk = new Set(left.fks.map(fkKey));
  const rightFk = new Set(right.fks.map(fkKey));
  for (const key of leftFk) {
    if (!rightFk.has(key)) problems.push(`${table}.${key}: внешний ключ не совпадает`);
  }
  for (const key of rightFk) {
    if (!leftFk.has(key)) problems.push(`${table}.${key}: внешний ключ не совпадает`);
  }
  return problems;
}

function selfTest() {
  const base: Shape = {
    cols: [{ name: "id", notNull: true, dflt: null, pk: false }],
    fks: [{ from: "job_id", table: "jobs", to: "id" }],
  };
  const expectHas = (problems: string[], needle: string) => {
    if (!problems.some((line) => line.includes(needle))) fail(`самопроверка не поймала: ${needle}`);
  };
  expectHas(
    diffTable("probe", { ...base, cols: [...base.cols, { name: "extra", notNull: false, dflt: null, pk: false }] }, base),
    "probe.extra: только в Drizzle",
  );
  expectHas(
    diffTable("probe", base, { ...base, cols: [...base.cols, { name: "legacy", notNull: false, dflt: null, pk: false }] }),
    "probe.legacy: только в DDL",
  );
  expectHas(
    diffTable("probe", base, { ...base, cols: [{ name: "id", notNull: false, dflt: null, pk: false }] }),
    "probe.id: notnull не совпадает",
  );
  expectHas(
    diffTable(
      "probe",
      { ...base, cols: [{ name: "id", notNull: true, dflt: "0", pk: false }] },
      { ...base, cols: [{ name: "id", notNull: true, dflt: "1", pk: false }] },
    ),
    "probe.id: default не совпадает",
  );
  expectHas(
    diffTable("probe", base, { ...base, fks: [{ from: "job_id", table: "other", to: "id" }] }),
    "внешний ключ не совпадает",
  );
  console.log("самопроверка: ok");
}

type InfoRow = { name: string; notnull: number; dflt_value: string | null; pk: number };
type FkRow = { from: string; table: string; to: string };

async function compareMigrated(): Promise<string[]> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "schema-parity-"));
  process.env.DB_PATH = path.join(dir, "parity.sqlite");
  try {
    const { migrate } = await import("../src/db/migrate");
    const { getSqlite, resetDbConnection } = await import("../src/db");
    migrate();
    const sqlite = getSqlite();
    const integrity = sqlite.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
    if (integrity.integrity_check !== "ok") fail(`integrity_check: ${integrity.integrity_check}`);
    const broken = sqlite.prepare("PRAGMA foreign_key_check").all() as unknown[];
    if (broken.length > 0) fail(`foreign_key_check: ${broken.length}`);
    const problems: string[] = [];
    let columns = 0;
    for (const [table, shape] of drizzleShape()) {
      const info = sqlite.prepare(`PRAGMA table_info(${table})`).all() as InfoRow[];
      if (info.length === 0) {
        problems.push(`${table}: только в Drizzle`);
        continue;
      }
      const fk = sqlite.prepare(`PRAGMA foreign_key_list(${table})`).all() as FkRow[];
      columns += info.length;
      problems.push(
        ...diffTable(table, shape, {
          cols: info.map((row) => ({
            name: row.name,
            notNull: row.notnull === 1,
            dflt: sqliteDefault(row.dflt_value),
            pk: row.pk > 0,
          })),
          fks: fk.map((row) => ({ from: row.from, table: row.table, to: row.to })),
        }),
      );
    }
    const declared = new Set(drizzleShape().keys());
    const existing = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];
    for (const row of existing) {
      if (!declared.has(row.name)) problems.push(`${row.name}: только в DDL`);
    }
    console.log(`таблиц: ${declared.size}, колонок: ${columns}`);
    resetDbConnection();
    return problems;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function liveStamp() {
  const file = path.join(process.cwd(), "data", "profiles.sqlite");
  if (!fs.existsSync(file)) return null;
  const stat = fs.statSync(file);
  return { size: stat.size, mtimeMs: stat.mtimeMs };
}

async function main() {
  selfTest();
  const before = liveStamp();
  const problems = await compareMigrated();
  const after = liveStamp();
  if (before && after && (before.size !== after.size || before.mtimeMs !== after.mtimeMs)) {
    fail("data/profiles.sqlite изменился");
  }
  if (problems.length > 0) {
    for (const line of problems) console.error(line);
    process.exit(1);
  }
  console.log("схема совпадает");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
