import fs from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import { openSqlite, type SqliteClient } from "./sqlite";

const WRAPPER_VERSION = 3;

const globalForDb = globalThis as unknown as {
  sqliteClient?: SqliteClient;
  drizzleDb?: ReturnType<typeof drizzle<typeof schema>>;
  wrapperVersion?: number;
};

if (globalForDb.wrapperVersion !== WRAPPER_VERSION) {
  globalForDb.sqliteClient = undefined;
  globalForDb.drizzleDb = undefined;
  globalForDb.wrapperVersion = WRAPPER_VERSION;
}

function dbFile(): string {
  const rel = process.env.DB_PATH ?? "data/profiles.sqlite";
  const abs = path.isAbsolute(rel) ? rel : path.join(process.cwd(), rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  return abs;
}

function create(): ReturnType<typeof drizzle<typeof schema>> {
  const { client } = openSqlite(dbFile());
  globalForDb.sqliteClient = client;
  return drizzle(client as never, { schema });
}

export function getDb() {
  if (!globalForDb.drizzleDb) {
    globalForDb.drizzleDb = create();
  }
  return globalForDb.drizzleDb;
}

export function getSqlite() {
  if (!globalForDb.sqliteClient) {
    getDb();
  }
  return globalForDb.sqliteClient!;
}

export function now() {
  return Math.floor(Date.now() / 1000);
}
