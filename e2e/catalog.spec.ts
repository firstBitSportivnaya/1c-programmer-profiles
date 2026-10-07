import { expect, test } from "@playwright/test";

test("гость видит схему, ссылки на семь заполненных профилей ведут сразу на профиль", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Схема развития" })).toBeVisible();
  await expect(page.locator("a.job-card[href$='/profile']")).toHaveCount(7);
  await expect(page.locator("ul a[href$='/profile']")).toHaveCount(7);
  await expect(page.locator("a.job-card[href='/jobs/consultant']")).toHaveCount(1);
  await expect(page.locator("ul a[href='/jobs/consultant']")).toHaveCount(1);
});

test("должность с профилем — одна страница: сведения, следующие должности и три блока", async ({ page }) => {
  await page.goto("/jobs/junior/profile");
  await expect(page.getByRole("heading", { level: 1, name: "Младший программист" })).toBeVisible();
  for (const term of ["Ветка", "Требуемый опыт, лет", "Профстандарт"]) {
    await expect(page.getByRole("term").filter({ hasText: term })).toBeVisible();
  }
  await expect(page.getByRole("heading", { level: 2, name: "Следующие должности" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Программист", exact: true })).toHaveAttribute(
    "href",
    "/jobs/programmer/profile",
  );
  for (const section of ["Технические навыки", "Личные навыки", "Функциональные обязанности"]) {
    await expect(page.getByRole("heading", { level: 2, name: section })).toBeVisible();
  }
  await expect(page.getByText("Алгоритмизация поставленных задач (A/01.3)")).toBeVisible();
  await expect(page.getByRole("link", { name: /←/ })).toHaveCount(0);
});

test("адрес должности с профилем сразу открывает профиль", async ({ page }) => {
  await page.goto("/jobs/junior");
  await expect(page).toHaveURL(/\/jobs\/junior\/profile$/);
  await expect(page.getByRole("heading", { level: 1, name: "Младший программист" })).toBeVisible();
});

test("должность без профиля остаётся карточкой, гость не создаёт профиль", async ({ page }) => {
  await page.goto("/jobs/consultant");
  await expect(page).toHaveURL(/\/jobs\/consultant$/);
  await expect(page.getByRole("heading", { level: 1, name: "Программист-консультант" })).toBeVisible();
  await expect(page.getByText("Профиль не заполнен.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Создать пустой профиль" })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 2, name: "Правка должности" })).toHaveCount(0);

  await page.goto("/jobs/consultant/profile");
  await expect(page).toHaveURL(/\/jobs\/consultant$/);
});

test("гость не видит правку должности на странице профиля", async ({ page }) => {
  await page.goto("/jobs/junior/profile");
  await expect(page.getByRole("heading", { level: 2, name: "Правка должности" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Добавить ребро" })).toHaveCount(0);
});

test("несуществующая должность — 404", async ({ page }) => {
  const response = await page.goto("/jobs/no-such-job");
  expect(response?.status()).toBe(404);
});
