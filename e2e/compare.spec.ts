import { expect, test, type Page } from "@playwright/test";

const GROUPS = ["Технические навыки", "Личные навыки", "Функциональные обязанности"];

function group(page: Page, title: string) {
  return page.locator("table.compare-table tbody").filter({ has: page.getByRole("rowheader", { name: title }) });
}

async function competencyNames(page: Page, title: string) {
  return group(page, title).locator("tr[data-change] td:first-child").allInnerTexts();
}

test("сравнение разбито на три группы профиля в том же порядке", async ({ page }) => {
  await page.goto("/compare?a=junior&b=programmer");
  await expect(page.locator("table.compare-table")).toHaveCount(1);
  await expect(page.locator("tr.compare-group th")).toHaveText(GROUPS);
});

test("компетенция попадает в группу своего типа, внутри группы — по алфавиту", async ({ page }) => {
  await page.goto("/compare?a=junior&b=programmer");
  await expect(group(page, "Функциональные обязанности")).toContainText("Алгоритмизация поставленных задач (A/01.3)");
  await expect(group(page, "Технические навыки")).not.toContainText("Алгоритмизация поставленных задач (A/01.3)");
  await expect(group(page, "Технические навыки")).toContainText("Навыки программирования на языке 1С");
  await expect(group(page, "Личные навыки")).toContainText("Обучаемость");

  for (const title of GROUPS) {
    const names = await competencyNames(page, title);
    expect(names.length).toBeGreaterThan(0);
    expect(names).toEqual([...names].sort((x, y) => x.localeCompare(y, "ru")));
  }
});

test("строки без изменений остаются в своих группах", async ({ page }) => {
  await page.goto("/compare?a=junior&b=junior");
  for (const title of GROUPS) {
    await expect(group(page, title).locator('tr[data-change="same"]').first()).toBeVisible();
    await expect(group(page, title)).not.toContainText("Отличий нет");
  }
  await expect(page.locator("tr[data-change]:not([data-change='same'])")).toHaveCount(0);
});

test("должность без профиля не сравнивается", async ({ page }) => {
  await page.goto("/compare?a=consultant&b=junior");
  await expect(page.getByText("Сравнивать можно только должности с заполненным профилем.")).toBeVisible();
  await expect(page.locator("table.compare-table")).toHaveCount(0);
});
