import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, login, test } from "./fixtures";
import { E2E_ADMIN } from "./env";

/**
 * Печать трёх адресов: эмуляция `print`, без библиотеки PDF.
 * Файл идёт от админа; чужая карточка проверяется отдельной учёткой.
 */
test.use({ asAdmin: true });

const CRITERIA = "Оформляет комментарий к задаче так, что по нему понятно, что сделано и что осталось";
const VERSION = /версия на \d{2}\.\d{2}\.\d{4}/;

async function createEmployee(
  page: Page,
  account: { login: string; name: string; password: string },
) {
  await page.goto("/people");
  const form = page.locator("form", { has: page.getByRole("heading", { name: "Новый сотрудник" }) });
  await form.getByLabel("Логин").fill(account.login);
  await form.getByLabel("Имя").fill(account.name);
  await form.getByLabel("Пароль").fill(account.password);
  await form.getByLabel(/^Должность/).selectOption("junior");
  await form.getByLabel(/^Руководитель/).selectOption({ label: E2E_ADMIN.name });
  await form.getByRole("button", { name: "Создать" }).click();
  const link = page.getByRole("link", { name: account.name, exact: true });
  await expect(link).toBeVisible();
  const href = await link.getAttribute("href");
  if (!href) throw new Error(`нет ссылки на ${account.name}`);
  return href;
}

async function usePrint(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("pp-theme", "dark");
  });
}

async function printed(page: Page) {
  await page.emulateMedia({ media: "print" });
}

/** Сколько узлов реально видно: `display: none` у предка тоже считается скрытием. */
async function shown(page: Page, selector: string) {
  return page.locator(selector).evaluateAll((nodes) =>
    nodes.filter((node) => {
      let current: Element | null = node;
      while (current) {
        const style = getComputedStyle(current);
        if (style.display === "none" || style.visibility === "hidden") return false;
        current = current.parentElement;
      }
      return true;
    }).length,
  );
}

async function fitsPage(page: Page) {
  const fit = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth <= root.clientWidth;
  });
  expect(fit).toBe(true);
}

function channels(color: string) {
  return (color.match(/\d+/g) ?? []).map(Number);
}

test("критерии 1 и 3: профиль печатается светлым, без шапки и форм", async ({ page }) => {
  await usePrint(page);
  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto("/jobs/junior/profile");
  await expect(page.getByRole("heading", { name: "Младший программист" })).toBeVisible();
  await expect(page.locator(".toolbar")).toBeVisible();
  expect(await shown(page, ".print-only")).toBe(0);

  await printed(page);
  await expect(page.locator(".toolbar")).toBeHidden();
  await expect(page.getByRole("heading", { name: "Младший программист" })).toBeVisible();
  await expect(page.getByText(VERSION)).toBeVisible();
  await expect(page.locator(".skill-criteria.print-only", { hasText: CRITERIA })).toBeVisible();
  expect(await shown(page, "form")).toBe(0);
  expect(await shown(page, ".btn, .btn-primary, .btn-danger, .btn-warn, .btn-success")).toBe(0);
  await fitsPage(page);

  const paint = await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    const panel = document.querySelector(".panel");
    const panelBg = panel ? getComputedStyle(panel).backgroundColor : body.backgroundColor;
    return { bg: body.backgroundColor, color: body.color, panel: panelBg };
  });
  const bg = channels(paint.bg);
  const ink = channels(paint.color);
  const panel = channels(paint.panel);
  expect(bg[0]).toBeGreaterThan(240);
  expect(bg[1]).toBeGreaterThan(240);
  expect(bg[2]).toBeGreaterThan(240);
  expect(ink[0]).toBeLessThan(40);
  expect(panel[0]).toBeGreaterThan(240);
  expect(panel[1]).toBeGreaterThan(240);
  expect(panel[2]).toBeGreaterThan(240);

  mkdirSync(path.join(process.cwd(), "tmp"), { recursive: true });
  await page.pdf({
    path: path.join(process.cwd(), "tmp", "print-junior-profile.pdf"),
    printBackground: true,
  });
});

test("критерий 2: таблица ИПР печатается целиком, без кнопок действий", async ({ page }) => {
  const staff = { login: "e2e.print.idp", name: "Печать ИПР E2E", password: "e2e-print-idp-password" };
  await usePrint(page);
  await createEmployee(page, staff);
  await page.goto("/idps");
  await page.getByLabel(/^Сотрудник/).selectOption({ label: staff.name });
  await page.getByLabel(/^Цель/).selectOption("programmer");
  await page.getByLabel("Начало").fill("2026-03-01");
  await page.getByLabel("Конец").fill("2026-09-30");
  await page.getByRole("button", { name: "Создать" }).click();
  await page
    .locator("li", { hasText: staff.name })
    .getByRole("link", { name: "Младший программист → Программист" })
    .click();

  const add = page.locator("form", { has: page.getByRole("heading", { name: "Добавить задание" }) });
  await add.getByLabel(/^Компетенция/).selectOption({ index: 1 });
  await add.getByLabel("Название (если новое)").fill("Первая строка печати");
  await add.getByLabel("Узнать").fill("Узнать первое");
  await add.getByLabel("Проверить").fill("Проверить первое");
  await add.getByRole("textbox", { name: "Срок" }).fill("2026-06-15");
  await add.getByRole("button", { name: "Добавить" }).click();
  await expect(page.getByRole("row", { name: /Первая строка печати/ })).toBeVisible();

  await add.getByLabel(/^Компетенция/).selectOption({ index: 2 });
  await add.getByLabel("Название (если новое)").fill("Вторая строка печати");
  await add.getByLabel("Узнать").fill("Узнать второе");
  await add.getByLabel("Проверить").fill("Проверить второе");
  await add.getByRole("textbox", { name: "Срок" }).fill("2026-07-01");
  await add.getByRole("button", { name: "Добавить" }).click();
  await expect(page.getByRole("row", { name: /Вторая строка печати/ })).toBeVisible();
  expect(await page.getByRole("button", { name: "Принять" }).count()).toBe(0);
  expect(await page.getByRole("button", { name: "Отменить" }).count()).toBeGreaterThan(0);
  expect(await page.getByRole("button", { name: "Подтвердить" }).count()).toBeGreaterThan(0);

  await page.setViewportSize({ width: 800, height: 900 });
  await printed(page);

  await expect(page.getByRole("heading", { name: /ИПР:/ })).toBeVisible();
  await expect(page.getByText(staff.name)).toBeVisible();
  await expect(page.getByText("01.03.2026 — 30.09.2026")).toBeVisible();
  await expect(page.getByText(VERSION)).toBeVisible();
  const tables = page.locator(".idp-table");
  await expect(tables).toHaveCount(2);
  for (const table of await tables.all()) {
    for (const name of ["Цель", "Узнать", "Проверить", "Тест", "Срок", "Статус", "Подтверждение", "Действия"]) {
      await expect(table.getByRole("columnheader", { name, exact: true })).toBeVisible();
    }
  }
  await expect(page.getByRole("row", { name: /Первая строка печати/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Вторая строка печати/ })).toBeVisible();
  await expect(page.getByText("← Все ИПР")).toBeHidden();
  expect(await page.getByRole("button", { name: "Принять" }).count()).toBe(0);
  expect(await page.getByRole("button", { name: "Отменить" }).count()).toBe(0);
  expect(await page.getByRole("button", { name: "Подтвердить" }).count()).toBe(0);
  expect(await shown(page, "button")).toBe(0);
  await fitsPage(page);
  const avoid = await tables
    .first()
    .locator("tbody tr")
    .first()
    .evaluate((row) => getComputedStyle(row).breakInside);
  expect(avoid).toBe("avoid");
});

test("критерий 4: карточка печатает достижения и подтверждения без пометок и кнопок", async ({ page }) => {
  const staff = { login: "e2e.print.card", name: "Печать карточки E2E", password: "e2e-print-card-password" };
  await usePrint(page);
  const href = await createEmployee(page, staff);
  await page.goto(href);
  expect(await page.getByRole("button", { name: "Деактивировать" }).count()).toBeGreaterThan(0);
  await printed(page);

  await expect(page.getByRole("heading", { name: staff.name })).toBeVisible();
  await expect(page.getByRole("link", { name: "Младший программист" })).toBeVisible();
  await expect(page.getByText(VERSION)).toBeVisible();
  await expect(page.getByTestId("employee-achievements")).toBeVisible();
  await expect(page.getByTestId("employee-confirmations")).toBeVisible();
  await expect(page.getByTestId("marks-unmarked")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Мои пометки по компетенциям" })).toHaveCount(0);
  expect(await shown(page, "form")).toBe(0);
  expect(await page.getByRole("button", { name: "Деактивировать" }).count()).toBe(0);
  expect(await shown(page, "button")).toBe(0);
});

test("критерий 5: печать чужой карточки остаётся 404", async ({ page }) => {
  const owner = { login: "e2e.print.owner", name: "Владелец печати E2E", password: "e2e-print-owner-password" };
  const other = { login: "e2e.print.other", name: "Чужая печать E2E", password: "e2e-print-other-password" };
  await createEmployee(page, owner);
  const foreign = await createEmployee(page, other);
  await login(page, owner);
  const response = await page.goto(foreign);
  expect(response?.status()).toBe(404);
  await printed(page);
  expect(response?.status()).toBe(404);
  await expect(page.getByTestId("employee-achievements")).toHaveCount(0);
  await expect(page.getByTestId("employee-confirmations")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: other.name })).toHaveCount(0);
  await expect(page.getByText(VERSION)).toHaveCount(0);
});
