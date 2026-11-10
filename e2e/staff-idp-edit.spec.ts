import type { Page } from "@playwright/test";
import { expect, login, test } from "./fixtures";
import { E2E_ADMIN } from "./env";

test.describe.configure({ mode: "serial" });

// Файл работает от админа: сессия одна на воркер (см. e2e/fixtures.ts).
test.use({ asAdmin: true });

const STAFF = { login: "e2e.idp.edit", name: "Правка ИПР E2E", password: "e2e-idp-edit-password" };
const OTHER = { login: "e2e.idp.other", name: "Чужой ИПР E2E", password: "e2e-idp-other-password" };
const GOAL = "Собрать отчёт";
let idpPath = "";

async function createEmployee(page: Page, account: { login: string; name: string; password: string }) {
  await page.goto("/people");
  const form = page.locator("form", { has: page.getByRole("heading", { name: "Новый сотрудник" }) });
  await form.getByLabel("Логин").fill(account.login);
  await form.getByLabel("Имя").fill(account.name);
  await form.getByLabel("Пароль").fill(account.password);
  await form.getByLabel(/^Должность/).selectOption("junior");
  await form.getByLabel(/^Руководитель/).selectOption({ label: E2E_ADMIN.name });
  await form.getByRole("button", { name: "Создать" }).click();
  await expect(page.getByRole("link", { name: account.name, exact: true })).toBeVisible();
}

test("форма правки строки закрыта, пока её не раскроют", async ({ page }) => {
  await createEmployee(page, STAFF);
  await createEmployee(page, OTHER);

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
  await add.getByLabel("Узнать").fill("Как собрать");
  await add.getByLabel("Проверить").fill("Отчёт есть");
  await add.getByRole("button", { name: "Добавить" }).click();

  idpPath = new URL(page.url()).pathname;
  const row = page.getByRole("row", { name: new RegExp(GOAL) });
  const headers = row.locator("xpath=ancestor::table[1]").getByRole("columnheader");
  await expect(headers.nth(3)).toHaveText("Тест");
  await expect(headers.nth(4)).toHaveText("Срок");
  await expect(headers.nth(5)).toHaveText("Статус");
  await expect(headers.nth(6)).toHaveText("Подтверждение");
  await expect(headers.nth(7)).toHaveText("Действия");
  await expect(row.getByRole("button", { name: "Сохранить", exact: true })).toBeHidden();
  await expect(row.getByLabel("Название")).toBeHidden();
  await row.getByText("Править", { exact: true }).click();
  await expect(row.getByRole("button", { name: "Сохранить", exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: "Убрать из плана" })).toBeVisible();
  await expect(row.getByLabel("Название")).toBeVisible();
  await expect(row.getByLabel("Узнать")).toHaveValue("Как собрать");
  await expect(row.getByLabel("Проверить")).toHaveValue("Отчёт есть");
  await expect(row.locator("p").filter({ hasText: "Как собрать" })).toBeHidden();
  const due = row.getByLabel("Срок");
  await expect(due).toBeVisible();
  expect(await due.getAttribute("min")).toBeNull();
  expect(await due.getAttribute("max")).toBeNull();
});

test("новое название остаётся в ячейке после перезагрузки", async ({ page }) => {
  await page.goto(idpPath);
  const row = page.getByRole("row", { name: new RegExp(GOAL) });
  await row.getByText("Править", { exact: true }).click();
  const editing = page.getByRole("row").filter({ has: page.getByRole("button", { name: "Сохранить", exact: true }) });
  await editing.getByLabel("Название").fill("Собрать сводку");
  const posted = page.waitForResponse((response) => response.request().method() === "POST");
  await editing.getByRole("button", { name: "Сохранить", exact: true }).click();
  await posted;
  const saved = page.getByRole("row", { name: /Собрать сводку/ });
  await expect(saved.getByText("Собрать сводку", { exact: true })).toBeVisible();
  await expect(saved.getByLabel("Название")).toHaveCount(0);
  await expect(saved.getByRole("button", { name: "Править" })).toBeVisible();
  await page.reload();
  const again = page.getByRole("row", { name: /Собрать сводку/ });
  await expect(again.getByText("Собрать сводку", { exact: true })).toBeVisible();
  await expect(again.getByLabel("Название")).toBeHidden();
  await again.getByText("Править", { exact: true }).click();
  const restore = page.getByRole("row").filter({ has: page.getByRole("button", { name: "Сохранить", exact: true }) });
  await restore.getByLabel("Название").fill(GOAL);
  const restored = page.waitForResponse((response) => response.request().method() === "POST");
  await restore.getByRole("button", { name: "Сохранить", exact: true }).click();
  await restored;
  await page.reload();
  await expect(page.getByRole("row", { name: new RegExp(GOAL) }).getByText(GOAL, { exact: true })).toBeVisible();
});

test("пустое название не записывается, прежний текст остаётся", async ({ page }) => {
  await page.goto(idpPath);
  const row = page.getByRole("row", { name: new RegExp(GOAL) });
  await row.getByText("Править", { exact: true }).click();
  const editing = page.getByRole("row").filter({ has: page.getByRole("button", { name: "Сохранить", exact: true }) });
  await editing.getByLabel("Название").fill("");
  await editing.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(editing.getByRole("alert")).toContainText("Нужны название, узнать и проверить");
  await expect(editing.getByLabel("Название")).toHaveValue(GOAL);
  await page.reload();
  const again = page.getByRole("row", { name: new RegExp(GOAL) });
  await expect(again.getByText(GOAL, { exact: true })).toBeVisible();
  await expect(again.getByLabel("Название")).toBeHidden();
});

test("срок вне периода не записывается", async ({ page }) => {
  await page.goto(idpPath);
  const row = page.getByRole("row", { name: new RegExp(GOAL) });
  await row.getByText("Править", { exact: true }).click();
  const editing = page.getByRole("row").filter({ has: page.getByRole("button", { name: "Сохранить", exact: true }) });
  await editing.getByLabel("Срок").fill("2026-01-01");
  await editing.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(editing.getByRole("alert")).toContainText("Срок задания должен быть внутри периода ИПР");
  await page.reload();
  const again = page.getByRole("row", { name: new RegExp(GOAL) });
  await expect(again.getByText("—", { exact: true })).toBeVisible();
  await expect(again.getByLabel("Срок")).toHaveCount(0);
});

test("пустое узнать или проверить не записывается", async ({ page }) => {
  await page.goto(idpPath);
  const row = page.getByRole("row", { name: new RegExp(GOAL) });
  await row.getByText("Править", { exact: true }).click();
  const editing = page.getByRole("row").filter({ has: page.getByRole("button", { name: "Сохранить", exact: true }) });
  await editing.getByLabel("Узнать").fill("");
  await editing.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(editing.getByRole("alert")).toContainText("Нужны название, узнать и проверить");
  await expect(editing.getByLabel("Узнать")).toHaveValue("Как собрать");
  await editing.getByLabel("Проверить").fill("");
  await editing.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(editing.getByRole("alert")).toContainText("Нужны название, узнать и проверить");
  await expect(editing.getByLabel("Проверить")).toHaveValue("Отчёт есть");
});

test("узнать, проверить и срок сохраняются, строка снова становится текстом", async ({ page }) => {
  await page.goto(idpPath);
  const row = page.getByRole("row", { name: new RegExp(GOAL) });
  await row.getByText("Править", { exact: true }).click();
  const editing = page.getByRole("row").filter({ has: page.getByRole("button", { name: "Сохранить", exact: true }) });
  await editing.getByLabel("Узнать").fill("Новый способ");
  await editing.getByLabel("Проверить").fill("Сводка на месте");
  await editing.getByLabel("Срок").fill("2026-06-15");
  const posted = page.waitForResponse((response) => response.request().method() === "POST");
  await editing.getByRole("button", { name: "Сохранить", exact: true }).click();
  await posted;
  const saved = page.getByRole("row", { name: new RegExp(GOAL) });
  await expect(saved.getByText("Новый способ", { exact: true })).toBeVisible();
  await expect(saved.getByText("Сводка на месте", { exact: true })).toBeVisible();
  await expect(saved.getByText("15.06.2026", { exact: true })).toBeVisible();
  await expect(saved.getByRole("button", { name: "Править" })).toBeVisible();
  await saved.getByText("Править", { exact: true }).click();
  const restore = page.getByRole("row").filter({ has: page.getByRole("button", { name: "Сохранить", exact: true }) });
  await restore.getByLabel("Узнать").fill("Как собрать");
  await restore.getByLabel("Проверить").fill("Отчёт есть");
  await restore.getByLabel("Срок").fill("");
  const restored = page.waitForResponse((response) => response.request().method() === "POST");
  await restore.getByRole("button", { name: "Сохранить", exact: true }).click();
  await restored;
  await expect(page.getByRole("row", { name: new RegExp(GOAL) }).getByText("Как собрать", { exact: true })).toBeVisible();
});

test("сотрудник меняет статус строки, после перезагрузки он в колонке после срока", async ({ page }) => {
  await login(page, STAFF);
  await page.goto(idpPath);
  const row = page.getByRole("row", { name: new RegExp(GOAL) });
  await expect(row.getByRole("button", { name: "Править" })).toHaveCount(0);
  await expect(row.getByLabel("Название")).toHaveCount(0);
  await expect(row.getByLabel("Узнать")).toHaveCount(0);
  await expect(row.getByLabel("Проверить")).toHaveCount(0);
  await expect(row.getByLabel("Срок")).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Ок" })).toHaveCount(0);
  const posted = page.waitForResponse((response) => response.request().method() === "POST");
  await row.getByLabel("Статус").selectOption("in_progress");
  await posted;
  await expect(row.getByLabel("Статус")).toHaveValue("in_progress");
  await page.reload();
  const again = page.getByRole("row", { name: new RegExp(GOAL) });
  await expect(again.getByLabel("Статус")).toHaveValue("in_progress");
  const cells = again.getByRole("cell");
  await expect(cells.nth(5).getByLabel("Статус")).toHaveValue("in_progress");
  await expect(cells.nth(5)).not.toContainText("Статус");
  await expect(cells.nth(4).getByLabel("Статус")).toHaveCount(0);
});

test("подтверждение в своей колонке, без теста строка тоже подтверждается", async ({ page }) => {
  await page.goto(idpPath);
  const row = page.getByRole("row", { name: new RegExp(GOAL) });
  const confirm = row.getByRole("button", { name: "Подтвердить" });
  const neighbor = page.getByRole("button", { name: "Обновить доступные компетенции" });
  const confirmBox = await confirm.evaluate((node) => {
    const style = getComputedStyle(node);
    return { border: style.borderTopWidth, pad: style.paddingTop, color: style.color };
  });
  const neighborBox = await neighbor.evaluate((node) => {
    const style = getComputedStyle(node);
    return { border: style.borderTopWidth, pad: style.paddingTop, color: style.color };
  });
  expect(confirmBox.border).toBe(neighborBox.border);
  expect(confirmBox.pad).toBe(neighborBox.pad);
  expect(confirmBox.border).not.toBe("0px");
  expect(confirmBox.color).not.toBe(neighborBox.color);
  await confirm.click();
  const undo = row.getByRole("button", { name: "Снять подтверждение" });
  const undoBox = await undo.evaluate((node) => {
    const style = getComputedStyle(node);
    return { border: style.borderTopWidth, pad: style.paddingTop, color: style.color };
  });
  expect(undoBox.border).toBe(neighborBox.border);
  expect(undoBox.pad).toBe(neighborBox.pad);
  expect(undoBox.color).not.toBe(confirmBox.color);
  await expect(row.getByText("принято", { exact: true }).filter({ visible: true })).toHaveCount(1);
  const chip = row.getByText("принято", { exact: true });
  const undoPlace = await undo.boundingBox();
  const chipPlace = await chip.boundingBox();
  expect(undoPlace).not.toBeNull();
  expect(chipPlace).not.toBeNull();
  const undoMid = undoPlace!.y + undoPlace!.height / 2;
  const chipMid = chipPlace!.y + chipPlace!.height / 2;
  expect(Math.abs(undoMid - chipMid)).toBeLessThan(8);
  await expect(page.getByRole("heading", { name: "Добавить задание" })).toBeVisible();

  await login(page, STAFF);
  await page.goto(idpPath);
  const own = page.getByRole("row", { name: new RegExp(GOAL) });
  await expect(own.getByText("принято", { exact: true }).filter({ visible: true })).toHaveCount(1);
  await expect(own.getByLabel("Статус")).toHaveCount(0);
  await expect(own.getByRole("button", { name: "Подтвердить" })).toHaveCount(0);
});

test("чужой сотрудник не видит приёмку и правку", async ({ page }) => {
  await login(page, OTHER);
  await page.goto(idpPath);
  await expect(page.getByRole("button", { name: "Подтвердить" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Снять подтверждение" })).toHaveCount(0);
  await expect(page.getByLabel("Статус")).toHaveCount(0);
  await expect(page.getByText("Править", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Сохранить", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Добавить задание" })).toHaveCount(0);
});

test("после подтверждения единственной строки новое задание всё ещё добавляется", async ({ page }) => {
  await page.goto(idpPath);
  const add = page.locator("form", { has: page.getByRole("heading", { name: "Добавить задание" }) });
  await expect(add).toBeVisible();
  await add.getByLabel(/^Компетенция/).selectOption({ index: 1 });
  await add.getByLabel("Название (если новое)").fill("Второе задание");
  await add.getByLabel("Узнать").fill("Как проверить");
  await add.getByLabel("Проверить").fill("Есть результат");
  await add.getByRole("button", { name: "Добавить" }).click();
  await expect(page.getByRole("row", { name: /Второе задание/ })).toBeVisible();
  await expect(page.getByText("активен", { exact: true })).toBeVisible();
});
