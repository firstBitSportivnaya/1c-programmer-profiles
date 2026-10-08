import { expect, test, type Page } from "@playwright/test";
import { E2E_ADMIN } from "./env";

// Файл идёт после session.spec.ts (алфавит, один воркер): админ там уже создан.
// Шаги делят базу: админ заводит сотрудника и ИПР, дальше входит сотрудник.
test.describe.configure({ mode: "serial" });

const JUNIOR = { login: "e2e.junior", name: "Младший E2E", password: "e2e-junior-password" };

async function login(page: Page, account: { login: string; password: string }) {
  await page.goto("/login");
  const form = page.locator('form:has(input[name="intent"][value="login"])');
  await form.getByLabel("Логин").fill(account.login);
  await form.getByLabel("Пароль", { exact: true }).fill(account.password);
  await form.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/me$/);
}

function markRow(page: Page, competency: string) {
  return page.locator("li", { has: page.getByLabel(`Пометка: ${competency}`) });
}

async function submitMark(page: Page, competency: string) {
  const row = markRow(page, competency);
  await row.getByRole("button", { name: "Ок" }).click();
  await expect(row.getByText("Сохраняем…")).toHaveCount(0);
}

test("админ заводит сотрудника на младшего программиста и ИПР на программиста", async ({ page }) => {
  await login(page, E2E_ADMIN);

  await page.goto("/people");
  const form = page.locator("form", { has: page.getByRole("heading", { name: "Новый сотрудник" }) });
  await form.getByLabel("Логин").fill(JUNIOR.login);
  await form.getByLabel("Имя").fill(JUNIOR.name);
  await form.getByLabel("Пароль").fill(JUNIOR.password);
  // В подпись <select> внутри <label> попадает текст вариантов, поэтому подпись сверяется с началом строки.
  await form.getByLabel(/^Должность/).selectOption("junior");
  await form.getByLabel(/^Руководитель/).selectOption({ label: E2E_ADMIN.name });
  await form.getByRole("button", { name: "Создать" }).click();
  await expect(page.getByRole("link", { name: JUNIOR.name, exact: true })).toBeVisible();

  await page.goto("/idps");
  await page.getByLabel(/^Сотрудник/).selectOption({ label: JUNIOR.name });
  await page.getByLabel(/^Цель/).selectOption("programmer");
  await page.getByLabel("Начало").fill("2026-01-01");
  await page.getByLabel("Конец").fill("2026-12-31");
  await page.getByRole("button", { name: "Создать" }).click();
  await expect(page.getByText(`${JUNIOR.name} · создал ${E2E_ADMIN.name}`)).toBeVisible();
});

test("сотрудник видит навыки своей должности и цели ИПР, без обязанностей", async ({ page }) => {
  await login(page, JUNIOR);

  await expect(page.getByRole("heading", { level: 2, name: "Мои пометки" })).toBeVisible();
  await expect(page.getByLabel("Пометка: Обучаемость")).toHaveValue("");
  await expect(markRow(page, "Обучаемость").getByText("цель ИПР")).toHaveCount(0);
  await expect(markRow(page, "Автоматизированное тестирование").getByText("цель ИПР")).toBeVisible();
  await expect(page.getByLabel("Пометка: Алгоритмизация поставленных задач (A/01.3)")).toHaveCount(0);
  for (const option of ["не отмечено", "есть", "нет", "в процессе"]) {
    await expect(page.getByLabel("Пометка: Обучаемость").locator("option", { hasText: option })).toHaveCount(1);
  }
});

test("пометка сохраняется и не меняет должность и ИПР", async ({ page }) => {
  await login(page, JUNIOR);

  await page.getByLabel("Пометка: Обучаемость").selectOption("has");
  await submitMark(page, "Обучаемость");
  await page.getByLabel("Пометка: Автоматизированное тестирование").selectOption("in_progress");
  await submitMark(page, "Автоматизированное тестирование");

  await page.reload();
  await expect(page.getByLabel("Пометка: Обучаемость")).toHaveValue("has");
  await expect(page.getByLabel("Пометка: Автоматизированное тестирование")).toHaveValue("in_progress");
  await expect(page.getByRole("link", { name: "Младший программист", exact: true })).toBeVisible();
  await expect(page.getByText("принято 0 из 0")).toBeVisible();
});

test("недопустимый статус и чужая компетенция — ошибка, пометка не меняется", async ({ page }) => {
  await login(page, JUNIOR);
  const row = markRow(page, "Обучаемость");

  await row.locator("select").evaluate((select: HTMLSelectElement) => {
    select.add(new Option("подделка", "bogus"));
    select.value = "bogus";
  });
  await row.getByRole("button", { name: "Ок" }).click();
  await expect(row.getByRole("alert")).toHaveText("Пометка: есть, нет или в процессе");

  await row.locator('input[name="competencyId"]').evaluate((input: HTMLInputElement) => {
    input.value = "no-such-competency";
  });
  await row.locator("select").selectOption("lacks");
  await row.getByRole("button", { name: "Ок" }).click();
  await expect(row.getByRole("alert")).toHaveText("Пометить можно только навык своей должности или цели ИПР");

  await page.reload();
  await expect(page.getByLabel("Пометка: Обучаемость")).toHaveValue("has");
});

test("руководитель-админ и гость пометок сотрудника не видят", async ({ page }) => {
  await login(page, E2E_ADMIN);
  await page.goto("/people");
  await page.getByRole("link", { name: JUNIOR.name, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: JUNIOR.name })).toBeVisible();
  await expect(page.getByText("Мои пометки")).toHaveCount(0);
  await expect(page.getByLabel(/^Пометка:/)).toHaveCount(0);

  await page.getByRole("button", { name: "Выйти" }).click();
  await page.goto("/jobs/junior/profile");
  await expect(page.getByLabel(/^Пометка:/)).toHaveCount(0);
  await page.goto("/me");
  await expect(page).toHaveURL(/\/login$/);
});
