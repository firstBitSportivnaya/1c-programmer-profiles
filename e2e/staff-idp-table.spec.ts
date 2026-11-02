import { expect, test } from "./fixtures";
import { E2E_ADMIN } from "./env";

test.describe.configure({ mode: "serial" });

// Файл работает от админа: сессия одна на воркер (см. e2e/fixtures.ts).
test.use({ asAdmin: true });

const STAFF = { login: "e2e.idp.table", name: "Таблица ИПР E2E", password: "e2e-idp-table-password" };
const GOAL = "Прочитать про запросы";
const LEARN = "Текст узнать для таблицы";
const VERIFY = "Текст проверить для таблицы";
let idpPath = "";

test("карточка ИПР показывает сотрудника, период и таблицу по компетенциям", async ({ page }) => {
  await page.goto("/people");
  const form = page.locator("form", { has: page.getByRole("heading", { name: "Новый сотрудник" }) });
  await form.getByLabel("Логин").fill(STAFF.login);
  await form.getByLabel("Имя").fill(STAFF.name);
  await form.getByLabel("Пароль").fill(STAFF.password);
  await form.getByLabel(/^Должность/).selectOption("junior");
  await form.getByLabel(/^Руководитель/).selectOption({ label: E2E_ADMIN.name });
  await form.getByRole("button", { name: "Создать" }).click();
  await expect(page.getByRole("link", { name: STAFF.name, exact: true })).toBeVisible();

  await page.goto("/idps");
  await page.getByLabel(/^Сотрудник/).selectOption({ label: STAFF.name });
  await page.getByLabel(/^Цель/).selectOption("programmer");
  await page.getByLabel("Начало").fill("2026-03-01");
  await page.getByLabel("Конец").fill("2026-09-30");
  await page.getByRole("button", { name: "Создать" }).click();
  await page.locator("li", { hasText: STAFF.name }).getByRole("link", { name: "Младший программист → Программист" }).click();

  const add = page.locator("form", { has: page.getByRole("heading", { name: "Добавить задание" }) });
  await add.getByLabel(/^Компетенция/).selectOption({ index: 1 });
  await add.getByLabel("Название (если новое)").fill(GOAL);
  await add.getByLabel("Узнать").fill(LEARN);
  await add.getByLabel("Проверить").fill(VERIFY);
  await add.getByLabel("Срок").fill("2026-06-15");
  await add.getByRole("button", { name: "Добавить" }).click();

  idpPath = new URL(page.url()).pathname;
  await expect(page.getByText(STAFF.name)).toBeVisible();
  await expect(page.getByText("2026-03-01 — 2026-09-30")).toBeVisible();
  const table = page.getByRole("table");
  await expect(table.getByRole("columnheader", { name: "Цель" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Узнать" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Проверить" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Тест" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Срок" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3 }).filter({ hasNotText: "Добавить задание" })).toHaveCount(1);

  const row = table.locator("tbody tr", { hasText: GOAL });
  await expect(row.getByRole("cell").nth(0)).toContainText(GOAL);
  await expect(row.getByRole("cell").nth(1)).toContainText(LEARN);
  await expect(row.getByRole("cell").nth(1)).not.toContainText("Программист");
  await expect(row.getByRole("cell").nth(2)).toContainText(VERIFY);
  await expect(row.getByRole("cell").nth(4).getByText("2026-06-15", { exact: true })).toBeVisible();
});

// Гость идёт без сессии: файл по умолчанию от админа, здесь это выключено.
test.describe("гость", () => {
  test.use({ asAdmin: false });

  test("гость с карточки ИПР уходит на вход", async ({ page }) => {
    await page.goto(idpPath || "/idps/missing");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("table")).toHaveCount(0);
  });
});
