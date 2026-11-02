import type { Page } from "@playwright/test";
import { expect, login, test } from "./fixtures";

test.describe.configure({ mode: "serial" });

// Файл работает от админа: сессия одна на воркер (см. e2e/fixtures.ts).
test.use({ asAdmin: true });

const STAMP = Date.now();
const OWN = `e2ecmp${STAMP}`;
const OTHER = `e2eother${STAMP}`;
const EMPTY = `e2eempty${STAMP}`;
const OWN_NAME = `Компетенция заданий ${STAMP}`;
const OTHER_NAME = `Чужая компетенция ${STAMP}`;
const EMPTY_NAME = `Пустая компетенция ${STAMP}`;
const VISIBLE = `Открытое задание ${STAMP}`;
const HIDDEN = `Скрытое задание ${STAMP}`;
const FOREIGN = `Чужое задание ${STAMP}`;
const PLAIN = { login: `e2e.cmp.${STAMP}`, name: `Не админ ${STAMP}`, password: "e2e-cmp-password" };

let ownPath = "";

async function createCompetency(page: Page, id: string, name: string) {
  await page.goto("/admin/competencies/new");
  const form = page.locator("form", { has: page.getByRole("button", { name: "Создать" }) });
  await form.getByLabel("Идентификатор").fill(id);
  await form.getByLabel("Название").fill(name);
  await form.getByRole("button", { name: "Создать" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return new URL(page.url()).pathname;
}

async function createAssignment(page: Page, competencyId: string, name: string) {
  await page.goto("/assignments/new");
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Создать" }) });
  await form.getByLabel(/^Компетенция/).selectOption(competencyId);
  await form.getByLabel(/^Название/).fill(name);
  await form.getByLabel(/^Узнать/).fill("Узнать");
  await form.getByLabel(/^Проверить/).fill("Проверить");
  await form.getByRole("button", { name: "Создать" }).click();
  await expect(page).toHaveURL(/\/assignments\/asg/);
  return new URL(page.url()).pathname;
}

function assignmentList(page: Page) {
  return page.getByRole("region", { name: "Задания" });
}

test("на карточке оба задания, скрытое помечено, ссылка открывает карточку", async ({ page }) => {
  ownPath = await createCompetency(page, OWN, OWN_NAME);
  await createCompetency(page, OTHER, OTHER_NAME);
  await createCompetency(page, EMPTY, EMPTY_NAME);
  await createAssignment(page, OWN, VISIBLE);
  const hiddenPath = await createAssignment(page, OWN, HIDDEN);
  await page.goto(hiddenPath);
  await page.getByRole("button", { name: "Перенести в архив" }).click();
  await expect(page.getByRole("button", { name: "Вернуть" })).toBeVisible();
  await createAssignment(page, OTHER, FOREIGN);

  await page.goto(ownPath);
  const list = assignmentList(page);
  await expect(list.getByRole("link", { name: VISIBLE, exact: true })).toBeVisible();
  const hidden = list.getByRole("listitem").filter({ hasText: HIDDEN });
  await expect(hidden).toContainText("скрыто");
  await list.getByRole("link", { name: VISIBLE, exact: true }).click();
  await expect(page).toHaveURL(/\/assignments\/asg/);
  await expect(page.getByRole("heading", { level: 1, name: VISIBLE })).toBeVisible();
});

test("задание другой компетенции в списке нет", async ({ page }) => {
  await page.goto(ownPath);
  await expect(assignmentList(page).getByText(FOREIGN)).toHaveCount(0);
});

test("без заданий видна пустая подпись", async ({ page }) => {
  await page.goto(`/admin/competencies/${EMPTY}`);
  const list = assignmentList(page);
  await expect(list.getByText("Заданий ещё нет")).toBeVisible();
  await expect(list.getByText(VISIBLE)).toHaveCount(0);
  await expect(list.getByText(FOREIGN)).toHaveCount(0);
});

test("не админ карточку компетенции не открывает", async ({ page }) => {
  await page.goto("/people");
  const person = page.locator("form", { has: page.getByRole("heading", { name: "Новый сотрудник" }) });
  await person.getByLabel("Логин").fill(PLAIN.login);
  await person.getByLabel("Имя").fill(PLAIN.name);
  await person.getByLabel("Пароль").fill(PLAIN.password);
  await person.getByLabel(/^Должность/).selectOption("junior");
  await person.getByRole("button", { name: "Создать" }).click();
  await expect(page.getByRole("link", { name: PLAIN.name, exact: true })).toBeVisible();

  await login(page, PLAIN);
  await page.goto(ownPath);
  await expect(page).toHaveURL(/\/me$/);
  await expect(page.getByRole("region", { name: "Задания" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: VISIBLE, exact: true })).toHaveCount(0);
});
