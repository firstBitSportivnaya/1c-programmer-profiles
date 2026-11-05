import { DatabaseSync } from "node:sqlite";

export type RunResult = { changes: number; lastInsertRowid: number | bigint };

export type Stmt = {
  run: (...params: unknown[]) => RunResult;
  all: (...params: unknown[]) => unknown[];
  get: (...params: unknown[]) => unknown;
  values: (...params: unknown[]) => unknown[][];
  raw: (toggleState?: boolean) => Stmt;
};

export type SqliteClient = {
  prepare: (sql: string) => Stmt;
  exec: (sql: string) => void;
  transaction: (fn: (tx: unknown) => unknown) => {
    deferred: (tx: unknown) => unknown;
    immediate: (tx: unknown) => unknown;
    exclusive: (tx: unknown) => unknown;
  };
};

function wrapStatement(stmt: ReturnType<DatabaseSync["prepare"]>): Stmt {
  const wrapped: Stmt = {
    run(...params: unknown[]) {
      const info = stmt.run(...(params as never[]));
      return {
        changes: Number(info.changes),
        lastInsertRowid: info.lastInsertRowid,
      };
    },
    all(...params: unknown[]) {
      return stmt.all(...(params as never[])) as unknown[];
    },
    get(...params: unknown[]) {
      return stmt.get(...(params as never[]));
    },
    values(...params: unknown[]) {
      stmt.setReturnArrays(true);
      const rows = stmt.all(...(params as never[])) as unknown as unknown[][];
      return rows;
    },
    raw(toggleState?: boolean) {
      stmt.setReturnArrays(toggleState !== false);
      return wrapped;
    },
  };
  return wrapped;
}

export function openSqlite(filePath: string): { raw: DatabaseSync; client: SqliteClient } {
  const raw = new DatabaseSync(filePath, { enableForeignKeyConstraints: true });
  raw.exec("PRAGMA journal_mode = WAL");
  raw.exec("PRAGMA foreign_keys = ON");
  // Второй процесс на той же базе (обновление на живом сервере, скрипт рядом с приложением) ждёт
  // до 5 секунд, а не получает `SQLITE_BUSY` на первой же записи.
  raw.exec("PRAGMA busy_timeout = 5000");
  let txDepth = 0;
  const client: SqliteClient = {
    prepare(sql: string) {
      return wrapStatement(raw.prepare(sql));
    },
    exec(sql: string) {
      raw.exec(sql);
    },
    transaction(fn) {
      const run = (kind: "deferred" | "immediate" | "exclusive") => (tx: unknown) => {
        const nested = txDepth > 0;
        const sp = `sp_${txDepth}`;
        // `BEGIN` берёт блокировку на первой записи, `IMMEDIATE` — сразу: чтение внутри такой
        // транзакции видит уже зафиксированное состояние соседнего процесса.
        if (nested) raw.exec(`SAVEPOINT ${sp}`);
        else raw.exec(kind === "deferred" ? "BEGIN" : `BEGIN ${kind.toUpperCase()}`);
        txDepth += 1;
        try {
          const result = fn(tx);
          txDepth -= 1;
          if (nested) raw.exec(`RELEASE ${sp}`);
          else raw.exec("COMMIT");
          return result;
        } catch (error) {
          txDepth -= 1;
          if (nested) {
            raw.exec(`ROLLBACK TO ${sp}`);
            raw.exec(`RELEASE ${sp}`);
          } else {
            raw.exec("ROLLBACK");
          }
          throw error;
        }
      };
      return { deferred: run("deferred"), immediate: run("immediate"), exclusive: run("exclusive") };
    },
  };
  return { raw, client };
}
