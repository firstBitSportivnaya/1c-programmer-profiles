import type { Page } from "@playwright/test";
import { expect, login, test } from "./fixtures";

test.describe.configure({ mode: "serial" });

// Файл работает от админа: сессия одна на воркер (см. e2e/fixtures.ts).
test.use({ asAdmin: true });

const STAMP = Date.now();
const NAME = `E2E тест ${STAMP}`;
const PLAIN = { login: `e2e.no-test.${STAMP}`, name: `Без теста ${STAMP}`, password: "e2e-plain-password" };
let cardPath = "";

async function openNewCard(page: Page) {
  await page.goto("/assignments/new");
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Создать" }) });
  await form.getByLabel(/^Компетенция/).selectOption({ index: 0 });
  await form.getByLabel(/^Название/).fill(NAME);
  await form.getByLabel(/^Узнать/).fill("Узнать тест");
  await form.getByLabel(/^Проверить/).fill("Проверить тест");
  await form.getByRole("button", { name: "Создать" }).click();
  await expect(page).toHaveURL(/\/assignments\/asg/);
  cardPath = page.url();
}

test("вопрос с одним верным вариантом сохраняется", async ({ page }) => {
  await openNewCard(page);
  const testForm = page.locator("form", { has: page.getByRole("button", { name: "Сохранить тест" }) });
  await expect(async () => {
    if ((await testForm.getByLabel("Вопрос").count()) === 0) {
      await testForm.getByRole("button", { name: "Добавить вопрос" }).click();
    }
    await expect(testForm.getByLabel("Вопрос")).toBeVisible({ timeout: 1000 });
  }).toPass();
  await testForm.getByLabel("Вопрос").fill("Сколько верных?");
  const options = testForm.getByLabel("Вариант");
  await options.nth(0).fill("Один");
  await options.nth(1).fill("Два");
  const correct = testForm.getByRole("checkbox", { name: /^Верный/ }).nth(0);
  await correct.check({ force: true });
  await expect(correct).toBeChecked();
  const saved = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().includes("/assignments/"),
  );
  await testForm.getByRole("button", { name: "Сохранить тест" }).click();
  await saved;
  await expect(testForm.getByLabel("Вопрос")).toHaveValue("Сколько верных?");
  await expect(testForm.getByLabel("Вариант").nth(0)).toHaveValue("Один");
  await expect(testForm.getByLabel("Вариант").nth(1)).toHaveValue("Два");
  await page.reload();
  await expect(page.getByLabel("Вопрос")).toHaveValue("Сколько верных?");
});

test("вопрос без одного верного варианта не записывается", async ({ page }) => {
  await page.goto(cardPath);
  const testForm = page.locator("form", { has: page.getByRole("button", { name: "Сохранить тест" }) });
  await testForm.getByRole("checkbox", { name: /^Верный/ }).nth(0).uncheck();
  await testForm.getByRole("button", { name: "Сохранить тест" }).click();
  await expect(testForm.getByRole("alert")).toHaveText("У вопроса должен быть ровно один верный вариант");
  await expect(testForm.getByLabel("Вопрос")).toHaveValue("Сколько верных?");
  await page.reload();
  await expect(page.getByLabel("Вопрос")).toHaveValue("Сколько верных?");

  await testForm.getByRole("checkbox", { name: /^Верный/ }).nth(0).check();
  await testForm.getByRole("checkbox", { name: /^Верный/ }).nth(1).check();
  await testForm.getByRole("button", { name: "Сохранить тест" }).click();
  await expect(testForm.getByRole("alert")).toHaveText("У вопроса должен быть ровно один верный вариант");
});

test("скрытое задание не правит тест", async ({ page }) => {
  await page.goto(cardPath);
  await page.getByRole("button", { name: "Перенести в архив" }).click();
  const testForm = page.locator("form", { has: page.getByRole("button", { name: "Сохранить тест" }) });
  await testForm.getByRole("button", { name: "Сохранить тест" }).click();
  await expect(testForm.getByRole("alert")).toHaveText("Скрытое задание сначала верните в справочник");
});

test("сотрудник без подчинённых не видит редактор теста", async ({ page }) => {
  await page.goto("/people");
  const form = page.locator("form", { has: page.getByRole("heading", { name: "Новый сотрудник" }) });
  await form.getByLabel("Логин").fill(PLAIN.login);
  await form.getByLabel("Имя").fill(PLAIN.name);
  await form.getByLabel("Пароль").fill(PLAIN.password);
  await form.getByLabel(/^Должность/).selectOption("junior");
  await form.getByRole("button", { name: "Создать" }).click();
  await expect(page.getByRole("link", { name: PLAIN.name, exact: true })).toBeVisible();

  await login(page, PLAIN);
  await page.goto("/assignments");
  await expect(page).toHaveURL(/\/idps$/);
  await expect(page.getByRole("button", { name: "Добавить вопрос" })).toHaveCount(0);
  await page.goto(cardPath);
  await expect(page).toHaveURL(/\/idps$/);
  await expect(page.getByRole("button", { name: "Сохранить тест" })).toHaveCount(0);
});
