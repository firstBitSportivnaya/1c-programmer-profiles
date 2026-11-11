import type { Locator } from "@playwright/test";
import { expect, test } from "./fixtures";

test.describe.configure({ mode: "serial" });

// Файл работает от админа: сессия одна на воркер (см. e2e/fixtures.ts).
test.use({ asAdmin: true });

const STAMP = Date.now();
const STAFF = { login: `e2e.cal.${STAMP}`, name: `Календарь ${STAMP}`, password: "e2e-cal-password" };
const EMPTY = { login: `e2e.cal.empty.${STAMP}`, name: `Пустой период ${STAMP}`, password: "e2e-cal-password" };
const START = "2026-03-02";
const END = "2026-09-20";
const ADDED = "2026-06-15";
const EDITED = "2026-07-02";
const OUTSIDE = "2026-01-15";
const START_LABEL = "02.03.2026";
const END_LABEL = "20.09.2026";
const ADDED_LABEL = "15.06.2026";
const EDITED_LABEL = "02.07.2026";
const WITH_DUE = "Срок из поля";
const WITHOUT_DUE = "Пустой срок";

function dateInput(scope: Locator, name: string) {
  return scope.locator(`input[type="date"][name="${name}"]`);
}

async function indicatorScheme(input: Locator) {
  return input.evaluate((element) => getComputedStyle(element).colorScheme);
}

async function createPerson(
  page: import("@playwright/test").Page,
  person: { login: string; name: string; password: string },
) {
  await page.goto("/people");
  const form = page.locator("form", { has: page.getByRole("heading", { name: "Новый сотрудник" }) });
  await form.getByLabel("Логин").fill(person.login);
  await form.getByLabel("Имя").fill(person.name);
  await form.getByLabel("Пароль").fill(person.password);
  await form.getByLabel(/^Должность/).selectOption("junior");
  await form.getByRole("button", { name: "Создать" }).click();
  await expect(page.getByRole("link", { name: person.name, exact: true })).toBeVisible();
}

test("в тёмной теме даты периода вводятся без кнопки календаря, значок светлый", async ({ page }) => {
  await createPerson(page, STAFF);
  await page.goto("/idps");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: "Показать календарь" })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Календарь" })).toHaveCount(0);

  const create = page.locator("form", { has: page.getByRole("heading", { name: "Новый ИПР" }) });
  const start = dateInput(create, "periodStart");
  const end = dateInput(create, "periodEnd");
  await expect(start).toHaveAttribute("type", "date");
  await expect.poll(() => indicatorScheme(start)).toBe("dark");
  await expect.poll(() => indicatorScheme(end)).toBe("dark");

  await create.getByLabel(/^Сотрудник/).selectOption({ label: STAFF.name });
  await create.getByLabel(/^Цель/).selectOption("programmer");
  await start.fill(START);
  await end.fill(END);
  await create.getByRole("button", { name: "Создать" }).click();
  await page.locator("li", { hasText: STAFF.name }).getByRole("link", { name: "Младший программист → Программист" }).click();
  await expect(page.getByText(`${START_LABEL} — ${END_LABEL}`)).toBeVisible();
});

test("в светлой теме значок даты тёмный, срок сохраняется из поля", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("pp-theme", "light"));
  await page.goto("/idps");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const create = page.locator("form", { has: page.getByRole("heading", { name: "Новый ИПР" }) });
  await expect.poll(() => indicatorScheme(dateInput(create, "periodStart"))).not.toBe("dark");
  await page.locator("li", { hasText: STAFF.name }).getByRole("link", { name: "Младший программист → Программист" }).click();

  const add = page.locator("form", { has: page.getByRole("heading", { name: "Добавить задание" }) });
  const due = dateInput(add, "dueOn");
  await expect.poll(() => indicatorScheme(due)).not.toBe("dark");
  await add.getByLabel(/^Компетенция/).selectOption({ index: 1 });
  await add.getByLabel("Название (если новое)").fill(WITH_DUE);
  await add.getByLabel("Узнать").fill("Как ввести день");
  await add.getByLabel("Проверить").fill("День в строке");
  await due.fill(ADDED);
  await add.getByRole("button", { name: "Добавить" }).click();
  await expect(page.getByRole("row", { name: new RegExp(WITH_DUE) }).getByText(ADDED_LABEL, { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("row", { name: new RegExp(WITH_DUE) }).getByText(ADDED_LABEL, { exact: true })).toBeVisible();

  const row = page.getByRole("row", { name: new RegExp(WITH_DUE) });
  await row.getByText("Править", { exact: true }).click();
  const editing = page.getByRole("row").filter({ has: page.getByRole("button", { name: "Сохранить", exact: true }) });
  const dueEdit = dateInput(editing, "dueOn");
  const insideCell = await dueEdit.evaluate((element) => {
    const cell = element.closest("td");
    if (!cell) return false;
    const input = element.getBoundingClientRect();
    const box = cell.getBoundingClientRect();
    return input.left >= box.left - 1 && input.right <= box.right + 1 && input.width >= 140;
  });
  expect(insideCell).toBe(true);
  await dueEdit.fill(EDITED);
  await editing.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("row", { name: new RegExp(WITH_DUE) }).getByText(EDITED_LABEL, { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("row", { name: new RegExp(WITH_DUE) }).getByText(EDITED_LABEL, { exact: true })).toBeVisible();
});

test("день вне периода не записывается, пустой срок и пустой период остаются", async ({ page }) => {
  await createPerson(page, EMPTY);
  await page.goto("/idps");
  const create = page.locator("form", { has: page.getByRole("heading", { name: "Новый ИПР" }) });
  await create.getByLabel(/^Сотрудник/).selectOption({ label: EMPTY.name });
  await create.getByLabel(/^Цель/).selectOption("programmer");
  await create.getByRole("button", { name: "Создать" }).click();
  await expect(dateInput(create, "periodStart")).toHaveJSProperty("validity.valueMissing", true);
  await expect(page.getByRole("link", { name: new RegExp(EMPTY.name) })).toHaveCount(0);

  await page.locator("li", { hasText: STAFF.name }).getByRole("link", { name: "Младший программист → Программист" }).click();
  const add = page.locator("form", { has: page.getByRole("heading", { name: "Добавить задание" }) });
  await add.getByLabel(/^Компетенция/).selectOption({ index: 1 });
  await add.getByLabel("Название (если новое)").fill(WITHOUT_DUE);
  await add.getByLabel("Узнать").fill("Без дня");
  await add.getByLabel("Проверить").fill("Срок пуст");
  await add.getByRole("button", { name: "Добавить" }).click();
  const row = page.getByRole("row", { name: new RegExp(WITHOUT_DUE) });
  await expect(row.getByText("—", { exact: true })).toBeVisible();
  await row.getByText("Править", { exact: true }).click();
  const editing = page.getByRole("row").filter({ has: page.getByRole("button", { name: "Сохранить", exact: true }) });
  await dateInput(editing, "dueOn").fill(OUTSIDE);
  await editing.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(editing.locator(".form-error[role='alert']")).toContainText("Срок задания должен быть внутри периода ИПР");
  await page.reload();
  const again = page.getByRole("row", { name: new RegExp(WITHOUT_DUE) });
  await expect(again.getByText("—", { exact: true })).toBeVisible();
  await expect(again.getByRole("textbox", { name: "Срок" })).toHaveCount(0);
});

test("поле даты выключено до гидратации и принимает дату после", async ({ page }) => {
  await page.goto("/idps");
  await page.locator("li", { hasText: STAFF.name }).getByRole("link", { name: "Младший программист → Программист" }).click();
  const due = page.locator("form", { has: page.getByRole("heading", { name: "Добавить задание" }) });

  const raw = await page.request.get(new URL(page.url()).pathname);
  expect(raw.ok()).toBeTruthy();
  const html = await raw.text();
  expect(html).not.toContain("Показать календарь");
  const dateInputs = html.match(/<input[^>]*type="date"[^>]*>/g) ?? [];
  expect(dateInputs.length).toBeGreaterThan(0);
  for (const tag of dateInputs) expect(tag).toContain("disabled");

  const dueOn = dateInput(due, "dueOn");
  await expect(dueOn).toBeEnabled();
  await dueOn.fill(ADDED);
  await expect(dueOn).toHaveValue(ADDED);
  await expect(page.getByRole("button", { name: "Показать календарь" })).toHaveCount(0);
});

test.describe("гость", () => {
  test.use({ asAdmin: false });

  test("гость со списка ИПР не видит поля даты", async ({ page }) => {
    await page.goto("/idps");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByLabel("Начало")).toHaveCount(0);
    await expect(page.getByLabel("Конец")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Показать календарь" })).toHaveCount(0);
  });
});
