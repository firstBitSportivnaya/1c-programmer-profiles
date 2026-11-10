/**
 * Проверка #138 без HTTP: пустая база получает таблицы до запроса,
 * повторный вызов не падает, недоступный путь отклоняется.
 * Живую `data/profiles.sqlite` не открывает.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const mode = process.argv[2] ?? "all";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function applyOn(dbPath: string) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.rmSync(dbPath, { force: true });
  fs.rmSync(`${dbPath}-wal`, { force: true });
  fs.rmSync(`${dbPath}-shm`, { force: true });
  process.env.DB_PATH = dbPath;
  const { applySchema } = await import("../src/db/schema-ready");
  const { getSqlite } = await import("../src/db");
  if (!applySchema()) fail("первая миграция не выполнилась");
  if (applySchema()) fail("повторная миграция не должна выполняться");
  const names = new Set(
    (
      getSqlite()
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as { name: string }[]
    ).map((row) => row.name),
  );
  for (const name of ["jobs", "employees", "achievements", "idp_items"]) {
    if (!names.has(name)) fail(`нет таблицы ${name}`);
  }
  console.log(`таблиц: ${names.size}`);
  console.log("повтор: ok");
}

function rejectBadPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "schema-bad-"));
  const blocker = path.join(dir, "not-a-directory");
  fs.writeFileSync(blocker, "x");
  const dbPath = path.join(blocker, "profiles.sqlite");
  const child = spawnSync(`npx tsx scripts/check-startup-schema.ts bad "${dbPath}"`, {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: true,
  });
  fs.rmSync(dir, { recursive: true, force: true });
  const output = `${child.stdout ?? ""}\n${child.stderr ?? ""}`;
  if (child.status === 0 || child.status == null) {
    fail(`недоступный путь не отклонён (${child.status}): ${child.error?.message ?? ""}\n${output}`);
  }
  if (!/EEXIST|ENOTDIR|Error/i.test(output)) fail(`недоступный путь завершился без ошибки открытия\n${output}`);
  console.log("недоступный путь: отклонён");
}

async function bad(dbPath: string) {
  process.env.DB_PATH = dbPath;
  const { applySchema } = await import("../src/db/schema-ready");
  applySchema();
  fail("ожидалась ошибка открытия базы");
}

async function main() {
  if (mode === "bad") {
    const dbPath = process.argv[3];
    if (!dbPath) fail("нет пути");
    await bad(dbPath);
    return;
  }
  if (mode !== "all") fail(`неизвестный режим ${mode}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "schema-ok-"));
  try {
    await applyOn(path.join(dir, "empty.sqlite"));
    rejectBadPath();
  } finally {
    const { resetDbConnection } = await import("../src/db");
    resetDbConnection();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
