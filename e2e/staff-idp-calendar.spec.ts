import type { Locator } from "@playwright/test";
import { expect, test } from "./fixtures";

test.describe.configure({ mode: "serial" });

// Файл работает от админа: сессия одна на воркер (см. e2e/fixtures.ts).
test.use({ asAdmin: true });

const STAMP = Date.now();
const STAFF = { login: `e2e.cal.${STAMP}`, name: `Календарь ${STAMP}`, password: "e2e-cal-password" };
const START = "2026-03-02";
const END = "2026-09-20";
const ADDED = "2026-06-15";
const EDITED = "2026-07-02";
const OUTSIDE = "2026-01-15";
const WITH_DUE = "Срок из календаря";
const WITHOUT_DUE = "Пустой срок";

async function visibleButton(button: Locator) {
  await expect(button).toBeVisible();
  const box = await button.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(8);
  expect(box?.height ?? 0).toBeGreaterThan(8);
  const paint = await button.evaluate((element) => {
    const style = getComputedStyle(element);
    return { color: style.color, background: style.backgroundColor };
  });
  expect(paint.color).not.toBe(paint.background);
  expect(paint.color).not.toBe("rgba(0, 0, 0, 0)");
}

async function pickDay(scope: Locator, inputName: string, iso: string) {
  const box = scope.locator(`.date-field:has(input[name="${inputName}"])`);
  const open = box.getByRole("button", { name: "Показать календарь" });
  await visibleButton(open);
  await open.click();
  const dialog = box.getByRole("dialog", { name: "Календарь" });
  const target = iso.slice(0, 7);
  for (let step = 0; step < 36; step += 1) {
    const current = (await dialog.getAttribute("data-month")) ?? "";
    if (current === target) break;
    await dialog.getByRole("button", { name: current < target ? "Следующий месяц" : "Предыдущий месяц" }).click();
  }
  await expect(dialog).toHaveAttribute("data-month", target);
  const day = dialog.getByRole("button", { name: iso });
  await visibleButton(day);
  await day.click();
  await expect(box.locator("input")).toHaveValue(iso);
}

test("в тёмной теме день начала и конца выбирается календарём", async ({ page }) => {
  await page.goto("/people");
  const person = page.locator("form", { has: page.getByRole("heading", { name: "Новый сотрудник" }) });
  await person.getByLabel("Логин").fill(STAFF.login);
  await person.getByLabel("Имя").fill(STAFF.name);
  await person.getByLabel("Пароль").fill(STAFF.password);
  await person.getByLabel(/^Должность/).selectOption("junior");
  await person.getByRole("button", { name: "Создать" }).click();
  await expect(page.getByRole("link", { name: STAFF.name, exact: true })).toBeVisible();

  await page.goto("/idps");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const create = page.locator("form", { has: page.getByRole("heading", { name: "Новый ИПР" }) });
  await create.getByLabel(/^Сотрудник/).selectOption({ label: STAFF.name });
  await create.getByLabel(/^Цель/).selectOption("programmer");
  await pickDay(create, "periodStart", START);
  await pickDay(create, "periodEnd", END);
  await create.getByRole("button", { name: "Создать" }).click();
  await page.locator("li", { hasText: STAFF.name }).getByRole("link", { name: "Младший программист → Программист" }).click();
  await expect(page.getByText(`${START} — ${END}`)).toBeVisible();
});

test("в светлой теме срок задания выбирается календарём в обеих формах", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("pp-theme", "light"));
  await page.goto("/idps");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.locator("li", { hasText: STAFF.name }).getByRole("link", { name: "Младший программист → Программист" }).click();

  const add = page.locator("form", { has: page.getByRole("heading", { name: "Добавить задание" }) });
  await add.getByLabel(/^Компетенция/).selectOption({ index: 1 });
  await add.getByLabel("Название (если новое)").fill(WITH_DUE);
  await add.getByLabel("Узнать").fill("Как выбрать день");
  await add.getByLabel("Проверить").fill("День в строке");
  await pickDay(add, "dueOn", ADDED);
  await add.getByRole("button", { name: "Добавить" }).click();
  await expect(page.getByRole("row", { name: new RegExp(WITH_DUE) }).getByText(ADDED, { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("row", { name: new RegExp(WITH_DUE) }).getByText(ADDED, { exact: true })).toBeVisible();

  const row = page.getByRole("row", { name: new RegExp(WITH_DUE) });
  await row.getByText("Править", { exact: true }).click();
  const editing = page.getByRole("row").filter({ has: page.getByRole("button", { name: "Сохранить", exact: true }) });
  await pickDay(editing, "dueOn", EDITED);
  await editing.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("row", { name: new RegExp(WITH_DUE) }).getByText(EDITED, { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("row", { name: new RegExp(WITH_DUE) }).getByText(EDITED, { exact: true })).toBeVisible();
});

test("день вне периода не записывается, пустой срок остаётся", async ({ page }) => {
  await page.goto("/idps");
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
  await pickDay(editing, "dueOn", OUTSIDE);
  await editing.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(editing.getByRole("alert")).toContainText("Срок задания должен быть внутри периода ИПР");
  await page.reload();
  const again = page.getByRole("row", { name: new RegExp(WITHOUT_DUE) });
  await expect(again.getByText("—", { exact: true })).toBeVisible();
  await expect(again.getByLabel("Срок")).toHaveCount(0);
});

test("поле даты и календарь неактивны до гидратации и доступны после", async ({ page }) => {
  await page.goto("/idps");
  await page.locator("li", { hasText: STAFF.name }).getByRole("link", { name: "Младший программист → Программист" }).click();
  const due = page.locator("form", { has: page.getByRole("heading", { name: "Добавить задание" }) });

  // Разметка с сервера: до монтирования кнопка и поле даты выключены, иначе первый клик и ввод теряются.
  const raw = await page.request.get(new URL(page.url()).pathname);
  expect(raw.ok()).toBeTruthy();
  const html = await raw.text();
  const tags = html.match(/<button[^>]*aria-label="Показать календарь"[^>]*>/g) ?? [];
  expect(tags.length).toBeGreaterThan(0);
  for (const tag of tags) expect(tag).toContain("disabled");
  const dateInputs = html.match(/<input[^>]*type="date"[^>]*>/g) ?? [];
  expect(dateInputs.length).toBeGreaterThan(0);
  for (const tag of dateInputs) expect(tag).toContain("disabled");

  // После монтирования поле принимает введённую дату и не сбрасывает её до отправки формы.
  const dueOn = due.getByLabel("Срок");
  await expect(dueOn).toBeEnabled();
  await dueOn.fill(ADDED);
  await expect(dueOn).toHaveValue(ADDED);

  const open = due.getByRole("button", { name: "Показать календарь" });
  await expect(open).toBeEnabled();
  await open.click();
  await expect(due.getByRole("dialog", { name: "Календарь" })).toBeVisible();
});

// Гость идёт без сессии: файл по умолчанию от админа, здесь это выключено.
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
