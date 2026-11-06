/**
 * ADR 0011: компетенцию с действующим ручным подтверждением удалить нельзя, отозванное
 * подтверждение удалению не мешает и уходит вместе с компетенцией.
 *
 * Строку в базу воркера кладёт сам тест: здесь проверяются правило удаления и миграция схемы,
 * а не интерфейс подтверждения — он проверяется в `staff-competency-confirmation.spec.ts`.
 */
import { DatabaseSync } from "node:sqlite";
import type { Page, TestInfo } from "@playwright/test";
import { expect, test } from "./fixtures";
import { workerDbPath } from "./env";

test.describe.configure({ mode: "serial" });

const STAMP = Date.now();
const COMPETENCY = { id: `e2econfirm${STAMP}`, name: `Подтверждённая компетенция ${STAMP}` };
const MESSAGE = "Нельзя удалить компетенцию: есть ручные подтверждения";

/** База воркера этого теста: у каждого воркера своя, см. `e2e/env.ts`. */
function dbFile(testInfo: TestInfo) {
  return workerDbPath(testInfo.parallelIndex);
}

/** Сотрудник для подтверждения: в базе воркера до теста заведён только админ. */
function employeeId(testInfo: TestInfo) {
  const db = new DatabaseSync(dbFile(testInfo), { readOnly: true });
  try {
    const row = db.prepare("SELECT id FROM employees WHERE is_admin = 1 ORDER BY login LIMIT 1").get() as
      | { id: string }
      | undefined;
    return row?.id ?? "";
  } finally {
    db.close();
  }
}

/** Действующее подтверждение даёт тот же админ: права проверяет не этот тест. */
function confirm(testInfo: TestInfo, employee: string) {
  const db = new DatabaseSync(dbFile(testInfo));
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    db.prepare(
      `INSERT INTO employee_competency_confirmations
         (employee_id, competency_id, competency_name, note, confirmed_at, confirmed_by_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(employee, COMPETENCY.id, COMPETENCY.name, "Проект на проде", Date.now(), employee);
  } finally {
    db.close();
  }
}

/** Отзыв оставляет строку в базе: история подтверждения сохраняется. */
function revoke(testInfo: TestInfo, employee: string) {
  const db = new DatabaseSync(dbFile(testInfo));
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    db.prepare(
      `UPDATE employee_competency_confirmations
       SET revoked_at = ?, revoked_by_id = ?, revoke_reason = ?
       WHERE employee_id = ? AND competency_id = ?`,
    ).run(Date.now(), employee, "Подтвердили по ошибке", employee, COMPETENCY.id);
  } finally {
    db.close();
  }
}

/** Сколько строк осталось у компетенции: удаление уносит и отозванные записи. */
function confirmationCount(testInfo: TestInfo) {
  const db = new DatabaseSync(dbFile(testInfo), { readOnly: true });
  try {
    const row = db
      .prepare("SELECT COUNT(*) AS n FROM employee_competency_confirmations WHERE competency_id = ?")
      .get(COMPETENCY.id) as { n: number };
    return row.n;
  } finally {
    db.close();
  }
}

/** Форма удаления на странице компетенции: ошибка действия показывается внутри неё. */
function deleteForm(page: Page) {
  return page.locator("form", { has: page.getByRole("button", { name: "Удалить", exact: true }) });
}

/** Заводит компетенцию-навык без профиля, детей и заданий: удалить её мешает только подтверждение. */
async function createCompetency(page: Page) {
  await page.goto("/admin/competencies/new");
  const form = page.locator("form", { has: page.getByRole("button", { name: "Создать" }) });
  await form.getByLabel("Идентификатор").fill(COMPETENCY.id);
  await form.getByLabel("Название", { exact: true }).fill(COMPETENCY.name);
  await form.getByRole("button", { name: "Создать" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/competencies/${COMPETENCY.id}$`));
}

test.use({ asAdmin: true });

test("удаление компетенции: действующее подтверждение блокирует, отозванное уходит с ней", async ({
  page,
}, testInfo) => {
  await createCompetency(page);
  const employee = employeeId(testInfo);
  expect(employee).not.toBe("");
  confirm(testInfo, employee);

  await deleteForm(page).getByRole("button", { name: "Удалить", exact: true }).click();
  await expect(deleteForm(page).locator(".form-error")).toHaveText(MESSAGE);
  await expect(page).toHaveURL(new RegExp(`/admin/competencies/${COMPETENCY.id}$`));
  expect(confirmationCount(testInfo)).toBe(1);

  revoke(testInfo, employee);
  await deleteForm(page).getByRole("button", { name: "Удалить", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/competencies$/);
  await expect(page.getByRole("link", { name: COMPETENCY.name, exact: true })).toHaveCount(0);
  expect(confirmationCount(testInfo)).toBe(0);
});
