import type { Page } from "@playwright/test";
import { expect, login, test } from "./fixtures";
import { E2E_ADMIN } from "./env";

test.describe.configure({ mode: "serial" });

// Файл работает от админа: сессия одна на воркер (см. e2e/fixtures.ts).
test.use({ asAdmin: true });

const STAMP = Date.now();
const NAME = `Смена компетенции ${STAMP}`;
const PLAIN = {
  login: `e2e.comp.plain.${STAMP}`,
  name: `Без прав на справочник ${STAMP}`,
  password: "e2e-comp-plain",
};
let idpPath = "";
let cardPath = "";
let firstId = "";
let secondId = "";
let firstName = "";
let secondName = "";

function addForm(page: Page) {
  return page.locator("form", { has: page.getByRole("heading", { name: "Добавить задание" }) });
}

function saveForm(page: Page) {
  return page.locator("form", { has: page.locator('input[name="name"]') });
}

test("после сохранения карточка показывает новую компетенцию", async ({ page }) => {
  await page.goto("/people");
  const person = page.locator("form", { has: page.getByRole("heading", { name: "Новый сотрудник" }) });
  await person.getByLabel("Логин").fill(`e2e.comp.${STAMP}`);
  await person.getByLabel("Имя").fill(`Компетенция задания ${STAMP}`);
  await person.getByLabel("Пароль").fill("e2e-comp-password");
  await person.getByLabel(/^Должность/).selectOption("junior");
  await person.getByLabel(/^Руководитель/).selectOption({ label: E2E_ADMIN.name });
  await person.getByRole("button", { name: "Создать" }).click();
  await expect(page.getByRole("link", { name: `Компетенция задания ${STAMP}`, exact: true })).toBeVisible();

  await page.goto("/idps");
  await page.getByLabel(/^Сотрудник/).selectOption({ label: `Компетенция задания ${STAMP}` });
  await page.getByLabel(/^Цель/).selectOption("programmer");
  await page.getByLabel("Начало").fill("2026-03-01");
  await page.getByLabel("Конец").fill("2026-09-30");
  await page.getByRole("button", { name: "Создать" }).click();
  await page
    .locator("li", { hasText: `Компетенция задания ${STAMP}` })
    .getByRole("link", { name: "Младший программист → Программист" })
    .click();
  idpPath = new URL(page.url()).pathname;

  const competency = addForm(page).getByLabel(/^Компетенция/);
  firstId = (await competency.locator("option").nth(0).getAttribute("value")) ?? "";
  secondId = (await competency.locator("option").nth(1).getAttribute("value")) ?? "";
  firstName = ((await competency.locator("option").nth(0).innerText()) ?? "").replace(/\s·\sур\.\s\d+$/, "");
  secondName = ((await competency.locator("option").nth(1).innerText()) ?? "").replace(/\s·\sур\.\s\d+$/, "");
  expect(firstId).not.toBe("");
  expect(secondId).not.toBe(firstId);

  await page.goto("/assignments/new");
  const create = page.locator("form").filter({ has: page.getByRole("button", { name: "Создать" }) });
  await create.getByLabel(/^Компетенция/).selectOption(firstId);
  await create.getByLabel(/^Название/).fill(NAME);
  await create.getByLabel(/^Узнать/).fill("Как сделать");
  await create.getByLabel(/^Проверить/).fill("Есть результат");
  await create.getByRole("button", { name: "Создать" }).click();
  await expect(page).toHaveURL(/\/assignments\/asg/);
  cardPath = new URL(page.url()).pathname;

  await page.goto(idpPath);
  const add = addForm(page);
  await add.getByLabel(/^Компетенция/).selectOption(firstId);
  const catalog = add.getByLabel(/^Из справочника/);
  await catalog.selectOption({
    value: (await catalog.locator("option", { hasText: NAME }).getAttribute("value")) ?? "",
  });
  await add.getByRole("button", { name: "Добавить" }).click();
  const oldGroup = page.getByRole("heading", { level: 3, name: new RegExp(firstName) }).locator("xpath=..");
  await expect(oldGroup.getByRole("row", { name: new RegExp(NAME) })).toBeVisible();

  await page.goto(cardPath);
  const save = saveForm(page);
  await save.getByLabel(/^Компетенция/).selectOption(secondId);
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST"),
    save.getByRole("button", { name: "Сохранить", exact: true }).click(),
  ]);
  await page.reload();
  await expect(page.getByLabel(/^Компетенция/)).toHaveValue(secondId);
});

test("строка открытого ИПР остаётся на старой компетенции", async ({ page }) => {
  await page.goto(idpPath);
  const oldGroup = page.getByRole("heading", { level: 3, name: new RegExp(firstName) }).locator("xpath=..");
  await expect(oldGroup.getByRole("row", { name: new RegExp(NAME) })).toBeVisible();
  const moved = page.getByRole("heading", { level: 3, name: new RegExp(secondName) });
  if ((await moved.count()) > 0) {
    await expect(moved.locator("xpath=..").getByRole("row", { name: new RegExp(NAME) })).toHaveCount(0);
  }
});

test("то же название в другой компетенции без учёта регистра не переносится", async ({ page }) => {
  await page.goto("/assignments/new");
  const create = page.locator("form").filter({ has: page.getByRole("button", { name: "Создать" }) });
  await create.getByLabel(/^Компетенция/).selectOption(firstId);
  await create.getByLabel(/^Название/).fill(NAME.toLowerCase());
  await create.getByLabel(/^Узнать/).fill("Как сделать");
  await create.getByLabel(/^Проверить/).fill("Есть результат");
  await create.getByRole("button", { name: "Создать" }).click();
  await expect(page).toHaveURL(/\/assignments\/asg/);

  await page.goto(cardPath);
  const save = saveForm(page);
  await save.getByLabel(/^Компетенция/).selectOption(firstId);
  await save.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(save.getByRole("alert")).toHaveText("Такое задание уже есть в справочнике этой компетенции");
  await page.reload();
  await expect(page.getByLabel(/^Компетенция/)).toHaveValue(secondId);
});

test("скрытое задание не меняет компетенцию", async ({ page }) => {
  await page.goto(cardPath);
  await expect(page.getByLabel(/^Компетенция/)).toHaveValue(secondId);

  const other = await page.context().newPage();
  await other.goto(cardPath);
  await other.getByRole("button", { name: "Перенести в архив" }).click();
  await expect(other.getByRole("button", { name: "Вернуть" })).toBeVisible();
  await other.close();

  const save = saveForm(page);
  await save.getByLabel(/^Компетенция/).selectOption(firstId);
  await save.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(save.getByRole("alert")).toHaveText("Скрытое задание сначала верните в справочник");
  await page.reload();
  await expect(page.getByLabel(/^Название/)).toHaveCount(0);
  await expect(page.locator("p").filter({ hasText: "Компетенция" })).toContainText(secondName);
});

test("сотрудник без подчинённых не видит форму правки", async ({ page }) => {
  await page.goto("/people");
  const person = page.locator("form", { has: page.getByRole("heading", { name: "Новый сотрудник" }) });
  await person.getByLabel("Логин").fill(PLAIN.login);
  await person.getByLabel("Имя").fill(PLAIN.name);
  await person.getByLabel("Пароль").fill(PLAIN.password);
  await person.getByLabel(/^Админ/).selectOption("");
  await person.getByRole("button", { name: "Создать" }).click();
  await expect(page.getByRole("link", { name: PLAIN.name, exact: true })).toBeVisible();

  await login(page, PLAIN);
  await page.goto(cardPath);
  await expect(page).toHaveURL(/\/idps$/);
  await expect(page.getByRole("button", { name: "Сохранить", exact: true })).toHaveCount(0);
});
