import { expect, test, type Page } from "@playwright/test";
import { E2E_ADMIN, E2E_ADMIN_PASSWORD } from "./env";

test.describe.configure({ mode: "serial" });

const STAMP = Date.now();
const ACCOUNT = (suffix: string, name: string) => ({
  login: `e2e.ach.${suffix}.${STAMP}`,
  name: `${name} ${STAMP}`,
  password: "e2e-ach-password",
});
const A = ACCOUNT("a", "Ачивки A");
const B = ACCOUNT("b", "Ачивки B");
const C = ACCOUNT("c", "Ачивки C");
const D = ACCOUNT("d", "Ачивки D");
const A_GOAL = `Цель A ${STAMP}`;
const A_SECOND = `Цель A2 ${STAMP}`;
const C_GOAL = `Цель C ${STAMP}`;
const D_FIRST = `Цель D1 ${STAMP}`;
const D_SECOND = `Цель D2 ${STAMP}`;
let aPlanPath = "";
let cPlanPath = "";
let dPlanPath = "";
let aOtherCompetency = "";

async function login(page: Page, account: { login: string; password: string } = E2E_ADMIN) {
  await page.goto("/login");
  if (/\/me$/.test(page.url())) {
    await page.getByRole("button", { name: "Выйти" }).click();
    await page.goto("/login");
  }
  const bootstrap = page.locator("#bootstrap-admin");
  if (await bootstrap.isVisible()) {
    await bootstrap.getByLabel("Пароль из .env.local").fill(E2E_ADMIN_PASSWORD);
    await bootstrap.getByLabel("Логин").fill(E2E_ADMIN.login);
    await bootstrap.getByLabel("Имя").fill(E2E_ADMIN.name);
    await bootstrap.getByLabel("Должность").selectOption("team-lead");
    await bootstrap.getByLabel("Пароль учётки").fill(E2E_ADMIN.password);
    await bootstrap.getByRole("button", { name: "Создать первого админа" }).click();
    if (account.login !== E2E_ADMIN.login) {
      await page.getByRole("button", { name: "Выйти" }).click();
      await login(page, account);
      return;
    }
  } else {
    const form = page.locator('form:has(input[name="intent"][value="login"])');
    await form.getByLabel("Логин").fill(account.login);
    await form.getByLabel("Пароль", { exact: true }).fill(account.password);
    await form.getByRole("button", { name: "Войти" }).click();
  }
  await expect(page).toHaveURL(/\/me$/);
}

async function createStaff(page: Page, staff: { login: string; name: string; password: string }, jobId: string) {
  await page.goto("/people");
  const form = page.locator("form", { has: page.getByRole("heading", { name: "Новый сотрудник" }) });
  await form.getByLabel("Логин").fill(staff.login);
  await form.getByLabel("Имя").fill(staff.name);
  await form.getByLabel("Пароль").fill(staff.password);
  await form.getByLabel(/^Должность/).selectOption(jobId);
  await form.getByRole("button", { name: "Создать" }).click();
  await expect(page.getByRole("link", { name: staff.name, exact: true })).toBeVisible();
}

async function createPlan(page: Page, staff: { name: string }, targetJobId: string) {
  await page.goto("/idps");
  const form = page.locator("form", { has: page.getByRole("heading", { name: "Новый ИПР" }) });
  await form.getByLabel(/^Сотрудник/).selectOption({ label: staff.name });
  await form.getByLabel(/^Цель/).selectOption(targetJobId);
  await form.getByLabel("Начало").fill("2026-03-01");
  await form.getByLabel("Конец").fill("2026-09-30");
  await form.getByRole("button", { name: "Создать" }).click();
  const row = page.locator("li", { hasText: staff.name });
  await expect(row.getByRole("link").first()).toBeVisible();
  await row.getByRole("link").first().click();
  const add = page.locator("form", { has: page.getByRole("heading", { name: "Добавить задание" }) });
  await expect(add).toBeVisible();
  return new URL(page.url()).pathname;
}

function addItemForm(page: Page) {
  return page.locator("form", { has: page.getByRole("heading", { name: "Добавить задание" }) });
}

async function addItem(page: Page, name: string, competencyIndex = 0) {
  const form = addItemForm(page);
  if (competencyIndex > 0) {
    await form.getByLabel(/^Компетенция/).selectOption({ index: competencyIndex });
  }
  await form.getByLabel(/^Название/).fill(name);
  await form.getByLabel(/^Узнать/).fill(`Узнать ${name}`);
  await form.getByLabel(/^Проверить/).fill(`Проверить ${name}`);
  await form.getByRole("button", { name: "Добавить" }).click();
  await expect(page.getByRole("row", { name: new RegExp(name) })).toBeVisible();
}

async function acceptItem(page: Page, name: string) {
  const row = page.getByRole("row", { name: new RegExp(name) });
  await row.getByRole("button", { name: "Подтвердить" }).click();
  await expect(row.getByText("принято", { exact: true })).toBeVisible();
}

/** Раздел достижений на `/me`. Когда ачивок нет, раздела нет и в разметке. */
function achievements(page: Page) {
  return page.locator("section", { has: page.getByRole("heading", { name: "Достижения", exact: true }) });
}

test("принятая строка даёт ачивки первой строки и компетенции", async ({ page }) => {
  await login(page);
  await createStaff(page, A, "junior");
  aPlanPath = await createPlan(page, A, "programmer");

  await login(page, A);
  await page.goto("/me");
  await expect(page.getByRole("heading", { name: "Достижения" })).toHaveCount(0);

  await login(page);
  await page.goto(aPlanPath);
  await addItem(page, A_GOAL);

  const options = addItemForm(page).getByLabel(/^Компетенция/).locator("option");
  aOtherCompetency = (await options.nth(1).innerText()).replace(/\s·\sур\.\s\d+$/, "");
  await addItem(page, A_SECOND, 1);
  await acceptItem(page, A_GOAL);

  await login(page, A);
  await page.goto("/me");
  const section = achievements(page);
  await expect(section.getByText("Первая принятая строка", { exact: true })).toBeVisible();
  await expect(section.getByText("Компетенция подтверждена", { exact: true })).toBeVisible();
  await expect(section.getByText(aOtherCompetency, { exact: true })).toHaveCount(0);
  await expect(section.getByText("Все компетенции пула подтверждены", { exact: true })).toHaveCount(0);
  await expect(section.getByText("ИПР выполнен", { exact: true })).toHaveCount(0);
});

test("снятая приёмка убирает ачивки, без приёмок раздела нет", async ({ page }) => {
  await login(page);
  await page.goto(aPlanPath);
  const row = page.getByRole("row", { name: new RegExp(A_GOAL) });
  await row.getByRole("button", { name: "Снять подтверждение" }).click();
  await expect(row.getByText("принято", { exact: true })).toHaveCount(0);

  await login(page, A);
  await page.goto("/me");
  await expect(page.getByRole("heading", { name: "Достижения" })).toHaveCount(0);
  await expect(page.getByText("Первая принятая строка")).toHaveCount(0);
});

test("когда приняты все компетенции пула, видны все четыре ачивки", async ({ page }) => {
  await login(page);
  await createStaff(page, C, "lead");
  cPlanPath = await createPlan(page, C, "programmer");
  await addItem(page, C_GOAL);
  await acceptItem(page, C_GOAL);

  await login(page, C);
  await page.goto(cPlanPath);
  await expect(page.getByText("выполнен", { exact: true })).toBeVisible();
  await page.goto("/me");
  const section = achievements(page);
  for (const title of [
    "Первая принятая строка",
    "Компетенция подтверждена",
    "Все компетенции пула подтверждены",
    "ИПР выполнен",
  ]) {
    await expect(section.getByText(title, { exact: true })).toBeVisible();
  }
});

test("приёмки отменённого плана в ачивках не видны", async ({ page }) => {
  await login(page);
  await createStaff(page, D, "junior");
  dPlanPath = await createPlan(page, D, "programmer");
  await addItem(page, D_FIRST);
  await addItem(page, D_SECOND);
  await acceptItem(page, D_FIRST);

  await login(page, D);
  await page.goto("/me");
  await expect(achievements(page).getByText("Первая принятая строка", { exact: true })).toBeVisible();

  await login(page);
  await page.goto(dPlanPath);
  await page.getByRole("button", { name: "Отменить" }).click();
  await expect(page.getByText("отменён", { exact: true })).toBeVisible();

  await login(page, D);
  await page.goto("/me");
  await expect(page.getByRole("heading", { name: "Достижения" })).toHaveCount(0);
});

test("чужой кабинет чужих ачивок не показывает", async ({ page }) => {
  await login(page);
  await createStaff(page, B, "junior");
  await login(page, B);
  await page.goto("/me");
  await expect(page.getByRole("heading", { name: "Достижения" })).toHaveCount(0);
  await expect(page.getByText("Все компетенции пула подтверждены")).toHaveCount(0);
});
