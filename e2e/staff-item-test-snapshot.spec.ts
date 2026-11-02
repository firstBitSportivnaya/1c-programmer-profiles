import type { Page } from "@playwright/test";
import { expect, login, test } from "./fixtures";

test.describe.configure({ mode: "serial" });

// Файл работает от админа: сессия одна на воркер (см. e2e/fixtures.ts).
test.use({ asAdmin: true });

const STAMP = Date.now();
const WITH_TEST = `Снимок ${STAMP}`;
const WITHOUT_TEST = `Без снимка ${STAMP}`;
const PROMPT = `Вопрос снимка ${STAMP}`;
const CHANGED = `Новая формулировка ${STAMP}`;
const STAFF = { login: `e2e.snap.${STAMP}`, name: `Снимок ${STAMP}`, password: "e2e-snap-password" };
let withTestPath = "";
let withoutTestPath = "";
let idpPath = "";

async function createAssignment(page: Page, name: string, competency: string) {
  await page.goto("/assignments/new");
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Создать" }) });
  await form.getByLabel(/^Компетенция/).selectOption({ label: competency });
  await form.getByLabel(/^Название/).fill(name);
  await form.getByLabel(/^Узнать/).fill("Узнать снимок");
  await form.getByLabel(/^Проверить/).fill("Проверить снимок");
  await form.getByRole("button", { name: "Создать" }).click();
  await expect(page).toHaveURL(/\/assignments\/asg/);
  return page.url();
}

async function saveQuestion(page: Page, prompt: string) {
  const testForm = page.locator("form", { has: page.getByRole("button", { name: "Сохранить тест" }) });
  if ((await testForm.getByLabel("Вопрос").count()) === 0) {
    await expect(async () => {
      await testForm.getByRole("button", { name: "Добавить вопрос" }).click();
      await expect(testForm.getByLabel("Вопрос")).toBeVisible({ timeout: 1000 });
    }).toPass();
  }
  await testForm.getByLabel("Вопрос").fill(prompt);
  const options = testForm.getByLabel("Вариант");
  await options.nth(0).fill("Да");
  await options.nth(1).fill("Нет");
  await testForm.getByRole("checkbox", { name: /^Верный/ }).nth(0).check({ force: true });
  const saved = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().includes("/assignments/"),
  );
  await testForm.getByRole("button", { name: "Сохранить тест" }).click();
  await saved;
}

test("задание с тестом копирует вопросы в строку", async ({ page }) => {
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
  const competency = (await add.getByLabel(/^Компетенция/).locator("option").first().innerText()).replace(
    /\s·\sур\.\s\d+$/,
    "",
  );
  withTestPath = await createAssignment(page, WITH_TEST, competency);
  await saveQuestion(page, PROMPT);
  withoutTestPath = await createAssignment(page, WITHOUT_TEST, competency);
  await page.goto(idpPath);

  const addAgain = page.locator("form", { has: page.getByRole("heading", { name: "Добавить задание" }) });
  const catalog = addAgain.getByLabel(/^Из справочника/);
  await catalog.selectOption({ value: (await catalog.locator("option", { hasText: WITH_TEST }).getAttribute("value")) ?? "" });
  await addAgain.getByRole("button", { name: "Добавить" }).click();
  await expect(page.getByRole("row", { name: new RegExp(WITH_TEST) }).getByText("Тест есть")).toBeVisible();

  await login(page, STAFF);
  await page.goto(idpPath);
  await page.getByRole("row", { name: new RegExp(WITH_TEST) }).getByRole("link", { name: "Сдать тест" }).click();
  await expect(page.getByText(PROMPT)).toBeVisible();
});

test("правка справочника не меняет снимок строки", async ({ page }) => {
  await page.goto(withTestPath);
  await saveQuestion(page, CHANGED);
  await login(page, STAFF);
  await page.goto(idpPath);
  await page.getByRole("row", { name: new RegExp(WITH_TEST) }).getByRole("link", { name: "Сдать тест" }).click();
  await expect(page.getByText(PROMPT)).toBeVisible();
  await expect(page.getByText(CHANGED)).toHaveCount(0);
});

test("строка без теста не получает вопросы задним числом", async ({ page }) => {
  await page.goto(idpPath);
  const add = page.locator("form", { has: page.getByRole("heading", { name: "Добавить задание" }) });
  const catalog = add.getByLabel(/^Из справочника/);
  await catalog.selectOption({
    value: (await catalog.locator("option", { hasText: WITHOUT_TEST }).getAttribute("value")) ?? "",
  });
  await add.getByRole("button", { name: "Добавить" }).click();
  const row = page.getByRole("row", { name: new RegExp(WITHOUT_TEST) });
  await expect(row.getByText("нет", { exact: true })).toBeVisible();
  await expect(row.getByRole("link", { name: "Сдать тест" })).toHaveCount(0);

  await page.goto(withoutTestPath);
  await saveQuestion(page, CHANGED);
  await login(page, STAFF);
  await page.goto(idpPath);
  const plain = page.getByRole("row", { name: new RegExp(WITHOUT_TEST) });
  await expect(plain.getByText("нет", { exact: true })).toBeVisible();
  await expect(plain.getByRole("link", { name: "Сдать тест" })).toHaveCount(0);
});
