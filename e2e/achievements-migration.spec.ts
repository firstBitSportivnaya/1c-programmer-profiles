/**
 * Перенос прежних вычисляемых достижений в выдачи (ADR 0010, issue #116).
 *
 * Экранных шагов у миграции нет, поэтому базу «до таблиц достижений» собирает fixture
 * `e2e/legacy-achievements.ts`, а проверки читают файл напрямую: так видно, что именно записала миграция.
 * Файл теста один: у каждого теста своя база в tmp/, правки одного не влияют на другой.
 */
import { execSync } from "node:child_process";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "@playwright/test";
import { ACHIEVEMENT_CATALOG_SIZE } from "../src/lib/achievement-catalog";
import { removeDatabase } from "../scripts/lib/sqlite-tools";

const EMPLOYEE = "emp-legacy";

function dbPath(testId: string) {
  return path.join("tmp", `legacy-achievements-${testId}.sqlite`);
}

/** Собирает базу из main и запускает migrate() ветки; `--migrate` — только migrate() на готовой базе. */
function runFixture(file: string, migrateOnly = false) {
  const command = `npx tsx e2e/legacy-achievements.ts "${file}"${migrateOnly ? " --migrate" : ""}`;
  try {
    execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    throw new Error(`fixture упал: ${command}\n${failure.stdout ?? ""}${failure.stderr ?? ""}`);
  }
}

type Grant = {
  achievement_id: string;
  source: string;
  rule_key: string | null;
  source_ref: string | null;
  granted_at: number | null;
  granted_by_id: string | null;
  revoked_at: number | null;
};

/**
 * Выдачи сотрудника из fixture. Правила ждут трёх переносимых достижений: у каждого свой план
 * в `source_ref`, а подтверждение конкретной компетенции в каталог не попадает.
 */
function legacyGrants(file: string): Grant[] {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return db
      .prepare(
        `SELECT achievement_id, source, rule_key, source_ref, granted_at, granted_by_id, revoked_at
         FROM employee_achievements WHERE employee_id = ? ORDER BY achievement_id`,
      )
      .all(EMPLOYEE) as Grant[];
  } finally {
    db.close();
  }
}

/** Каталог после миграции: ключ и название каждой записи, чтобы видеть правку админа. */
function catalog(file: string): { id: string; title: string }[] {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return db.prepare("SELECT id, title FROM achievements ORDER BY id").all() as { id: string; title: string }[];
  } finally {
    db.close();
  }
}

test("перенос: три вычисляемых достижения стали выдачами с правилом и планом", async ({}, testInfo) => {
  const file = dbPath(testInfo.testId);
  try {
    runFixture(file);

    const grants = legacyGrants(file);
    expect(grants.map((row) => row.achievement_id)).toEqual(["idp-completed", "idp-first-step", "idp-pool-closed"]);
    const expected = new Map([
      ["idp-first-step", { rule: "idp.first-accepted-item", ref: "idp-legacy-active" }],
      ["idp-pool-closed", { rule: "idp.pool-confirmed", ref: "idp-legacy-active" }],
      ["idp-completed", { rule: "idp.completed", ref: "idp-legacy-done" }],
    ]);
    for (const row of grants) {
      const want = expected.get(row.achievement_id)!;
      expect(row.source, `у ${row.achievement_id} источник автоматический`).toBe("auto");
      expect(row.rule_key, `у ${row.achievement_id} записано правило`).toBe(want.rule);
      expect(row.source_ref, `у ${row.achievement_id} записан план`).toBe(want.ref);
      expect(row.granted_at, `у ${row.achievement_id} записана дата выдачи`).toBeGreaterThan(0);
      expect(row.granted_by_id, `у ${row.achievement_id} нет автора-человека`).toBeNull();
      expect(row.revoked_at, `${row.achievement_id} не отозвано`).toBeNull();
    }

    // Подтверждение компетенции — блок страницы, а не достижение: выдачи по нему нет.
    expect(grants.some((row) => row.achievement_id === "idp-competency-confirmed")).toBe(false);
    expect(catalog(file)).toHaveLength(ACHIEVEMENT_CATALOG_SIZE);
  } finally {
    removeDatabase(file);
  }
});

test("повторное заполнение каталога сохраняет название, которое правил админ", async ({}, testInfo) => {
  const file = dbPath(testInfo.testId);
  try {
    runFixture(file);

    const db = new DatabaseSync(file);
    try {
      db.prepare("UPDATE achievements SET title = ? WHERE id = ?").run("Первый шаг (название отдела)", "idp-first-step");
      db.prepare("UPDATE employee_achievements SET revoked_at = ? WHERE achievement_id = ?").run(1500, "idp-first-step");
    } finally {
      db.close();
    }
    runFixture(file, true);

    const rows = catalog(file);
    expect(rows).toHaveLength(ACHIEVEMENT_CATALOG_SIZE);
    expect(new Set(rows.map((row) => row.id)).size, "ключи каталога без дублей").toBe(rows.length);
    expect(rows.find((row) => row.id === "idp-first-step")?.title).toBe("Первый шаг (название отдела)");
    // Повторный запуск не выдаёт достижения заново и не оживляет отозванное человеком.
    const grants = legacyGrants(file);
    expect(grants).toHaveLength(3);
    expect(grants.find((row) => row.achievement_id === "idp-first-step")?.revoked_at, "отзыв остался").toBe(1500);
  } finally {
    removeDatabase(file);
  }
});

test("негативный: повтор пары и несуществующее достижение в выдачу не попадают", async ({}, testInfo) => {
  const file = dbPath(testInfo.testId);
  try {
    runFixture(file);

    const db = new DatabaseSync(file, { enableForeignKeyConstraints: true });
    try {
      expect(
        () =>
          db
            .prepare(
              `INSERT INTO employee_achievements
                 (employee_id, achievement_id, source, rule_key, source_ref, granted_at)
               VALUES (?, 'idp-first-step', 'manual', 'manual', NULL, 2000)`,
            )
            .run(EMPLOYEE),
        "повторная пара «сотрудник × достижение» отклоняется",
      ).toThrow(/unique constraint/i);
      expect(
        () =>
          db
            .prepare(
              `INSERT INTO employee_achievements
                 (employee_id, achievement_id, source, rule_key, source_ref, granted_at)
               VALUES (?, 'net-takogo-dostizheniya', 'manual', 'manual', NULL, 2000)`,
            )
            .run(EMPLOYEE),
        "выдача с несуществующим достижением отклоняется",
      ).toThrow(/foreign key constraint/i);
      const left = db.prepare("SELECT COUNT(*) AS n FROM employee_achievements").get() as { n: number };
      expect(left.n, "в базе остались только перенесённые выдачи").toBe(3);
    } finally {
      db.close();
    }
  } finally {
    removeDatabase(file);
  }
});
