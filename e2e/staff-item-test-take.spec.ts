import type { Page } from "@playwright/test";
import { expect, login, test } from "./fixtures";

test.describe.configure({ mode: "serial" });

// Файл работает от админа: сессия одна на воркер (см. e2e/fixtures.ts).
test.use({ asAdmin: true });

const STAMP = Date.now();
const NAME = `Сдача ${STAMP}`;
const PROMPT = `Вопрос сдачи ${STAMP}`;
const RIGHT = `Верно ${STAMP}`;
const WRONG = `Неверно ${STAMP}`;
const STAFF = { login: `e2e.take.${STAMP}`, name: `Сдаёт ${STAMP}`, password: "e2e-take-password" };
const OTHER = { login: `e2e.take.other.${STAMP}`, name: `Чужой ${STAMP}`, password: "e2e-take-other-password" };
let idpPath = "";
let takePath = "";

async function createPerson(page: Page, account: { login: string; name: string; password: string }) {
  await page.goto("/people");
  const form = page.locator("form", { has: page.getByRole("heading", { name: "Новый сотрудник" }) });
  await form.getByLabel("Логин").fill(account.login);
  await form.getByLabel("Имя").fill(account.name);
  await form.getByLabel("Пароль").fill(account.password);
  await form.getByLabel(/^Должность/).selectOption("junior");
  await form.getByRole("button", { name: "Создать" }).click();
  await expect(page.getByRole("link", { name: account.name, exact: true })).toBeVisible();
}

test("верный ответ показывает «сдан», строка не принята", async ({ page }) => {
  await createPerson(page, STAFF);
  await createPerson(page, OTHER);
  await page.goto("/idps");
  await page.getByLabel(/^Сотрудник/).selectOption({ label: STAFF.name });
  await page.getByLabel(/^Цель/).selectOption("programmer");
  await page.getByLabel("Начало").fill("2026-03-01");
  await page.getByLabel("Конец").fill("2026-09-30");
  await page.getByRole("button", { name: "Создать" }).click();
  await page.locator("li", { hasText: STAFF.name }).getByRole("link", { name: "Младший программист → Программист" }).click();
  idpPath = new URL(page.url()).pathname;

  const add = page.locator("form", { has: page.getByRole("heading", { name: "Добавить задание" }) });
  const competencyLabel = await add.getByLabel(/^Компетенция/).locator("option").nth(0).innerText();
  const competency = competencyLabel.replace(/\s·\sур\.\s\d+$/, "");
  await page.goto("/assignments/new");
  const create = page.locator("form").filter({ has: page.getByRole("button", { name: "Создать" }) });
  await create.getByLabel(/^Компетенция/).selectOption({ label: competency });
  await create.getByLabel(/^Название/).fill(NAME);
  await create.getByLabel(/^Узнать/).fill("Узнать сдачу");
  await create.getByLabel(/^Проверить/).fill("Проверить сдачу");
  await create.getByRole("button", { name: "Создать" }).click();
  const testForm = page.locator("form", { has: page.getByRole("button", { name: "Сохранить тест" }) });
  await expect(async () => {
    await testForm.getByRole("button", { name: "Добавить вопрос" }).click();
    await expect(testForm.getByLabel("Вопрос")).toBeVisible({ timeout: 1000 });
  }).toPass();
  await testForm.getByLabel("Вопрос").fill(PROMPT);
  await testForm.getByLabel("Вариант").nth(0).fill(RIGHT);
  await testForm.getByLabel("Вариант").nth(1).fill(WRONG);
  await testForm.getByRole("checkbox", { name: /^Верный/ }).nth(0).check({ force: true });
  const saved = page.waitForResponse((response) => response.request().method() === "POST");
  await testForm.getByRole("button", { name: "Сохранить тест" }).click();
  await saved;

  await page.goto(idpPath);
  const addAgain = page.locator("form", { has: page.getByRole("heading", { name: "Добавить задание" }) });
  const catalog = addAgain.getByLabel(/^Из справочника/);
  await catalog.selectOption({ value: (await catalog.locator("option", { hasText: NAME }).getAttribute("value")) ?? "" });
  await addAgain.getByRole("button", { name: "Добавить" }).click();
  await addAgain.getByLabel(/^Компетенция/).selectOption({ label: competencyLabel });
  await addAgain.getByLabel("Название (если новое)").fill(`Держит план ${STAMP}`);
  await addAgain.getByLabel("Узнать").fill("Второе");
  await addAgain.getByLabel(/^Проверить/).fill("Второе");
  await addAgain.getByRole("button", { name: "Добавить" }).click();

  await login(page, STAFF);
  await page.goto(idpPath);
  const row = page.getByRole("row", { name: new RegExp(NAME) });
  await expect(row.getByRole("radio")).toHaveCount(0);
  await row.getByRole("link", { name: "Сдать тест" }).click();
  takePath = new URL(page.url()).pathname;
  const html = await page.content();
  expect(html).not.toContain("isCorrect");
  expect(html).not.toContain("is_correct");
  await page.getByRole("radio", { name: RIGHT, exact: true }).check();
  const posted = page.waitForResponse((response) => response.request().method() === "POST");
  await page.getByRole("button", { name: "Сдать тест" }).click();
  await posted;
  await expect(page.getByText("сдан", { exact: true })).toBeVisible();
  await expect(page.getByText("Попыток: 1")).toBeVisible();
  await page.goto(idpPath);
  const after = page.getByRole("row", { name: new RegExp(NAME) });
  await expect(after.getByText("принято", { exact: true })).toHaveCount(0);
  await expect(after.getByText("Итог теста: сдан, попыток 1")).toBeVisible();
});

test("неверный ответ показывает «не сдан», сдать можно снова", async ({ page }) => {
  await login(page, STAFF);
  await page.goto(takePath);
  await page.getByRole("radio", { name: WRONG, exact: true }).check();
  const posted = page.waitForResponse((response) => response.request().method() === "POST");
  await page.getByRole("button", { name: "Сдать тест" }).click();
  await posted;
  await expect(page.getByText("не сдан", { exact: true })).toBeVisible();
  await expect(page.getByText("Попыток: 2")).toBeVisible();
  await expect(page.getByRole("button", { name: "Сдать тест" })).toBeVisible();
});

test("после приёмки попытка не записывается", async ({ page }) => {
  await page.goto(idpPath);
  const row = page.getByRole("row", { name: new RegExp(NAME) });
  await row.getByRole("button", { name: "Подтвердить" }).click();
  await expect(row.getByText("принято", { exact: true }).filter({ visible: true })).toBeVisible();

  await login(page, STAFF);
  await page.goto(takePath);
  await expect(page.getByRole("button", { name: "Сдать тест" })).toHaveCount(0);
  await expect(page.getByRole("radio")).toHaveCount(0);
  await expect(page.getByText("Попыток: 2")).toBeVisible();
  await page.goto(idpPath);
  const own = page.getByRole("row", { name: new RegExp(NAME) });
  await expect(own.getByRole("link", { name: "Сдать тест" })).toHaveCount(0);
  await expect(own.getByText("Итог теста: не сдан, попыток 2")).toBeVisible();
});

test("чужой сотрудник попытку не пишет", async ({ page }) => {
  await login(page, OTHER);
  const response = await page.goto(takePath);
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("button", { name: "Сдать тест" })).toHaveCount(0);

  await login(page, STAFF);
  await page.goto(idpPath);
  await expect(page.getByRole("row", { name: new RegExp(NAME) }).getByText("Итог теста: не сдан, попыток 2")).toBeVisible();
});

test("дальше не ругается, если вариант уже выбран", async ({ page }) => {
  const first = `Первый ${STAMP}`;
  const second = `Второй ${STAMP}`;
  const title = `Два вопроса ${STAMP}`;
  await page.goto(idpPath);
  const add = page.locator("form", { has: page.getByRole("heading", { name: "Добавить задание" }) });
  const competencyLabel = await add.getByLabel(/^Компетенция/).locator("option").nth(0).innerText();
  await page.goto("/assignments/new");
  const create = page.locator("form").filter({ has: page.getByRole("button", { name: "Создать" }) });
  await create.getByLabel(/^Компетенция/).selectOption({ label: competencyLabel.replace(/\s·\sур\.\s\d+$/, "") });
  await create.getByLabel(/^Название/).fill(title);
  await create.getByLabel(/^Узнать/).fill("Узнать шаги");
  await create.getByLabel(/^Проверить/).fill("Проверить шаги");
  await create.getByRole("button", { name: "Создать" }).click();
  const testForm = page.locator("form", { has: page.getByRole("button", { name: "Сохранить тест" }) });
  await expect(async () => {
    await testForm.getByRole("button", { name: "Добавить вопрос" }).click();
    await expect(testForm.getByLabel("Вопрос")).toBeVisible({ timeout: 1000 });
  }).toPass();
  await testForm.getByRole("button", { name: "Добавить вопрос" }).click();
  await testForm.getByLabel("Вопрос").nth(0).fill(first);
  await testForm.getByLabel("Вопрос").nth(1).fill(second);
  const options = testForm.getByLabel("Вариант");
  await options.nth(0).fill("Да");
  await options.nth(1).fill("Нет");
  await options.nth(2).fill("Да");
  await options.nth(3).fill("Нет");
  await testForm.getByRole("checkbox", { name: /^Верный/ }).nth(0).check({ force: true });
  await testForm.getByRole("checkbox", { name: /^Верный/ }).nth(2).check({ force: true });
  const saved = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().includes("/assignments/"),
  );
  await testForm.getByRole("button", { name: "Сохранить тест" }).click();
  await saved;

  await page.goto(idpPath);
  const addAgain = page.locator("form", { has: page.getByRole("heading", { name: "Добавить задание" }) });
  const catalog = addAgain.getByLabel(/^Из справочника/);
  await catalog.selectOption({ value: (await catalog.locator("option", { hasText: title }).getAttribute("value")) ?? "" });
  await addAgain.getByRole("button", { name: "Добавить" }).click();

  await login(page, STAFF);
  await page.goto(idpPath);
  await page.getByRole("row", { name: new RegExp(title) }).getByRole("link", { name: "Сдать тест" }).click();
  const run = page.locator("form", { has: page.getByText(first) });
  await page.getByRole("button", { name: "Дальше" }).click();
  await expect(page.getByText(first)).toBeVisible();
  await expect(run.getByRole("alert")).toHaveCount(0);
  await run.getByRole("radio", { name: "Да", exact: true }).check();
  await page.getByRole("button", { name: "Дальше" }).click();
  await expect(page.getByText(second)).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Выберите вариант" })).toHaveCount(0);
  await page.getByRole("button", { name: "Назад" }).click();
  await expect(page.getByText(first)).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Выберите вариант" })).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "Да", exact: true })).toBeChecked();
});
