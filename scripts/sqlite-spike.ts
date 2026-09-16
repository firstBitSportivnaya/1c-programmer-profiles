import fs from "node:fs";
import path from "node:path";
import { openSqlite } from "../src/db/sqlite";

/**
 * Spike: SQLite is Node 24 `node:sqlite` (DatabaseSync).
 * WAL + single connection + nested transactions via SAVEPOINT.
 */
const dbPath = path.join("data", "spike.sqlite");
fs.mkdirSync("data", { recursive: true });
if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

const { client } = openSqlite(dbPath);
client.exec("CREATE TABLE ping (id INTEGER PRIMARY KEY, note TEXT)");
client.transaction(() => {
  client.prepare("INSERT INTO ping (note) VALUES (?)").run("outer");
  client.transaction(() => {
    client.prepare("INSERT INTO ping (note) VALUES (?)").run("inner");
    return true;
  }).deferred(null);
  return true;
}).deferred(null);

let innerRolled = false;
client.transaction(() => {
  client.prepare("INSERT INTO ping (note) VALUES (?)").run("keep");
  try {
    client.transaction(() => {
      client.prepare("INSERT INTO ping (note) VALUES (?)").run("drop");
      throw new Error("nested-fail");
    }).deferred(null);
  } catch {
    innerRolled = true;
  }
  return true;
}).deferred(null);

const notes = client.prepare("SELECT note FROM ping ORDER BY id").all() as { note: string }[];
const wal = client.prepare("PRAGMA journal_mode").get() as { journal_mode?: string };
const walFile = fs.existsSync(dbPath + "-wal");
console.log(
  JSON.stringify({
    journal_mode: wal?.journal_mode ?? wal,
    notes: notes.map((r) => r.note),
    innerRolled,
    walFile,
    driver: "node:sqlite",
  }),
);
