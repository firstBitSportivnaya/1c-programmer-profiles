import type { Page } from "@playwright/test";
import { expect, login, test } from "./fixtures";

test.describe.configure({ mode: "serial" });
test.use({ asAdmin: true });

const boss = { login: "e2e.due.boss", name: "Руководитель сроков E2E", password: "e2e-due-boss-password" };
const report = { login: "e2e.due.report", name: "Подчинённый сроков E2E", password: "e2e-due-report-password" };
const other = { login: "e2e.due.other", name: "Чужой руководитель E2E", password: "e2e-due-other-password" };
const stranger = { login: "e2e.due.stranger", name: "Чужой сотрудник E2E", password: "e2e-due-stranger-password" };

function isoShift(days: number) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

async function addPerson(
  page: Page,
  account: { login: string; name: string; password: string },
  managerName?: string,
) {
  await page.goto("/people");
  const form = page.locator("form", { has: page.getByRole("heading", { name: "Новый сотрудник" }) });
  await form.getByLabel("Логин").fill(account.login);
  await form.getByLabel("Имя").fill(account.name);
  await form.getByLabel("Пароль").fill(account.password);
  await form.getByLabel(/^Должность/).selectOption("junior");
  await form.getByLabel(/^Руководитель/).selectOption(managerName ? { label: managerName } : "");
  await form.getByRole("button", { name: "Создать" }).click();
  await expect(page.getByRole("link", { name: account.name, exact: true })).toBeVisible();
}

async function planFor(page: Page, name: string) {
  await page.goto("/idps");
  const create = page.locator("form", { has: page.getByRole("heading", { name: "Новый ИПР" }) });
  await create.getByLabel(/^Сотрудник/).selectOption({ label: name });
  await create.getByLabel(/^Цель/).selectOption("programmer");
  await create.getByLabel("Начало").fill(isoShift(-40));
  await create.getByLabel("Конец").fill(isoShift(40));
  await create.getByRole("button", { name: "Создать" }).click();
  await page.locator("li", { hasText: name }).getByRole("link", { name: "Младший программист → Программист" }).click();
}

async function addItem(page: Page, name: string, due?: string) {
  const add = page.locator("form", { has: page.getByRole("heading", { name: "Добавить задание" }) });
  await add.getByLabel(/^Компетенция/).selectOption({ index: 1 });
  await add.getByLabel("Название (если новое)").fill(name);
  await add.getByLabel("Узнать").fill("Что успеть");
  await add.getByLabel("Проверить").fill("Строка в сводке");
  if (due) await add.getByRole("textbox", { name: "Срок" }).fill(due);
  await add.getByRole("button", { name: "Добавить" }).click();
  await expect(page.getByRole("row", { name: new RegExp(name) })).toBeVisible();
}

test("критерии 1 и 3: просроченная строка в кабинете, сегодняшний срок не просрочен", async ({ page }) => {
  await addPerson(page, boss);
  await addPerson(page, report, boss.name);
  await addPerson(page, other);
  await addPerson(page, stranger, other.name);
  await planFor(page, report.name);
  await addItem(page, "Срок вчера", isoShift(-1));
  await addItem(page, "Срок сегодня", isoShift(0));
  await addItem(page, "Срок далеко", isoShift(20));
  await addItem(page, "Срок не задан");
  await planFor(page, stranger.name);
  await addItem(page, "Чужой срок", isoShift(-1));

  await login(page, boss);
  await page.goto("/me");
  const summary = page.getByTestId("due-summary");
  const list = summary.getByTestId("due-list");
  await expect(summary.getByRole("heading", { name: "По людям" })).toBeVisible();
  await expect(list.getByRole("link").first()).toHaveText("Срок вчера");
  const yesterday = list.locator("li", { has: page.getByRole("link", { name: "Срок вчера" }) });
  await expect(yesterday).toContainText(report.name);
  await expect(yesterday).toContainText("просрочено");
  const today = list.locator("li", { has: page.getByRole("link", { name: "Срок сегодня" }) });
  await expect(today).toBeVisible();
  await expect(today).not.toContainText("просрочено");
  await expect(list.getByRole("link", { name: "Срок далеко" })).toHaveCount(0);
  await expect(list.getByRole("link", { name: "Срок не задан" })).toHaveCount(0);
  await expect(list.getByRole("link", { name: "Чужой срок" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Разделы кабинета" }).getByRole("link", { name: "Мой ИПР (1)" })).toBeVisible();

  await yesterday.getByRole("link", { name: "Срок вчера" }).click();
  await expect(page).toHaveURL(/\/idps\/idp-.+#item-\d+$/);
  const hash = new URL(page.url()).hash;
  const paint = await page.evaluate((id) => {
    const row = document.querySelector(id);
    const other = document.querySelector(`.idp-table tbody tr:not(${id})`);
    if (!(row instanceof HTMLElement) || !(other instanceof HTMLElement)) return null;
    return { row: getComputedStyle(row).backgroundColor, other: getComputedStyle(other).backgroundColor };
  }, hash);
  expect(paint, "строка по якорю подсвечена").not.toBeNull();
  expect(paint?.row).not.toBe(paint?.other);

  await page.goto("/idps?overdue=1");
  const shared = page.getByTestId("due-summary");
  await expect(shared.getByRole("link", { name: "Срок вчера" })).toBeVisible();
  await expect(shared.getByRole("link", { name: "Срок сегодня" })).toBeVisible();
  await expect(shared.getByRole("link", { name: "Чужой срок" })).toHaveCount(0);
});

test("критерий 5: сотрудник видит свои строки и не видит блок «По людям»", async ({ page }) => {
  await login(page, report);
  await page.goto("/me");
  const summary = page.getByTestId("due-summary");
  await expect(summary.getByRole("heading", { name: "По людям" })).toHaveCount(0);
  await expect(summary.getByRole("link", { name: "Срок вчера" })).toBeVisible();
  await expect(summary.getByRole("link", { name: "Чужой срок" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Разделы кабинета" }).getByRole("link", { name: "Мой ИПР (1)" })).toBeVisible();
});

test("критерий 2: приёмка убирает строку из сводки и уменьшает счётчик", async ({ page }) => {
  await login(page, boss);
  await page.goto("/me");
  await page.getByTestId("due-summary").getByRole("link", { name: "Срок вчера" }).click();
  const row = page.getByRole("row", { name: /Срок вчера/ });
  await row.getByRole("button", { name: "Подтвердить" }).click();
  await expect(row.getByRole("button", { name: "Подтвердить" })).toHaveCount(0);

  await page.goto("/me");
  const summary = page.getByTestId("due-summary");
  await expect(summary.getByRole("link", { name: "Срок вчера" })).toHaveCount(0);
  await expect(summary.getByRole("link", { name: "Срок сегодня" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Разделы кабинета" }).getByRole("link", { name: "Мой ИПР", exact: true })).toBeVisible();
});

test("критерий 4: чужой руководитель и админ без подчинённых чужие сроки не видят", async ({ page }) => {
  await login(page, other);
  await page.goto("/me");
  await expect(page.getByTestId("due-summary").getByRole("link", { name: "Срок вчера" })).toHaveCount(0);
  await expect(page.getByTestId("due-summary").getByRole("link", { name: "Чужой срок" })).toBeVisible();
  await page.goto("/idps?overdue=1");
  await expect(page.getByTestId("due-summary").getByRole("link", { name: "Срок вчера" })).toHaveCount(0);

  await login(page);
  const me = await page.goto("/me");
  expect(me?.status()).toBe(200);
  const summary = page.getByTestId("due-summary");
  await expect(summary.getByRole("heading", { name: "По людям" })).toBeVisible();
  await expect(summary.getByText("Нет сроков по людям.")).toBeVisible();
  await expect(summary.getByRole("link", { name: "Срок вчера" })).toHaveCount(0);
  await expect(summary.getByRole("link", { name: "Чужой срок" })).toHaveCount(0);
  const list = await page.goto("/idps?overdue=1");
  expect(list?.status()).toBe(200);
  await expect(page.getByText("Нет сроков: просроченных и ближайших строк нет.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Срок вчера" })).toHaveCount(0);
});
