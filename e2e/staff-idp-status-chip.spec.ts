import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

test.describe.configure({ mode: "serial" });

// Файл работает от админа: сессия одна на воркер (см. e2e/fixtures.ts).
test.use({ asAdmin: true });

const STAMP = Date.now();
const ACTIVE = { login: `e2e.chip.on.${STAMP}`, name: `Активный чип ${STAMP}`, password: "e2e-chip-password" };
const DONE = { login: `e2e.chip.done.${STAMP}`, name: `Выполненный чип ${STAMP}`, password: "e2e-chip-password" };
const CANCELLED = { login: `e2e.chip.off.${STAMP}`, name: `Отменённый чип ${STAMP}`, password: "e2e-chip-password" };

async function tokenColor(page: Page, name: string) {
  return page.evaluate((token) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${token})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, name);
}

async function paint(node: Locator) {
  return node.evaluate((element) => {
    const style = getComputedStyle(element);
    return { color: style.color, background: style.backgroundColor };
  });
}

async function createPerson(page: Page, person: { login: string; name: string; password: string }) {
  await page.goto("/people");
  const form = page.locator("form", { has: page.getByRole("heading", { name: "Новый сотрудник" }) });
  await form.getByLabel("Логин").fill(person.login);
  await form.getByLabel("Имя").fill(person.name);
  await form.getByLabel("Пароль").fill(person.password);
  await form.getByLabel(/^Должность/).selectOption("junior");
  await form.getByRole("button", { name: "Создать" }).click();
  await expect(page.getByRole("link", { name: person.name, exact: true })).toBeVisible();
}

async function createPlan(page: Page, name: string) {
  await page.goto("/idps");
  const form = page.locator("form", { has: page.getByRole("heading", { name: "Новый ИПР" }) });
  await form.getByLabel(/^Сотрудник/).selectOption({ label: name });
  await form.getByLabel(/^Цель/).selectOption("programmer");
  await form.getByLabel("Начало").fill("2026-03-01");
  await form.getByLabel("Конец").fill("2026-09-30");
  await form.getByRole("button", { name: "Создать" }).click();
  await page.locator("li", { hasText: name }).getByRole("link", { name: "Младший программист → Программист" }).click();
}

test("в списке чипы статусов различаются цветом, строка и карточка нет", async ({ page }) => {
  await createPerson(page, ACTIVE);
  await createPlan(page, ACTIVE.name);

  await createPerson(page, DONE);
  await createPlan(page, DONE.name);
  const add = page.locator("form", { has: page.getByRole("heading", { name: "Добавить задание" }) });
  await add.getByLabel(/^Компетенция/).selectOption({ index: 1 });
  await add.getByLabel("Название (если новое)").fill("Закрыть план");
  await add.getByLabel("Узнать").fill("Как закрыть");
  await add.getByLabel("Проверить").fill("План закрыт");
  await add.getByRole("button", { name: "Добавить" }).click();
  await page.getByRole("row", { name: /Закрыть план/ }).getByRole("button", { name: "Подтвердить" }).click();
  await expect(page.getByText("выполнен", { exact: true })).toBeVisible();
  const cardChip = page.locator("section").getByText("выполнен", { exact: true });
  const cardPaint = await paint(cardChip);

  await createPerson(page, CANCELLED);
  await createPlan(page, CANCELLED.name);
  await page.getByRole("button", { name: "Отменить" }).click();
  await expect(page.getByText("отменён", { exact: true })).toBeVisible();

  await page.goto("/idps");
  const activeRow = page.locator("li", { hasText: ACTIVE.name });
  const doneRow = page.locator("li", { hasText: DONE.name });
  const cancelledRow = page.locator("li", { hasText: CANCELLED.name });
  const activeChip = activeRow.getByText("активен", { exact: true });
  const doneChip = doneRow.getByText("выполнен", { exact: true });
  const cancelledChip = cancelledRow.getByText("отменён", { exact: true });
  const activePaint = await paint(activeChip);
  const donePaint = await paint(doneChip);
  const cancelledPaint = await paint(cancelledChip);
  const green = await tokenColor(page, "--backend-stroke");
  const warning = await tokenColor(page, "--cloud-stroke");
  const muted = await tokenColor(page, "--text-muted");

  expect(activePaint.color).toBe(green);
  expect(donePaint.color).toBe(green);
  expect(activePaint.color).not.toBe(muted);
  expect(activePaint.color).not.toBe(warning);
  expect(cancelledPaint.color).toBe(warning);
  expect(cancelledPaint.color).not.toBe(activePaint.color);
  expect(cancelledPaint.color).not.toBe(donePaint.color);

  const activeRowPaint = await paint(activeRow);
  const doneRowPaint = await paint(doneRow);
  const cancelledRowPaint = await paint(cancelledRow);
  expect(doneRowPaint.background).toBe(activeRowPaint.background);
  expect(cancelledRowPaint.background).toBe(activeRowPaint.background);
  expect(doneRowPaint.background).not.toBe(donePaint.background);
  expect(cardPaint.color).toBe(muted);
  expect(cardPaint.color).not.toBe(green);
});

// Гость идёт без сессии: файл по умолчанию от админа, здесь это выключено.
test.describe("гость", () => {
  test.use({ asAdmin: false });

  test("гость со списка ИПР уходит на вход", async ({ page }) => {
    await page.goto("/idps");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText("выполнен", { exact: true })).toHaveCount(0);
    await expect(page.getByText("отменён", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Создать" })).toHaveCount(0);
  });
});
