import type { Locator, Page } from "@playwright/test";
import { expect, login, logout, test } from "./fixtures";
import { E2E_ADMIN } from "./env";

// Шаги делят одну базу: первый тест заводит сотрудника, дальше тесты правят его карточку.
test.describe.configure({ mode: "serial" });

// Файл работает от админа: сессия одна на воркер (см. e2e/fixtures.ts).
test.use({ asAdmin: true });

const STAFF = { login: "e2e.plain", name: "Обычный E2E", password: "e2e-plain-password" };
let staffPath = "";

function editForm(page: Page) {
  return page.locator("form").filter({ has: page.getByLabel(/^Админ/) });
}

async function boxMetrics(box: Locator) {
  return box.evaluate((el) => {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return {
      width: rect.width,
      border: `${style.borderTopWidth} ${style.borderTopStyle} ${style.borderTopColor}`,
    };
  });
}

test("создание с отмеченным «Админ»: на карточке подпись сверху и ящик как у должности", async ({ page }) => {
  await page.goto("/people");

  const create = page.locator("form").filter({ has: page.getByRole("heading", { name: "Новый сотрудник" }) });
  await create.getByLabel("Логин").fill(STAFF.login);
  await create.getByLabel("Имя").fill(STAFF.name);
  await create.getByLabel("Пароль").fill(STAFF.password);
  await create.getByLabel(/^Админ/).selectOption("1");
  await create.getByRole("button", { name: "Создать" }).click();
  await page.getByRole("link", { name: STAFF.name, exact: true }).click();
  staffPath = page.url();

  const edit = editForm(page);
  const admin = edit.getByLabel(/^Админ/);
  await expect(admin).toHaveValue("1");

  const label = edit.locator("label", { has: page.getByLabel(/^Админ/) });
  const stacked = await label.evaluate((el) => {
    const box = el.querySelector("select");
    const text = [...el.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
    if (!(box instanceof HTMLElement) || !text) return false;
    const range = document.createRange();
    range.selectNodeContents(text);
    const textRect = range.getBoundingClientRect();
    const boxRect = box.getBoundingClientRect();
    return boxRect.top >= textRect.bottom - 1;
  });
  expect(stacked).toBe(true);

  const adminBox = await boxMetrics(admin);
  const job = await boxMetrics(edit.getByLabel(/^Должность/));
  expect(adminBox.width).toBeCloseTo(job.width, 0);
  expect(adminBox.border).toBe(job.border);
});

test("снятие «Админ» у не единственного админа сохраняется", async ({ page }) => {
  await page.goto(staffPath);
  const edit = editForm(page);
  await edit.getByLabel(/^Админ/).selectOption("");
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST"),
    edit.getByRole("button", { name: "Сохранить" }).click(),
  ]);
  await page.reload();
  await expect(editForm(page).getByLabel(/^Админ/)).toHaveValue("");

  await page.goto("/people");
  const row = page.locator("li").filter({ has: page.getByRole("link", { name: STAFF.name, exact: true }) });
  await expect(row).not.toContainText("· админ");

  await logout(page);
  await login(page, STAFF);
  await expect(page.getByRole("link", { name: "Компетенции", exact: true })).toHaveCount(0);
});

test("последнего админа снять нельзя", async ({ page }) => {
  await page.goto("/people");
  await page.getByRole("link", { name: E2E_ADMIN.name, exact: true }).click();
  const edit = editForm(page);
  await edit.getByLabel(/^Админ/).selectOption("");
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST"),
    edit.getByRole("button", { name: "Сохранить" }).click(),
  ]);
  await expect(edit.getByRole("alert")).toHaveText("Нельзя убрать последнего админа");
  await page.reload();
  await expect(editForm(page).getByLabel(/^Админ/)).toHaveValue("1");
});

test("сотрудник без признака админа не видит поле «Админ»", async ({ page }) => {
  await login(page, STAFF);
  await page.goto(staffPath);
  await expect(page.getByRole("heading", { level: 1, name: STAFF.name })).toBeVisible();
  await expect(page.getByLabel(/^Админ/)).toHaveCount(0);
  await expect(page.getByText("Админ", { exact: true })).toHaveCount(0);
});

test("поиск сотрудника по имени и должности не зависит от регистра и не выходит за подчинённых", async ({ page }) => {
  const stamp = Date.now();
  const manager = { login: `e2e.lead.${stamp}`, name: `Руководитель поиска ${stamp}`, password: "e2e-lead-password" };
  const lead = `Лид поиска ${stamp}`;
  const byJob = `Иван списка ${stamp}`;
  const outsider = `Чужой списка ${stamp}`;
  const report = `Подчинённый поиска ${stamp}`;

  await login(page);
  await page.goto("/people");
  const create = page.locator("form").filter({ has: page.getByRole("heading", { name: "Новый сотрудник" }) });

  async function addPerson(loginName: string, name: string, password: string, jobId: string, managerName?: string) {
    await create.getByLabel("Логин").fill(loginName);
    await create.getByLabel("Имя").fill(name);
    await create.getByLabel("Пароль").fill(password);
    await create.getByLabel(/^Должность/).selectOption(jobId);
    await create.getByLabel(/^Руководитель/).selectOption(managerName ? { label: managerName } : "");
    await create.getByRole("button", { name: "Создать" }).click();
    await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  }

  await addPerson(manager.login, manager.name, manager.password, "junior");
  await addPerson(`e2e.report.${stamp}`, report, "e2e-report-password", "junior", manager.name);
  await addPerson(`e2e.leadname.${stamp}`, lead, "e2e-leadname-password", "junior");
  await addPerson(`e2e.byjob.${stamp}`, byJob, "e2e-byjob-password", "mentor");
  await addPerson(`e2e.out.${stamp}`, outsider, "e2e-out-password", "programmer");

  const search = page.getByRole("textbox", { name: "Поиск" });
  const query = () => new URL(page.url()).searchParams.get("q");
  await search.fill("ЛИД");
  await expect.poll(query).toBe("ЛИД");
  await expect(page.getByRole("link", { name: lead, exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: byJob, exact: true })).toHaveCount(0);
  const upper = await page.locator("ul.panel").getByRole("link").allTextContents();
  await search.fill("лид");
  await expect.poll(query).toBe("лид");
  expect(await page.locator("ul.panel").getByRole("link").allTextContents()).toEqual(upper);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Поиск" })).toHaveValue("лид");
  await expect(page.getByRole("link", { name: lead, exact: true })).toBeVisible();

  await search.fill("наставник");
  await expect(page.getByRole("link", { name: byJob, exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: lead, exact: true })).toHaveCount(0);

  await search.fill(`нет-сотрудника-${stamp}`);
  await expect(page.getByText("Ничего не найдено", { exact: true })).toBeVisible();
  await expect(page.locator("ul.panel")).toHaveCount(0);

  await login(page, manager);
  await page.goto("/people");
  const ownSearch = page.getByRole("textbox", { name: "Поиск" });
  await ownSearch.fill(outsider);
  await expect(page.getByRole("link", { name: outsider, exact: true })).toHaveCount(0);
  await expect(page.getByText("Ничего не найдено", { exact: true })).toBeVisible();
  await ownSearch.fill("Подчинённый");
  await expect(page.getByRole("link", { name: report, exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: outsider, exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: lead, exact: true })).toHaveCount(0);
});
