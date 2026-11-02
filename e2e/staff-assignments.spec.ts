import type { Page } from "@playwright/test";
import { expect, login, test } from "./fixtures";
import { E2E_ADMIN } from "./env";

test.describe.configure({ mode: "serial" });

// Файл работает от админа: сессия одна на воркер (см. e2e/fixtures.ts).
test.use({ asAdmin: true });

const STAMP = Date.now();
const NAME = `E2E задание ${STAMP}`;
const LEARN = `Узнать ${STAMP}`;
const VERIFY = `Проверить ${STAMP}`;
const PLAIN = { login: `e2e.no-reports.${STAMP}`, name: `Без подчинённых ${STAMP}`, password: "e2e-plain-password" };
let cardPath = "";

async function fillCreate(page: Page, name: string, learn: string, verify: string) {
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Создать" }) });
  await form.getByLabel(/^Компетенция/).selectOption({ index: 0 });
  await form.getByLabel(/^Название/).fill(name);
  await form.getByLabel(/^Узнать/).fill(learn);
  await form.getByLabel(/^Проверить/).fill(verify);
  return form;
}

test("создание открывает карточку, и ссылка есть в списке", async ({ page }) => {
  await page.goto("/assignments");
  await page.getByRole("link", { name: "Новое задание" }).click();
  await expect(page).toHaveURL(/\/assignments\/new$/);
  const form = await fillCreate(page, NAME, LEARN, VERIFY);
  const competencyId = await form.getByLabel(/^Компетенция/).inputValue();
  await form.getByRole("button", { name: "Создать" }).click();
  await expect(page).toHaveURL(/\/assignments\/asg/);
  await expect(page.getByRole("heading", { level: 1, name: NAME })).toBeVisible();
  cardPath = page.url();
  await page.getByRole("link", { name: "← Все задания" }).click();
  await expect(page.getByRole("link", { name: NAME, exact: true })).toBeVisible();
  await expect(page.locator("li", { has: page.getByRole("link", { name: NAME, exact: true }) })).toContainText("ур. 1");

  await page.getByRole("link", { name: "Новое задание" }).click();
  const second = page.locator("form").filter({ has: page.getByRole("button", { name: "Создать" }) });
  const otherId = await second.getByLabel(/^Компетенция/).evaluate((select, current) => {
    if (!(select instanceof HTMLSelectElement)) return "";
    return [...select.options].map((option) => option.value).find((value) => value !== current) ?? "";
  }, competencyId);
  if (!otherId) throw new Error("нет второй компетенции");
  await second.getByLabel(/^Компетенция/).selectOption(otherId);
  const otherAssignment = `E2E фильтр ${STAMP}`;
  await second.getByLabel(/^Название/).fill(otherAssignment);
  await second.getByLabel(/^Узнать/).fill(LEARN);
  await second.getByLabel(/^Проверить/).fill(VERIFY);
  await second.getByRole("button", { name: "Создать" }).click();
  await expect(page).toHaveURL(/\/assignments\/asg/);
  await page.getByRole("link", { name: "← Все задания" }).click();

  const filter = page.getByLabel("Фильтр компетенции");
  await filter.selectOption(otherId);
  await page.getByRole("button", { name: "Показать" }).click();
  await expect(page.getByRole("link", { name: NAME, exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: otherAssignment, exact: true })).toBeVisible();
  await filter.selectOption(competencyId);
  await page.getByRole("button", { name: "Показать" }).click();
  await expect(page.getByRole("link", { name: NAME, exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: otherAssignment, exact: true })).toHaveCount(0);
  await filter.selectOption("");
  await page.getByRole("button", { name: "Показать" }).click();
  await expect(page.getByRole("link", { name: NAME, exact: true })).toBeVisible();
});

test("правка названия, узнать и проверить сохраняется, компетенция та же", async ({ page }) => {
  await page.goto(cardPath);
  const competency = await page.getByLabel(/^Компетенция/).inputValue();
  const nextName = `${NAME} правка`;
  const nextLearn = `${LEARN} правка`;
  const nextVerify = `${VERIFY} правка`;
  await page.getByLabel(/^Название/).fill(nextName);
  await page.getByLabel(/^Узнать/).fill(nextLearn);
  await page.getByLabel(/^Проверить/).fill(nextVerify);
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST"),
    page.getByRole("button", { name: "Сохранить", exact: true }).click(),
  ]);
  await page.reload();
  await expect(page.getByLabel(/^Название/)).toHaveValue(nextName);
  await expect(page.getByLabel(/^Узнать/)).toHaveValue(nextLearn);
  await expect(page.getByLabel(/^Проверить/)).toHaveValue(nextVerify);
  await expect(page.getByLabel(/^Компетенция/)).toHaveValue(competency);
});

test("скрытие убирает форму правки, возврат её возвращает", async ({ page }) => {
  await page.goto(cardPath);
  const edited = `${NAME} правка`;
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST"),
    page.getByRole("button", { name: "Перенести в архив" }).click(),
  ]);
  await page.reload();
  await expect(page.getByLabel(/^Название/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Вернуть" })).toBeVisible();
  await page.goto("/assignments");
  const row = page.locator("li").filter({ has: page.getByRole("link", { name: edited, exact: true }) });
  await expect(row).toContainText("скрыто");
  await page.getByRole("link", { name: edited, exact: true }).click();
  await expect(page.getByRole("button", { name: "Вернуть" })).toBeVisible();
  await Promise.all([
    page.waitForResponse(
      (response) => response.request().method() === "POST" && response.url().includes("/assignments/"),
    ),
    page.getByRole("button", { name: "Вернуть" }).click(),
  ]);
  await expect(page.getByLabel(/^Название/)).toBeVisible();
});

test("сотрудник без подчинённых уходит на ИПР и задание не меняется", async ({ page }) => {
  await page.goto("/people");
  const create = page.locator("form").filter({ has: page.getByRole("heading", { name: "Новый сотрудник" }) });
  await create.getByLabel("Логин").fill(PLAIN.login);
  await create.getByLabel("Имя").fill(PLAIN.name);
  await create.getByLabel("Пароль").fill(PLAIN.password);
  await create.getByLabel(/^Админ/).selectOption("");
  await create.getByRole("button", { name: "Создать" }).click();
  await page.goto(cardPath);
  const name = await page.getByLabel(/^Название/).inputValue();
  const learn = await page.getByLabel(/^Узнать/).inputValue();
  await page.getByRole("button", { name: "Выйти" }).click();
  await login(page, PLAIN);
  await page.goto("/assignments");
  await expect(page).toHaveURL(/\/idps$/);
  await page.goto("/assignments/new");
  await expect(page).toHaveURL(/\/idps$/);
  await page.goto(cardPath);
  await expect(page).toHaveURL(/\/idps$/);
  await page.getByRole("button", { name: "Выйти" }).click();
  await login(page, E2E_ADMIN);
  await page.goto(cardPath);
  await expect(page.getByLabel(/^Название/)).toHaveValue(name);
  await expect(page.getByLabel(/^Узнать/)).toHaveValue(learn);
});

test("пустые название, узнать или проверить не пишут строку", async ({ page }) => {
  await page.goto("/assignments/new");
  const missing = `E2E пустое ${STAMP}`;
  const form = await fillCreate(page, missing, "", VERIFY);
  await form.getByRole("button", { name: "Создать" }).click();
  await expect(form.getByRole("alert")).toHaveText("Нужны название, узнать и проверить");
  await page.goto("/assignments");
  await expect(page.getByRole("link", { name: missing, exact: true })).toHaveCount(0);
});

test("то же название без учёта регистра не создаёт вторую строку", async ({ page }) => {
  await page.goto("/assignments/new");
  const lower = `${NAME} правка`.toLowerCase();
  const form = await fillCreate(page, lower, LEARN, VERIFY);
  await form.getByRole("button", { name: "Создать" }).click();
  await expect(form.getByRole("alert")).toHaveText("Такое задание уже есть в справочнике этой компетенции");
  await page.goto("/assignments");
  await expect(page.getByRole("link", { name: lower, exact: true })).toHaveCount(0);
});

test("чужой идентификатор — 404", async ({ page }) => {
  const response = await page.goto("/assignments/no-such-assignment");
  expect(response?.status()).toBe(404);
  const broken = await page.goto("/assignments/%25");
  expect(broken?.status()).toBe(404);
});
