/**
 * ADR 0011: навык с действующим ручным подтверждением в группу не превращается.
 *
 * Группа — компетенция с дочерними элементами. Подтвердить группу как навык нельзя, поэтому
 * пока подтверждение не отозвано, `assertCompetencyTree` не даёт добавить ей ребёнка: иначе
 * группа осталась бы в общем расчёте и поддерживала пороги достижений. Строку подтверждения
 * кладёт сам тест в базу воркера: здесь проверяется правило дерева, а не форма карточки.
 */
import { DatabaseSync } from "node:sqlite";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { workerDbPath } from "./env";

test.describe.configure({ mode: "serial" });

test.use({ asAdmin: true });

const STAMP = Date.now();
const SKILL = { id: `e2etree${STAMP}`, name: `Корневой навык ${STAMP}` };
const CHILD = { id: `e2etreechild${STAMP}`, name: `Дочерняя компетенция ${STAMP}` };
const MESSAGE = "Нельзя добавить дочернюю компетенцию: навык подтверждён";

/** Что нужно от хука или теста: номер воркера, а не весь `TestInfo`. */
type Worker = { parallelIndex: number };

/** База воркера этого теста: у каждого воркера своя, см. `e2e/env.ts`. */
function dbFile(testInfo: Worker) {
  return workerDbPath(testInfo.parallelIndex);
}

/** Сотрудник для подтверждения: в базе воркера до теста заведён только админ. */
function adminId(testInfo: Worker) {
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
function confirm(testInfo: Worker, employee: string) {
  const db = new DatabaseSync(dbFile(testInfo));
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    db.prepare(
      `INSERT INTO employee_competency_confirmations
         (employee_id, competency_id, competency_name, note, confirmed_at, confirmed_by_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(employee, SKILL.id, SKILL.name, "Проект на проде", Date.now(), employee);
  } finally {
    db.close();
  }
}

/** Отзыв оставляет строку в базе: история подтверждения сохраняется. */
function revoke(testInfo: Worker, employee: string) {
  const db = new DatabaseSync(dbFile(testInfo));
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    db.prepare(
      `UPDATE employee_competency_confirmations
       SET revoked_at = ?, revoked_by_id = ?, revoke_reason = ?
       WHERE employee_id = ? AND competency_id = ?`,
    ).run(Date.now(), employee, "Подтвердили по ошибке", employee, SKILL.id);
  } finally {
    db.close();
  }
}

/** Сколько детей заведено у корневого навыка. */
function childCount(testInfo: Worker) {
  const db = new DatabaseSync(dbFile(testInfo), { readOnly: true });
  try {
    const row = db
      .prepare("SELECT COUNT(*) AS n FROM competencies WHERE parent_id = ?")
      .get(SKILL.id) as { n: number };
    return row.n;
  } finally {
    db.close();
  }
}

/**
 * Убирает за собой созданное: базу воркера делят все файлы, которые он выполняет по очереди.
 * Ребёнок остаётся навыком дерева, и следующая спецификация увидит на один узел больше, чем в seed.
 * Порядок важен: подтверждение и ребёнок ссылаются на корневой навык.
 *
 * Берутся все компетенции с нашим префиксом, а не только id этого прогона: если прогон упал
 * на упавшем браузере, `afterAll` мог не выполниться, и строки от прошлого запуска остались.
 */
function removeCreated(testInfo: Worker) {
  const db = new DatabaseSync(dbFile(testInfo));
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    const ours = "SELECT id FROM competencies WHERE id LIKE 'e2etree%'";
    db.prepare(`DELETE FROM employee_competency_confirmations WHERE competency_id IN (${ours})`).run();
    // Дети ссылаются на корень, поэтому удаляются первыми.
    db.prepare("DELETE FROM competencies WHERE parent_id IN (SELECT id FROM competencies WHERE id LIKE 'e2etree%')").run();
    db.prepare("DELETE FROM competencies WHERE id LIKE 'e2etree%'").run();
  } finally {
    db.close();
  }
}

/**
 * Чистка до теста и после него. `afterAll` выполняется и после упавшей проверки, но не после
 * аварийного завершения воркера: тогда мусор убирает следующий запуск этого файла.
 */
test.beforeAll(async ({}, testInfo) => {
  removeCreated(testInfo);
});

test.afterAll(async ({}, testInfo) => {
  removeCreated(testInfo);
});


/** Заводит корневой навык без детей и профиля: в группу его превращает только форма ребёнка. */
async function createSkill(page: Page) {
  await page.goto("/admin/competencies/new");
  const form = page.locator("form", { has: page.getByRole("button", { name: "Создать" }) });
  await form.getByLabel("Идентификатор").fill(SKILL.id);
  await form.getByLabel("Название", { exact: true }).fill(SKILL.name);
  await form.getByRole("button", { name: "Создать" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/competencies/${SKILL.id}$`));
}

/**
 * Отправляет форму новой компетенции с родителем-навыком. Список родителей держит `<select>`
 * внутри `<label>`, поэтому в подпись попадают названия вариантов: ищем по началу подписи.
 */
async function submitChild(page: Page) {
  await page.goto("/admin/competencies/new");
  const form = page.locator("form", { has: page.getByRole("button", { name: "Создать" }) });
  const parent = form.getByLabel(/^Родитель/);
  await expect(parent.locator("option", { hasText: SKILL.name }), "навык есть в списке родителей").toHaveCount(1);
  await form.getByLabel("Идентификатор").fill(CHILD.id);
  await form.getByLabel("Название", { exact: true }).fill(CHILD.name);
  await parent.selectOption(SKILL.id);
  await form.getByRole("button", { name: "Создать" }).click();
  return form;
}

test("корневой навык: действующее подтверждение не даёт завести ребёнка, после отзыва ребёнок создаётся", async ({
  page,
}, testInfo) => {
  await createSkill(page);
  const employee = adminId(testInfo);
  expect(employee).not.toBe("");
  confirm(testInfo, employee);

  const form = await submitChild(page);
  await expect(form.locator(".form-error"), "сервер отказал в превращении навыка в группу").toHaveText(MESSAGE);
  await expect(page).toHaveURL(/\/admin\/competencies\/new$/);
  expect(childCount(testInfo), "ребёнок не записан").toBe(0);

  revoke(testInfo, employee);
  await submitChild(page);
  await expect(page).toHaveURL(new RegExp(`/admin/competencies/${CHILD.id}$`));
  expect(childCount(testInfo), "после отзыва ребёнок записан").toBe(1);
});
