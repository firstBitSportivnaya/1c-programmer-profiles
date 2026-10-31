import { expect, test, type Page } from "@playwright/test";
import { E2E_ADMIN, E2E_ADMIN_PASSWORD } from "./env";

test.describe.configure({ mode: "serial" });

const STAMP = Date.now();
const STAFF = { login: `e2e.level.${STAMP}`, name: `Уровень ${STAMP}`, password: "e2e-level-password" };
const LOW = `Уровень 1 ${STAMP}`;
const MID = `Уровень 2 ${STAMP}`;
const HIGH = `Уровень 3 ${STAMP}`;
const BARE = `Без уровня ${STAMP}`;

let idpPath = "";
let competencyId = "";
let highPath = "";
let barePath = "";

async function login(page: Page) {
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
  } else {
    const form = page.locator('form:has(input[name="intent"][value="login"])');
    await form.getByLabel("Логин").fill(E2E_ADMIN.login);
    await form.getByLabel("Пароль", { exact: true }).fill(E2E_ADMIN.password);
    await form.getByRole("button", { name: "Войти" }).click();
  }
  await expect(page).toHaveURL(/\/me$/);
}

function addForm(page: Page) {
  return page.locator("form", { has: page.getByRole("heading", { name: "Добавить задание" }) });
}

async function createAssignment(page: Page, name: string, level: string) {
  await page.goto("/assignments/new");
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Создать" }) });
  await form.getByLabel(/^Компетенция/).selectOption(competencyId);
  await form.getByLabel(/^Уровень/).selectOption(level);
  await form.getByLabel(/^Название/).fill(name);
  await form.getByLabel(/^Узнать/).fill("Узнать");
  await form.getByLabel(/^Проверить/).fill("Проверить");
  await form.getByRole("button", { name: "Создать" }).click();
  await expect(page).toHaveURL(/\/assignments\/asg/);
  return new URL(page.url()).pathname;
}

test("в списке планки 2 есть уровни 1 и 2 и нет 3", async ({ page }) => {
  await login(page);
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

  const add = addForm(page);
  const competency = add.getByLabel(/^Компетенция/);
  // Список приходит с сервером, но чтение без ожидания ловит ещё предыдущую страницу: ждём саму опцию.
  const level2 = competency.locator("option", { hasText: /· ур\. 2$/ }).first();
  await expect(level2).toBeAttached();
  const label = (await level2.innerText()).trim();
  await competency.selectOption({ label });
  competencyId = await competency.inputValue();

  await createAssignment(page, LOW, "1");
  await createAssignment(page, MID, "2");
  highPath = await createAssignment(page, HIGH, "3");

  await page.goto(idpPath);
  const again = addForm(page);
  await again.getByLabel(/^Компетенция/).selectOption(competencyId);
  const catalog = again.getByLabel(/^Из справочника/);
  await expect(catalog.locator("option", { hasText: LOW })).toHaveText(`${LOW} · ур. 1`);
  await expect(catalog.locator("option", { hasText: MID })).toHaveText(`${MID} · ур. 2`);
  await expect(catalog.locator("option", { hasText: HIGH })).toHaveCount(0);
  await expect(again.getByLabel(/^Уровень/).locator("option")).toHaveText(["1 · базовый", "2 · уверенный"]);
});

test("задание уровня 3 в план с планкой 2 не попадает", async ({ page }) => {
  await login(page);
  await page.goto(idpPath);
  const add = addForm(page);
  await add.getByLabel(/^Компетенция/).selectOption(competencyId);
  const highId = highPath.split("/").pop() ?? "";
  await add.getByLabel(/^Из справочника/).evaluate((select, id) => {
    if (!(select instanceof HTMLSelectElement)) return;
    select.add(new Option("forced", id));
    select.value = id;
  }, highId);
  await add.getByRole("button", { name: "Добавить" }).click();
  await expect(add.getByRole("alert")).toHaveText("Задание выше планки этой компетенции");
  await expect(page.getByRole("row", { name: new RegExp(HIGH) })).toHaveCount(0);
});

test("строка хранит уровень, который был при добавлении", async ({ page }) => {
  await login(page);
  await page.goto(idpPath);
  const add = addForm(page);
  await add.getByLabel(/^Компетенция/).selectOption(competencyId);
  const catalog = add.getByLabel(/^Из справочника/);
  await catalog.selectOption({
    value: (await catalog.locator("option", { hasText: MID }).getAttribute("value")) ?? "",
  });
  await expect(add.getByLabel(/^Уровень/)).toHaveCount(0);
  await add.getByRole("button", { name: "Добавить" }).click();
  const row = page.getByRole("row", { name: new RegExp(MID) });
  await expect(row).toContainText("ур. 2");

  await page.goto("/assignments");
  await page.getByRole("link", { name: MID, exact: true }).click();
  const save = page.locator("form", { has: page.getByRole("button", { name: "Сохранить", exact: true }) });
  await save.getByLabel(/^Уровень/).selectOption("1");
  await save.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(save.getByLabel(/^Уровень/)).toHaveValue("1");

  await page.goto(idpPath);
  await expect(page.getByRole("row", { name: new RegExp(MID) })).toContainText("ур. 2");
});

test("задание без уровня не предлагается, скрытое уровень не получает", async ({ page }) => {
  await login(page);
  barePath = await createAssignment(page, BARE, "");
  await expect(page.getByLabel(/^Уровень/)).toHaveValue("");

  await page.goto(idpPath);
  const add = addForm(page);
  await add.getByLabel(/^Компетенция/).selectOption(competencyId);
  await expect(add.getByLabel(/^Из справочника/).locator("option", { hasText: BARE })).toHaveCount(0);

  await page.goto(barePath);
  const save = page.locator("form", { has: page.getByRole("button", { name: "Сохранить", exact: true }) });
  await save.getByLabel(/^Уровень/).selectOption("3");
  const other = await page.context().newPage();
  await other.goto(barePath);
  await other.getByRole("button", { name: "Перенести в архив" }).click();
  await expect(other.getByRole("button", { name: "Вернуть" })).toBeVisible();
  await other.close();
  await save.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(save.getByRole("alert")).toHaveText("Скрытое задание сначала верните в справочник");
  await page.reload();
  await page.getByRole("button", { name: "Вернуть" }).click();
  await expect(page.getByLabel(/^Уровень/)).toHaveValue("");
});
