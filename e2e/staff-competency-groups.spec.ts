import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, login, test } from "./fixtures";
import { workerDbPath } from "./env";

test.describe.configure({ mode: "serial" });

// Файл работает от админа: сессия одна на воркер (см. e2e/fixtures.ts).
test.use({ asAdmin: true });

const STAMP = Date.now();
const DUTY_ID = `e2eduty${STAMP}`;
const PROF_ID = `e2eprof${STAMP}`;
const PERSONAL_ID = `e2epers${STAMP}`;
const DUTY = `Обязанность списка ${STAMP}`;
const PROF = `Профессиональная списка ${STAMP}`;
const PERSONAL = `Личная списка ${STAMP}`;
const PLAIN = { login: `e2e.groups.${STAMP}`, name: `Не админ групп ${STAMP}`, password: "e2e-groups-password" };

function group(page: Page, title: string) {
  return page.getByRole("region", { name: title, exact: true });
}

async function createCompetency(page: Page, id: string, name: string, type: string) {
  await page.goto("/admin/competencies/new");
  const form = page.locator("form", { has: page.getByRole("button", { name: "Создать" }) });
  await form.getByLabel("Идентификатор").fill(id);
  await form.getByLabel("Название").fill(name);
  await form.getByLabel(/^Тип/).selectOption(type);
  await form.getByRole("button", { name: "Создать" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

test("три списка идут по порядку, строка открывает карточку", async ({ page }) => {
  await createCompetency(page, DUTY_ID, DUTY, "duty");
  await createCompetency(page, PROF_ID, PROF, "professional");
  await createCompetency(page, PERSONAL_ID, PERSONAL, "universal");

  await page.goto("/admin/competencies");
  const sections = page.getByRole("region");
  await expect(sections).toHaveCount(3);
  await expect(sections.nth(0)).toHaveAccessibleName("Компетенции");
  await expect(sections.nth(1)).toHaveAccessibleName("Личные");
  await expect(sections.nth(2)).toHaveAccessibleName("Обязанности");

  const dutyRow = group(page, "Обязанности").locator("li", { has: page.getByRole("link", { name: DUTY, exact: true }) });
  await expect(dutyRow.getByText("Обязанность", { exact: true })).toBeVisible();
  await expect(group(page, "Компетенции").getByRole("link", { name: DUTY, exact: true })).toHaveCount(0);
  await expect(group(page, "Личные").getByRole("link", { name: DUTY, exact: true })).toHaveCount(0);

  await expect(group(page, "Компетенции").getByRole("link", { name: PROF, exact: true })).toBeVisible();
  await expect(group(page, "Личные").getByRole("link", { name: PERSONAL, exact: true })).toBeVisible();

  await group(page, "Обязанности").getByRole("link", { name: DUTY, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/competencies/${DUTY_ID}$`));
  await expect(page.getByRole("heading", { level: 1, name: DUTY })).toBeVisible();
});

test("профессиональная компетенция не попадает в другие списки", async ({ page }) => {
  await page.goto("/admin/competencies");
  await expect(group(page, "Обязанности").getByRole("link", { name: PROF, exact: true })).toHaveCount(0);
  await expect(group(page, "Личные").getByRole("link", { name: PROF, exact: true })).toHaveCount(0);
  await expect(group(page, "Компетенции").getByRole("link", { name: PROF, exact: true })).toBeVisible();
});

test("пустая группа оставляет заголовок и подпись «Нет записей»", async ({ page }, testInfo) => {
  // Правка идёт прямо в базе воркера: интерфейсом такую группу не получить.
  const db = new DatabaseSync(path.resolve(workerDbPath(testInfo.parallelIndex)));
  db.exec("PRAGMA busy_timeout = 5000");
  const ids = db.prepare("SELECT id FROM competencies WHERE type = ?").all("universal") as { id: string }[];
  expect(ids.length).toBeGreaterThan(0);
  const update = db.prepare("UPDATE competencies SET type = ? WHERE id = ?");
  try {
    for (const row of ids) update.run("parked", row.id);
    await page.goto("/admin/competencies");
    await expect(group(page, "Личные").getByRole("heading", { level: 2, name: "Личные" })).toBeVisible();
    await expect(group(page, "Личные").getByText("Нет записей", { exact: true })).toBeVisible();
    await expect(group(page, "Личные").getByRole("link")).toHaveCount(0);
    await expect(group(page, "Обязанности").getByText("Нет записей")).toHaveCount(0);
    await expect(group(page, "Компетенции").getByText("Нет записей")).toHaveCount(0);
    await expect(group(page, "Обязанности").getByRole("link", { name: DUTY, exact: true })).toBeVisible();
  } finally {
    for (const row of ids) update.run("universal", row.id);
    db.close();
  }

  await page.reload();
  await expect(group(page, "Личные").getByRole("link", { name: PERSONAL, exact: true })).toBeVisible();
  await expect(group(page, "Личные").getByText("Нет записей")).toHaveCount(0);
});

test("поиск компетенции не зависит от регистра и пустой результат не оставляет список", async ({ page }) => {
  await page.goto("/admin/competencies");
  await page.getByLabel("Поиск").fill(PROF.toLocaleUpperCase("ru"));
  await expect(page).toHaveURL(/[?&]q=/);
  await expect(group(page, "Компетенции").getByRole("link", { name: PROF, exact: true })).toBeVisible();
  const links = page.locator("ul.panel").getByRole("link");
  const upper = await links.allTextContents();
  const lower = PROF.toLocaleLowerCase("ru");
  await page.getByLabel("Поиск").fill(lower);
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe(lower);
  await expect(links).toHaveText(upper);

  await page.getByLabel("Поиск").fill(`нет-компетенции-${STAMP}`);
  await expect(page.getByText("Ничего не найдено", { exact: true })).toBeVisible();
  await expect(page.getByRole("region")).toHaveCount(0);
  await expect(page.locator("ul.panel")).toHaveCount(0);
});

test("не админ списков не видит и уходит со страницы", async ({ page }) => {
  await page.goto("/people");
  const person = page.locator("form", { has: page.getByRole("heading", { name: "Новый сотрудник" }) });
  await person.getByLabel("Логин").fill(PLAIN.login);
  await person.getByLabel("Имя").fill(PLAIN.name);
  await person.getByLabel("Пароль").fill(PLAIN.password);
  await person.getByLabel(/^Должность/).selectOption("junior");
  await person.getByRole("button", { name: "Создать" }).click();
  await expect(page.getByRole("link", { name: PLAIN.name, exact: true })).toBeVisible();

  await login(page, PLAIN);
  await page.goto("/admin/competencies");
  await expect(page).toHaveURL(/\/me$/);
  await expect(page.getByRole("heading", { name: "Обязанности" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Личные" })).toHaveCount(0);
  await expect(page.getByText("Нет записей")).toHaveCount(0);
  await expect(page.getByRole("link", { name: DUTY, exact: true })).toHaveCount(0);
});
