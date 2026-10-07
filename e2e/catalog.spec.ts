import { expect, test } from "@playwright/test";

test("гость видит схему и семь заполненных профилей", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Схема развития" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Профиль", exact: true })).toHaveCount(7);
});

test("гость открывает профиль младшего программиста с карточки должности", async ({ page }) => {
  await page.goto("/jobs/junior");
  await expect(page.getByRole("heading", { level: 1, name: "Младший программист" })).toBeVisible();
  await page.getByRole("link", { name: "Открыть профиль" }).click();

  await expect(page).toHaveURL(/\/jobs\/junior\/profile$/);
  await expect(page.getByRole("heading", { level: 1, name: "Профиль: Младший программист" })).toBeVisible();
  for (const section of ["Технические навыки", "Личные навыки", "Функциональные обязанности"]) {
    await expect(page.getByRole("heading", { level: 2, name: section })).toBeVisible();
  }
  await expect(page.getByText("Алгоритмизация поставленных задач (A/01.3)")).toBeVisible();
});

test("несуществующая должность — 404", async ({ page }) => {
  const response = await page.goto("/jobs/no-such-job");
  expect(response?.status()).toBe(404);
});
