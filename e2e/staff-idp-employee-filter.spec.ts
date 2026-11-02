import type { Page } from "@playwright/test";
import { expect, login, test } from "./fixtures";

test.describe.configure({ mode: "serial" });

// Файл работает от админа: сессия одна на воркер (см. e2e/fixtures.ts).
test.use({ asAdmin: true });

const STAMP = Date.now();
const MANAGER = { login: `e2e.idp.filter.m.${STAMP}`, name: `Руководитель фильтра ${STAMP}`, password: "e2e-filter-password" };
const FIRST = { login: `e2e.idp.filter.a.${STAMP}`, name: `Первый фильтра ${STAMP}`, password: "e2e-filter-password" };
const SECOND = { login: `e2e.idp.filter.b.${STAMP}`, name: `Второй фильтра ${STAMP}`, password: "e2e-filter-password" };

let firstId = "";
let secondId = "";

async function createPerson(
  page: Page,
  account: { login: string; name: string; password: string },
  managerName?: string,
) {
  await page.goto("/people");
  const person = page.locator("form", { has: page.getByRole("heading", { name: "Новый сотрудник" }) });
  await person.getByLabel("Логин").fill(account.login);
  await person.getByLabel("Имя").fill(account.name);
  await person.getByLabel("Пароль").fill(account.password);
  await person.getByLabel(/^Должность/).selectOption("junior");
  if (managerName) await person.getByLabel(/^Руководитель/).selectOption({ label: managerName });
  await person.getByRole("button", { name: "Создать" }).click();
  const link = page.getByRole("link", { name: account.name, exact: true });
  await expect(link).toBeVisible();
  return new URL((await link.getAttribute("href")) ?? "", "http://127.0.0.1").pathname.split("/").pop() ?? "";
}

async function createPlan(page: Page, name: string) {
  await page.goto("/idps");
  await page.getByLabel(/^Сотрудник/).selectOption({ label: name });
  await page.getByLabel(/^Цель/).selectOption("programmer");
  await page.getByLabel("Начало").fill("2026-03-01");
  await page.getByLabel("Конец").fill("2026-09-30");
  await page.getByRole("button", { name: "Создать" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: name })).toBeVisible();
}

function filter(page: Page) {
  return page.getByLabel("Фильтр сотрудника");
}

function rows(page: Page) {
  return page.getByRole("listitem");
}

test("выбор сотрудника оставляет только его планы", async ({ page }) => {
  await createPerson(page, MANAGER);
  firstId = await createPerson(page, FIRST, MANAGER.name);
  secondId = await createPerson(page, SECOND, MANAGER.name);
  await createPlan(page, FIRST.name);
  await createPlan(page, SECOND.name);

  await login(page, MANAGER);
  await page.goto("/idps");
  await expect(rows(page).filter({ hasText: FIRST.name })).toBeVisible();
  await expect(rows(page).filter({ hasText: SECOND.name })).toBeVisible();

  await filter(page).selectOption(firstId);
  await page.getByRole("button", { name: "Показать" }).click();
  await expect(page).toHaveURL(new RegExp(`employee=${firstId}`));
  await expect(rows(page).filter({ hasText: FIRST.name })).toBeVisible();
  await expect(rows(page).filter({ hasText: SECOND.name })).toHaveCount(0);
});

test("«все» возвращает планы обоих", async ({ page }) => {
  await login(page, MANAGER);
  await page.goto(`/idps?employee=${firstId}`);
  await filter(page).selectOption("");
  await page.getByRole("button", { name: "Показать" }).click();
  await expect(rows(page).filter({ hasText: FIRST.name })).toBeVisible();
  await expect(rows(page).filter({ hasText: SECOND.name })).toBeVisible();
});

test("отбор сохраняется после перезагрузки", async ({ page }) => {
  await login(page, MANAGER);
  await page.goto(`/idps?employee=${firstId}`);
  await expect(filter(page)).toHaveValue(firstId);
  await page.reload();
  await expect(filter(page)).toHaveValue(firstId);
  await expect(rows(page).filter({ hasText: FIRST.name })).toBeVisible();
  await expect(rows(page).filter({ hasText: SECOND.name })).toHaveCount(0);
});

test("сотрудник без подчинённых чужие планы не видит", async ({ page }) => {
  await login(page, FIRST);
  await page.goto("/idps");
  await expect(rows(page).filter({ hasText: FIRST.name })).toBeVisible();
  await expect(page.getByText(SECOND.name)).toHaveCount(0);

  await page.goto(`/idps?employee=${secondId}`);
  await expect(page.getByText(SECOND.name)).toHaveCount(0);
  await expect(rows(page).filter({ hasText: FIRST.name })).toHaveCount(0);
  await expect(page.getByText("Ничего не найдено.")).toBeVisible();

  await page.goto(`/idps?employee=${secondId}&employee=${firstId}`);
  await expect(page.getByRole("heading", { name: "ИПР" })).toBeVisible();
  await expect(page.getByText(SECOND.name)).toHaveCount(0);
});
