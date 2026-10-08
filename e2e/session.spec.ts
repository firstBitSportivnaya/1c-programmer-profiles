import { expect, test, type Page } from "@playwright/test";
import { E2E_ADMIN, E2E_ADMIN_PASSWORD } from "./env";

const ADMIN = E2E_ADMIN;

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

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  const form = loginForm(page);
  await form.getByLabel("Логин").fill(ADMIN.login);
  await form.getByLabel("Пароль", { exact: true }).fill(ADMIN.password);
  await form.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/me$/);
}

test("админ входит учёткой и видит раздел компетенций", async ({ page }) => {
  await loginAsAdmin(page);
  await expect(page.getByRole("link", { name: "Компетенции" })).toBeVisible();
});

test("из кабинета должность открывается сразу профилем, админ правит её там же", async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole("link", { name: "Руководитель команды разработки" }).click();

  await expect(page).toHaveURL(/\/jobs\/team-lead\/profile$/);
  await expect(page.getByRole("heading", { level: 1, name: "Руководитель команды разработки" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Технические навыки" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Правка должности" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Добавить ребро" })).toBeVisible();
});

test("из карточки сотрудника и ИПР должность открывается сразу профилем", async ({ page }) => {
  const person = { login: "e2e.links", name: "Сотрудник ссылок E2E", password: "e2e-links-password" };
  await loginAsAdmin(page);

  await page.goto("/people");
  const form = page.locator("form", { has: page.getByRole("heading", { name: "Новый сотрудник" }) });
  await form.getByLabel("Логин").fill(person.login);
  await form.getByLabel("Имя").fill(person.name);
  await form.getByLabel("Пароль").fill(person.password);
  // В подпись <select> внутри <label> попадает текст вариантов, поэтому подпись сверяется с началом строки.
  await form.getByLabel(/^Должность/).selectOption("junior");
  await form.getByLabel(/^Руководитель/).selectOption({ label: ADMIN.name });
  await form.getByRole("button", { name: "Создать" }).click();

  await page.getByRole("link", { name: person.name, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: person.name })).toBeVisible();
  await expect(page.getByRole("link", { name: "Младший программист", exact: true })).toHaveAttribute(
    "href",
    "/jobs/junior/profile",
  );

  await page.goto("/idps");
  await page.getByLabel(/^Сотрудник/).selectOption({ label: person.name });
  await page.getByLabel(/^Цель/).selectOption("programmer");
  await page.getByLabel("Начало").fill("2026-01-01");
  await page.getByLabel("Конец").fill("2026-12-31");
  await page.getByRole("button", { name: "Создать" }).click();
  await page.locator("li", { hasText: person.name }).getByRole("link", { name: "Младший программист → Программист" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "ИПР: Программист" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Младший программист", exact: true })).toHaveAttribute(
    "href",
    "/jobs/junior/profile",
  );
  await expect(page.getByRole("link", { name: "Программист", exact: true })).toHaveAttribute(
    "href",
    "/jobs/programmer/profile",
  );
});

test("админ на должности без профиля видит создание пустого профиля", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/jobs/consultant");
  await expect(page.getByRole("button", { name: "Создать пустой профиль" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Правка должности" })).toBeVisible();
});

test("сравнение двух пустых профилей: в каждой группе «Отличий нет»", async ({ page }) => {
  await loginAsAdmin(page);
  for (const jobId of ["mentor", "devops"]) {
    await page.goto(`/jobs/${jobId}`);
    await page.getByRole("button", { name: "Создать пустой профиль" }).click();
    await expect(page.getByRole("button", { name: "Создать пустой профиль" })).toHaveCount(0);
  }

  await page.goto("/compare?a=mentor&b=devops");
  await expect(page.locator("tr.compare-group th")).toHaveText([
    "Технические навыки",
    "Личные навыки",
    "Функциональные обязанности",
  ]);
  await expect(page.locator("table.compare-table tbody").getByText("Отличий нет")).toHaveCount(3);
  await expect(page.locator("tr[data-change]")).toHaveCount(0);
});
