import type { Page } from "@playwright/test";
import { expect, login, test } from "./fixtures";

test.describe.configure({ mode: "serial" });

// Файл работает от админа: сессия одна на воркер (см. e2e/fixtures.ts).
test.use({ asAdmin: true });

const STAMP = Date.now();
const STAFF = { login: `e2e.pool.${STAMP}`, name: `Пул ${STAMP}`, password: "e2e-pool-password" };
const ROW = `Строка пула ${STAMP}`;
const BUTTON = "Обновить доступные компетенции";
let idpPath = "";
let freshName = "";

function addForm(page: Page) {
  return page.locator("form", { has: page.getByRole("heading", { name: "Добавить задание" }) });
}

test("на карточке кнопка про доступные компетенции", async ({ page }) => {
  await page.goto("/people");
  const person = page.locator("form", { has: page.getByRole("heading", { name: "Новый сотрудник" }) });
  await person.getByLabel("Логин").fill(STAFF.login);
  await person.getByLabel("Имя").fill(STAFF.name);
  await person.getByLabel("Пароль").fill(STAFF.password);
  await person.getByLabel(/^Должность/).selectOption("junior");
  await person.getByRole("button", { name: "Создать" }).click();
  await expect(page.getByRole("link", { name: STAFF.name, exact: true })).toBeVisible();

  await page.goto("/idps");
  await page.getByLabel(/^Сотрудник/).selectOption({ label: STAFF.name });
  await page.getByLabel(/^Цель/).selectOption("programmer");
  await page.getByLabel("Начало").fill("2026-03-01");
  await page.getByLabel("Конец").fill("2026-09-30");
  await page.getByRole("button", { name: "Создать" }).click();
  await page.locator("li", { hasText: STAFF.name }).getByRole("link", { name: "Младший программист → Программист" }).click();
  idpPath = new URL(page.url()).pathname;

  await expect(page.getByRole("button", { name: BUTTON })).toBeVisible();
  await expect(page.getByRole("button", { name: "Обновить разрыв" })).toHaveCount(0);
  await expect(page.getByText("Обновить разрыв")).toHaveCount(0);
});

test("кнопка дописывает новую компетенцию и не трогает строки", async ({ page }) => {
  await page.goto(idpPath);
  const add = addForm(page);
  await add.getByLabel("Название (если новое)").fill(ROW);
  await add.getByLabel("Узнать").fill("Узнать пул");
  await add.getByLabel(/^Проверить/).fill("Проверить пул");
  await add.getByRole("button", { name: "Добавить" }).click();
  await expect(page.getByRole("row", { name: new RegExp(ROW) })).toBeVisible();

  freshName = `Пул компетенции ${STAMP}`;
  await page.goto("/admin/competencies/new");
  const competency = page.locator("form", { has: page.getByRole("button", { name: "Создать" }) });
  await competency.getByLabel("Идентификатор").fill(`e2epool${STAMP}`);
  await competency.getByLabel("Название").fill(freshName);
  await competency.getByLabel(/^Тип/).selectOption("professional");
  await competency.getByRole("button", { name: "Создать" }).click();
  await expect(page.getByRole("heading", { name: freshName })).toBeVisible();

  await page.goto("/jobs/programmer/profile");
  const tech = page.locator("section", { has: page.getByRole("heading", { name: "Технические навыки" }) });
  const skill = tech.locator("form", { has: page.getByRole("button", { name: "Добавить" }) });
  await skill.locator('select[name="competencyId"]').selectOption({ label: freshName });
  await skill.locator('select[name="level"]').selectOption("1");
  await skill.getByRole("button", { name: "Добавить" }).click();
  await expect(tech.getByText(freshName, { exact: true })).toBeVisible();

  await page.goto(idpPath);
  const pool = addForm(page).getByLabel(/^Компетенция/);
  await expect(pool.locator("option", { hasText: freshName })).toHaveCount(0);
  await page.getByRole("button", { name: BUTTON }).click();
  await expect(pool.locator("option", { hasText: freshName })).toHaveCount(1);
  await expect(page.getByRole("row", { name: new RegExp(ROW) })).toBeVisible();
});

test("сотрудник плана кнопку не видит и пул не меняет", async ({ page }) => {
  await page.goto(idpPath);
  const before = await addForm(page).getByLabel(/^Компетенция/).locator("option").allInnerTexts();

  await login(page, STAFF);
  await page.goto(idpPath);
  await expect(page.getByRole("button", { name: BUTTON })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Обновить разрыв" })).toHaveCount(0);

  // Пул снова смотрит админ: сотрудник форму добавления не видит.
  await login(page);
  await page.goto(idpPath);
  await expect(addForm(page).getByLabel(/^Компетенция/).locator("option")).toHaveText(before);
});
