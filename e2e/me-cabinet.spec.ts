import type { Page } from "@playwright/test";
import { expect, login, test } from "./fixtures";
import { E2E_ADMIN } from "./env";

// Шаги делят базу: админ заводит сотрудников, дальше входит сотрудник.
test.describe.configure({ mode: "serial" });

// Файл работает от админа: сессия одна на воркер (см. e2e/fixtures.ts).
test.use({ asAdmin: true });

const STAMP = Date.now();
const JUNIOR = { login: "e2e.cabinet", name: `Кабинет E2E ${STAMP}`, password: "e2e-cabinet-password" };
const NO_PROFILE = {
  login: "e2e.cabinet.noprofile",
  name: `Кабинет без профиля ${STAMP}`,
  password: "e2e-cabinet-password",
};

/** Заводит сотрудника на должность: кабинет открывают уже его учёткой. */
async function createStaff(
  page: Page,
  staff: { login: string; name: string; password: string },
  jobId: string,
) {
  await page.goto("/people");
  const form = page.locator("form", { has: page.getByRole("heading", { name: "Новый сотрудник" }) });
  await form.getByLabel("Логин").fill(staff.login);
  await form.getByLabel("Имя").fill(staff.name);
  await form.getByLabel("Пароль").fill(staff.password);
  await form.getByLabel(/^Должность/).selectOption(jobId);
  await form.getByLabel(/^Руководитель/).selectOption({ label: E2E_ADMIN.name });
  await form.getByRole("button", { name: "Создать" }).click();
  await expect(page.getByRole("link", { name: staff.name, exact: true })).toBeVisible();
}

test("шапка с должностью и статусом, карточки и колонка действий", async ({ page }) => {
  await createStaff(page, JUNIOR, "junior");
  await login(page, JUNIOR);
  const response = await page.goto("/me");
  expect(response?.status(), "кабинет сотрудника отвечает 200").toBe(200);

  // Шапка: имя, текущая должность ссылкой на профиль, статус учётки.
  await expect(page.getByRole("heading", { level: 1, name: JUNIOR.name })).toBeVisible();
  await expect(page.getByText("Текущая должность:", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Младший программист", exact: true })).toHaveAttribute(
    "href",
    "/jobs/junior/profile",
  );
  await expect(page.getByText("Активен", { exact: true })).toBeVisible();

  // Метаданные профиля в шапке: логин и дата изменения в ДД.ММ.ГГГГ.
  await expect(page.getByText("Логин", { exact: true })).toBeVisible();
  await expect(page.getByText(JUNIOR.login, { exact: true })).toBeVisible();
  await expect(page.getByText("Изменён", { exact: true })).toBeVisible();
  await expect(page.getByText(/^\d{2}\.\d{2}\.\d{4}$/)).toBeVisible();

  // Карточки основной колонки.
  for (const title of ["Должность", "Куда можно расти", "Мои пометки по компетенциям", "ИПР"]) {
    await expect(page.getByRole("heading", { level: 2, name: title })).toBeVisible();
  }

  // Действия собраны в правой колонке, а не абзацами в тексте.
  const actions = page.getByRole("navigation", { name: "Разделы кабинета" });
  await expect(actions.getByRole("link")).toHaveCount(4);
  await expect(actions.getByRole("link", { name: "Мои пометки" })).toHaveAttribute("href", "/me/marks");
  await expect(actions.getByRole("link", { name: "Дерево навыков" })).toHaveAttribute("href", "/me/skills");
  await expect(actions.getByRole("link", { name: "Достижения (0)" })).toHaveAttribute("href", "/me/achievements");
  await expect(actions.getByRole("link", { name: "Мой ИПР" })).toHaveAttribute("href", "/idps");
});

test("без активного ИПР карточка ведёт в раздел планов", async ({ page }) => {
  await login(page, JUNIOR);
  const response = await page.goto("/me");
  expect(response?.status(), "кабинет без активного ИПР отвечает 200").toBe(200);

  await expect(page.getByText("Активного плана нет", { exact: false })).toBeVisible();
  await expect(
    page.getByRole("article").getByRole("link", { name: "ИПР", exact: true }),
  ).toHaveAttribute("href", "/idps");
});

test("должность без профиля и переходов: пустые состояния вместо падения", async ({ page }) => {
  await createStaff(page, NO_PROFILE, "office-head");
  await login(page, NO_PROFILE);
  const response = await page.goto("/me");
  expect(response?.status(), "кабинет на должности без профиля отвечает 200").toBe(200);

  await expect(page.getByRole("link", { name: "Руководитель офиса", exact: true })).toHaveAttribute(
    "href",
    "/jobs/office-head",
  );
  await expect(page.getByRole("heading", { level: 2, name: "Куда можно расти" })).toBeVisible();
  await expect(page.getByText("Переходов нет", { exact: true })).toBeVisible();
  await expect(page.getByText("У должности нет профиля с навыками", { exact: false })).toBeVisible();
});

test("раскладка: от 1024px действия справа, на узком экране сразу после шапки", async ({ page }) => {
  await login(page, JUNIOR);
  const actions = () => page.getByRole("navigation", { name: "Разделы кабинета" });
  const main = () => page.locator(".cabinet-main");

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/me");
  const wide = { actions: await actions().boundingBox(), main: await main().boundingBox() };
  expect(wide.actions, "колонка действий на месте").not.toBeNull();
  expect(wide.main, "основная колонка на месте").not.toBeNull();
  // Две колонки: действия правее основной колонки и начинаются с той же строки.
  expect(wide.actions!.x).toBeGreaterThan(wide.main!.x + wide.main!.width - 1);
  expect(Math.abs(wide.actions!.y - wide.main!.y)).toBeLessThan(40);

  await page.setViewportSize({ width: 900, height: 1000 });
  await page.reload();
  const narrow = { actions: await actions().boundingBox(), main: await main().boundingBox() };
  // Одна колонка: действия идут выше основной колонки во всю её ширину.
  expect(narrow.actions!.y).toBeLessThan(narrow.main!.y);
  expect(narrow.actions!.width).toBeGreaterThan(narrow.main!.width - 1);
});

test.describe("гость", () => {
  // Гостевые проверки идут без cookie админа (см. e2e/fixtures.ts).
  test.use({ asAdmin: false });

  test("кабинет закрыт: ни имени, ни статуса, ни метаданных", async ({ page }) => {
    await page.goto("/me");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { level: 1, name: JUNIOR.name })).toHaveCount(0);
    await expect(page.getByText("Активен", { exact: true })).toHaveCount(0);
    await expect(page.getByText(JUNIOR.login, { exact: true })).toHaveCount(0);
  });
});
