import { expect, login, test } from "./fixtures";

test.describe.configure({ mode: "serial" });

// Файл работает от админа: сессия одна на воркер (см. e2e/fixtures.ts).
test.use({ asAdmin: true });

const STAMP = Date.now();
const NAME = `Итог ${STAMP}`;
const PLAIN = `Без теста ${STAMP}`;
const RIGHT = `Верный итог ${STAMP}`;
const WRONG = `Лишний итог ${STAMP}`;
const STAFF = { login: `e2e.result.${STAMP}`, name: `Итог ${STAMP}`, password: "e2e-result-password" };
let idpPath = "";

test("рядом с приёмкой видно «сдан» и число попыток, без выбранных ответов", async ({ page }) => {
  await page.goto("/people");
  const person = page.locator("form", { has: page.getByRole("heading", { name: "Новый сотрудник" }) });
  await person.getByLabel("Логин").fill(STAFF.login);
  await person.getByLabel("Имя").fill(STAFF.name);
  await person.getByLabel("Пароль").fill(STAFF.password);
  await person.getByLabel(/^Должность/).selectOption("junior");
  await person.getByRole("button", { name: "Создать" }).click();
  await expect(page.getByRole("link", { name: STAFF.name, exact: true })).toBeVisible();

  await page.goto("/idps");
  await page.getByLabel(/^Сотрудник/).selectOption({ label: STAFF.name });
  await page.getByLabel(/^Цель/).selectOption("programmer");
  await page.getByLabel("Начало").fill("2026-03-01");
  await page.getByLabel("Конец").fill("2026-09-30");
  await page.getByRole("button", { name: "Создать" }).click();
  await page.locator("li", { hasText: STAFF.name }).getByRole("link", { name: "Младший программист → Программист" }).click();
  idpPath = new URL(page.url()).pathname;

  const add = page.locator("form", { has: page.getByRole("heading", { name: "Добавить задание" }) });
  const competencyLabel = await add.getByLabel(/^Компетенция/).locator("option").first().innerText();
  const competency = competencyLabel.replace(/\s·\sур\.\s\d+$/, "");
  await page.goto("/assignments/new");
  const create = page.locator("form").filter({ has: page.getByRole("button", { name: "Создать" }) });
  await create.getByLabel(/^Компетенция/).selectOption({ label: competency });
  await create.getByLabel(/^Название/).fill(NAME);
  await create.getByLabel(/^Узнать/).fill("Узнать итог");
  await create.getByLabel(/^Проверить/).fill("Проверить итог");
  await create.getByRole("button", { name: "Создать" }).click();
  const testForm = page.locator("form", { has: page.getByRole("button", { name: "Сохранить тест" }) });
  await expect(async () => {
    await testForm.getByRole("button", { name: "Добавить вопрос" }).click();
    await expect(testForm.getByLabel("Вопрос")).toBeVisible({ timeout: 1000 });
  }).toPass();
  await testForm.getByLabel("Вопрос").fill(`Вопрос итога ${STAMP}`);
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
  await addAgain.getByLabel("Название (если новое)").fill(PLAIN);
  await addAgain.getByLabel("Узнать").fill("Без теста");
  await addAgain.getByLabel(/^Проверить/).fill("Без теста");
  await addAgain.getByRole("button", { name: "Добавить" }).click();

  await login(page, STAFF);
  await page.goto(idpPath);
  await page.getByRole("row", { name: new RegExp(NAME) }).getByRole("link", { name: "Сдать тест" }).click();
  await page.getByRole("radio", { name: RIGHT, exact: true }).check();
  const posted = page.waitForResponse((response) => response.request().method() === "POST");
  await page.getByRole("button", { name: "Сдать тест" }).click();
  await posted;

  // Сдать тест мог только сотрудник: кнопку приёмки видит админ, поэтому вход возвращаем.
  await login(page);
  await page.goto(idpPath);
  const row = page.getByRole("row", { name: new RegExp(NAME) });
  const accept = row.getByRole("button", { name: "Подтвердить" });
  await expect(accept).toBeVisible();
  await expect(row.getByText("Итог теста: сдан, попыток 1")).toBeVisible();
  await expect(row.getByText(RIGHT)).toHaveCount(0);
  await expect(row.getByText(WRONG)).toHaveCount(0);
  await expect(row.getByRole("radio")).toHaveCount(0);
});

test("не сданный тест не мешает приёмке", async ({ page }) => {
  await login(page, STAFF);
  await page.goto(idpPath);
  await page.getByRole("row", { name: new RegExp(NAME) }).getByRole("link", { name: "Сдать тест" }).click();
  await page.getByRole("radio", { name: WRONG, exact: true }).check();
  const posted = page.waitForResponse((response) => response.request().method() === "POST");
  await page.getByRole("button", { name: "Сдать тест" }).click();
  await posted;

  // Приёмка снова от админа.
  await login(page);
  await page.goto(idpPath);
  const row = page.getByRole("row", { name: new RegExp(NAME) });
  await expect(row.getByText("Итог теста: не сдан, попыток 2")).toBeVisible();
  await row.getByRole("button", { name: "Подтвердить" }).click();
  await expect(row.getByText("принято", { exact: true }).filter({ visible: true })).toBeVisible();
});

test("строка без теста принимается и не помечается «сдан»", async ({ page }) => {
  await page.goto(idpPath);
  const row = page.getByRole("row", { name: new RegExp(PLAIN) });
  await expect(row.getByText("сдан", { exact: true })).toHaveCount(0);
  await expect(row.getByText(/Итог теста/)).toHaveCount(0);
  await row.getByRole("button", { name: "Подтвердить" }).click();
  await expect(row.getByText("принято", { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(row.getByText("сдан", { exact: true })).toHaveCount(0);
});

test("сотрудник не видит бланк приёмки", async ({ page }) => {
  await login(page, STAFF);
  await page.goto(idpPath);
  const row = page.getByRole("row", { name: new RegExp(NAME) });
  await expect(row.getByText("Итог теста: не сдан, попыток 2")).toBeVisible();
  await expect(row.getByRole("button", { name: "Подтвердить" })).toHaveCount(0);
  await expect(row.getByText(RIGHT)).toHaveCount(0);
});
