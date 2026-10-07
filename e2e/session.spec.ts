import { expect, test, type Page } from "@playwright/test";
import { E2E_ADMIN_PASSWORD } from "./env";

const ADMIN = { login: "e2e.admin", name: "Админ E2E", password: "e2e-account-password" };

// Шаги идут по одной базе: первый админ создаётся один раз, дальше вход его учёткой.
test.describe.configure({ mode: "serial" });

function bootstrapForm(page: Page) {
  return page.locator("#bootstrap-admin");
}

function loginForm(page: Page) {
  return page.locator('form:has(input[name="intent"][value="login"])');
}

async function fillBootstrap(page: Page, envPassword: string) {
  const form = bootstrapForm(page);
  await form.getByLabel("Пароль из .env.local").fill(envPassword);
  await form.getByLabel("Логин").fill(ADMIN.login);
  await form.getByLabel("Имя").fill(ADMIN.name);
  await form.getByLabel("Должность").selectOption("team-lead");
  await form.getByLabel("Пароль учётки").fill(ADMIN.password);
  await form.getByRole("button", { name: "Создать первого админа" }).click();
}

test("кабинет без входа отправляет на страницу входа", async ({ page }) => {
  await page.goto("/me");
  await expect(page).toHaveURL(/\/login$/);
});

test("неверный пароль из окружения не создаёт админа", async ({ page }) => {
  await page.goto("/login");
  await fillBootstrap(page, "wrong-env-password");

  await expect(page.getByRole("alert")).toHaveText("Неверный пароль из окружения");
  await expect(bootstrapForm(page)).toBeVisible();
});

test("первый админ создаётся паролем из окружения и выходит", async ({ page }) => {
  await page.goto("/login");
  await fillBootstrap(page, E2E_ADMIN_PASSWORD);

  await expect(page).toHaveURL(/\/me$/);
  await expect(page.getByRole("heading", { level: 1, name: ADMIN.name })).toBeVisible();

  await page.getByRole("button", { name: "Выйти" }).click();
  await expect(page.getByRole("link", { name: "Войти" })).toBeVisible();
});

test("после первого админа форма bootstrap не показывается", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByText("Админ уже создан")).toBeVisible();
  await expect(bootstrapForm(page)).toHaveCount(0);
});

test("неверный пароль учётки — ошибка на странице входа", async ({ page }) => {
  await page.goto("/login");
  const form = loginForm(page);
  await form.getByLabel("Логин").fill(ADMIN.login);
  await form.getByLabel("Пароль", { exact: true }).fill("wrong-password");
  await form.getByRole("button", { name: "Войти" }).click();

  await expect(page.getByRole("alert")).toHaveText("Неверный логин или пароль");
});

test("админ входит учёткой и видит раздел компетенций", async ({ page }) => {
  await page.goto("/login");
  const form = loginForm(page);
  await form.getByLabel("Логин").fill(ADMIN.login);
  await form.getByLabel("Пароль", { exact: true }).fill(ADMIN.password);
  await form.getByRole("button", { name: "Войти" }).click();

  await expect(page).toHaveURL(/\/me$/);
  await expect(page.getByRole("link", { name: "Компетенции" })).toBeVisible();
});
