import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { E2E_ADMIN } from "./env";

test.describe.configure({ mode: "serial" });

// Файл работает от админа: сессия одна на воркер (см. e2e/fixtures.ts).
test.use({ asAdmin: true });

const NAME = "Задание первой компетенции";
let idpPath = "";
let firstId = "";
let secondId = "";
let firstName = "";
let assignmentId = "";

function addForm(page: Page) {
  return page.locator("form", { has: page.getByRole("heading", { name: "Добавить задание" }) });
}

test("список справочника показывает задания только выбранной компетенции", async ({ page }) => {
  await page.goto("/people");
  const person = page.locator("form", { has: page.getByRole("heading", { name: "Новый сотрудник" }) });
  await person.getByLabel("Логин").fill("e2e.idp.catalog");
  await person.getByLabel("Имя").fill("Справочник ИПР E2E");
  await person.getByLabel("Пароль").fill("e2e-idp-catalog-password");
  await person.getByLabel(/^Должность/).selectOption("junior");
  await person.getByLabel(/^Руководитель/).selectOption({ label: E2E_ADMIN.name });
  await person.getByRole("button", { name: "Создать" }).click();
  await expect(page.getByRole("link", { name: "Справочник ИПР E2E", exact: true })).toBeVisible();

  await page.goto("/idps");
  await page.getByLabel(/^Сотрудник/).selectOption({ label: "Справочник ИПР E2E" });
  await page.getByLabel(/^Цель/).selectOption("programmer");
  await page.getByLabel("Начало").fill("2026-03-01");
  await page.getByLabel("Конец").fill("2026-09-30");
  await page.getByRole("button", { name: "Создать" }).click();
  await page.locator("li", { hasText: "Справочник ИПР E2E" }).getByRole("link", { name: "Младший программист → Программист" }).click();
  idpPath = new URL(page.url()).pathname;

  const competency = addForm(page).getByLabel(/^Компетенция/);
  firstId = (await competency.locator("option").nth(0).getAttribute("value")) ?? "";
  secondId = (await competency.locator("option").nth(1).getAttribute("value")) ?? "";
  firstName = ((await competency.locator("option").nth(0).innerText()) ?? "").replace(/\s·\sур\.\s\d+$/, "");
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

  await page.goto(idpPath);
  const add = addForm(page);
  await add.getByLabel(/^Компетенция/).selectOption(firstId);
  const own = add.getByLabel(/^Из справочника/).locator("option", { hasText: NAME });
  await expect(own).toHaveCount(1);
  assignmentId = (await own.getAttribute("value")) ?? "";
  await add.getByLabel(/^Компетенция/).selectOption(secondId);
  await expect(add.getByLabel(/^Из справочника/).locator("option", { hasText: NAME })).toHaveCount(0);
  await expect(add.getByLabel(/^Из справочника/).locator("option", { hasText: "новое задание" })).toHaveCount(1);
});

test("задание выбранной компетенции садится в её группу", async ({ page }) => {
  await page.goto(idpPath);
  const add = addForm(page);
  await add.getByLabel(/^Компетенция/).selectOption(firstId);
  await add.getByLabel(/^Из справочника/).selectOption(assignmentId);
  await add.getByRole("button", { name: "Добавить" }).click();
  const group = page.getByRole("heading", { level: 3, name: new RegExp(firstName) }).locator("xpath=..");
  await expect(group.getByRole("row", { name: new RegExp(NAME) })).toBeVisible();
});

test("задание чужой компетенции не создаёт строку", async ({ page }) => {
  await page.goto(idpPath);
  const add = addForm(page);
  await add.getByLabel(/^Компетенция/).selectOption(secondId);
  await add.getByLabel(/^Из справочника/).evaluate((select, id) => {
    if (!(select instanceof HTMLSelectElement)) return;
    const option = document.createElement("option");
    option.value = id;
    option.text = "чужое";
    select.appendChild(option);
    select.value = id;
  }, assignmentId);
  await add.getByRole("button", { name: "Добавить" }).click();
  await expect(add.getByRole("alert")).toContainText("Это задание другой компетенции");
  await expect(page.getByRole("row", { name: new RegExp(NAME) })).toHaveCount(1);
});
