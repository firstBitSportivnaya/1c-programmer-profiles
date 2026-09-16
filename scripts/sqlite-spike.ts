import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

/**
 * Spike: better-sqlite3 failed on this Windows host (no VS C++ toolchain,
 * npm ignored install scripts, GitHub prebuild 404/502).
 * Node 24 `node:sqlite` (DatabaseSync) is the local SQLite driver.
 * WAL + single connection + serialized transactions still apply.
 */
const dbPath = path.join("data", "spike.sqlite");
fs.mkdirSync("data", { recursive: true });
if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

const db = new DatabaseSync(dbPath, { enableForeignKeyConstraints: true });
const wal = db.prepare("PRAGMA journal_mode = WAL").get() as { journal_mode?: string };
db.exec("CREATE TABLE ping (id INTEGER PRIMARY KEY, note TEXT)");
db.exec("BEGIN");
db.prepare("INSERT INTO ping (note) VALUES (?)").run("ok");
db.exec("COMMIT");
const row = db.prepare("SELECT note FROM ping").get() as { note: string };
db.close();

const walFile = fs.existsSync(dbPath + "-wal");
console.log(JSON.stringify({ journal_mode: wal?.journal_mode ?? wal, row, walFile, driver: "node:sqlite" }));
