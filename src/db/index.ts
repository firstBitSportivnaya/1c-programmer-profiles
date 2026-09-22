import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import { openSqlite, type SqliteClient } from "./sqlite";

const WRAPPER_VERSION = 5;

const globalForDb = globalThis as unknown as {
  sqliteClient?: SqliteClient;
  sqliteRaw?: DatabaseSync;
  drizzleDb?: ReturnType<typeof drizzle<typeof schema>>;
  wrapperVersion?: number;
};

function dbFile(): string {
  const rel = process.env.DB_PATH ?? "data/profiles.sqlite";
  const abs = path.isAbsolute(rel) ? rel : path.join(process.cwd(), rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  return abs;
}

function create(): ReturnType<typeof drizzle<typeof schema>> {
  const { raw, client } = openSqlite(dbFile());
  globalForDb.sqliteRaw = raw;
  globalForDb.sqliteClient = client;
  return drizzle(client as never, { schema });
}

export function isSqliteClosedError(error: unknown) {
  return error instanceof Error && /connection closed/i.test(error.message);
}

export function resetDbConnection() {
  const raw = globalForDb.sqliteRaw;
  globalForDb.sqliteRaw = undefined;
  globalForDb.sqliteClient = undefined;
  globalForDb.drizzleDb = undefined;
  try {
    if (raw?.isOpen) raw.close();
  } catch {
    /* already gone after HMR */
  }
}

if (globalForDb.wrapperVersion !== WRAPPER_VERSION) {
  resetDbConnection();
  globalForDb.wrapperVersion = WRAPPER_VERSION;
}

export function getDb() {
  if (globalForDb.sqliteRaw && globalForDb.sqliteRaw.isOpen === false) {
    resetDbConnection();
  }
  if (!globalForDb.drizzleDb) {
    globalForDb.drizzleDb = create();
  }
  return globalForDb.drizzleDb;
}

export function getSqlite() {
  if (!globalForDb.sqliteClient || (globalForDb.sqliteRaw && globalForDb.sqliteRaw.isOpen === false)) {
    getDb();
  }
  return globalForDb.sqliteClient!;
}

export function now() {
  return Math.floor(Date.now() / 1000);
}
