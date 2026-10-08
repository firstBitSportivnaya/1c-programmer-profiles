import { expect, test, type Page } from "@playwright/test";
import { E2E_ADMIN } from "./env";

// Файл идёт после session.spec.ts (алфавит, один воркер): админ там уже создан.
// Шаги делят базу: админ заводит ссылки, сотрудника и ИПР, дальше входит сотрудник.
test.describe.configure({ mode: "serial" });

const READER = { login: "e2e.reader", name: "Читатель E2E", password: "e2e-reader-password" };
const COMPETENCY = { id: "comp-avtomatizirovannoe-testirovanie", name: "Автоматизированное тестирование" };
const ITS = { title: "Тестирование в 1С", url: "https://its.1c.ru/db/v8std/testing" };

async function login(page: Page, account: { login: string; password: string }) {
  await page.goto("/login");
  const form = page.locator('form:has(input[name="intent"][value="login"])');
  await form.getByLabel("Логин").fill(account.login);
  await form.getByLabel("Пароль", { exact: true }).fill(account.password);
  await form.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/me$/);
}

function materials(page: Page) {
  return page.getByRole("group", { name: `Материалы: ${COMPETENCY.name}` });
}

async function addLink(page: Page, kind: string, title: string, url: string) {
  const group = materials(page);
  // В подпись <select> внутри <label> попадает текст вариантов, поэтому подпись сверяется с началом строки.
  await group.getByLabel(/^Вид/).selectOption(kind);
  await group.getByLabel("Название ссылки").fill(title);
  await group.getByLabel("Адрес").fill(url);
  await group.getByRole("button", { name: "Добавить ссылку" }).click();
}

async function openAllDetails(page: Page) {
  await page
    .locator("details")
    .evaluateAll((all) => all.forEach((details) => ((details as HTMLDetailsElement).open = true)));
}

test("админ добавляет и удаляет ссылку у компетенции", async ({ page }) => {
  await login(page, E2E_ADMIN);
  await page.goto("/admin/competencies");

  await addLink(page, "its", ITS.title, ITS.url);
  await expect(materials(page).getByRole("link", { name: ITS.title })).toHaveAttribute("href", ITS.url);

  await addLink(page, "video", "Лишнее видео", "https://example.org/video");
  const extra = materials(page).getByRole("listitem").filter({ hasText: "Лишнее видео" });
  await expect(extra.getByText("Видео", { exact: true })).toBeVisible();
  await extra.getByRole("button", { name: "Удалить ссылку" }).click();
  await expect(materials(page).getByRole("link", { name: "Лишнее видео" })).toHaveCount(0);

  await page.reload();
  await expect(materials(page).getByRole("link")).toHaveCount(1);
  await expect(materials(page).getByRole("link", { name: ITS.title })).toBeVisible();
});

test("адрес не http(s) или пустое название — ошибка, строка не сохраняется", async ({ page }) => {
  await login(page, E2E_ADMIN);
  await page.goto("/admin/competencies");

  await addLink(page, "training", "Курс", "ftp://example.org/course");
  await expect(materials(page).getByRole("alert")).toHaveText("Адрес ссылки: только http:// или https://");

  await addLink(page, "training", "Курс", "javascript:alert(1)");
  await expect(materials(page).getByRole("alert")).toHaveText("Адрес ссылки: только http:// или https://");

  await addLink(page, "training", "   ", "https://example.org/course");
  await expect(materials(page).getByRole("alert")).toHaveText("Нужно название ссылки");

  await page.reload();
  await expect(materials(page).getByRole("link")).toHaveCount(1);
});

test("админ заводит сотрудника и ИПР с заданием по компетенции со ссылкой", async ({ page }) => {
  await login(page, E2E_ADMIN);

  await page.goto("/people");
  const form = page.locator("form", { has: page.getByRole("heading", { name: "Новый сотрудник" }) });
  await form.getByLabel("Логин").fill(READER.login);
  await form.getByLabel("Имя").fill(READER.name);
  await form.getByLabel("Пароль").fill(READER.password);
  await form.getByLabel(/^Должность/).selectOption("junior");
  await form.getByLabel(/^Руководитель/).selectOption({ label: E2E_ADMIN.name });
  await form.getByRole("button", { name: "Создать" }).click();
  await expect(page.getByRole("link", { name: READER.name, exact: true })).toBeVisible();

  await page.goto("/idps");
  await page.getByLabel(/^Сотрудник/).selectOption({ label: READER.name });
  await page.getByLabel(/^Цель/).selectOption("programmer");
  await page.getByLabel("Начало").fill("2026-01-01");
  await page.getByLabel("Конец").fill("2026-12-31");
  await page.getByRole("button", { name: "Создать" }).click();
  await page.locator("li", { hasText: READER.name }).getByRole("link", { name: "Младший программист → Программист" }).click();

  const add = page.locator("form", { has: page.getByRole("heading", { name: "Добавить задание" }) });
  await add.getByLabel(/^Компетенция/).selectOption(COMPETENCY.id);
  await add.getByLabel("Название (если новое)").fill("Написать тест");
  await add.getByLabel("Узнать").fill("Как устроены тесты");
  await add.getByLabel("Проверить").fill("Тест проходит");
  await add.getByRole("button", { name: "Добавить" }).click();
  await expect(page.getByRole("heading", { level: 3, name: new RegExp(COMPETENCY.name) })).toBeVisible();
});

test("вошедший сотрудник видит ссылку в карточке навыка и в ИПР", async ({ page }) => {
  await login(page, READER);

  await page.goto("/jobs/programmer/profile");
  await openAllDetails(page);
  const card = page.locator("details", { has: page.getByText(COMPETENCY.name, { exact: true }) }).last();
  await expect(card.getByRole("link", { name: ITS.title })).toHaveAttribute("href", ITS.url);

  await page.goto("/me");
  await page.getByRole("link", { name: /^Активный план/ }).click();
  await expect(page.getByRole("heading", { level: 3, name: new RegExp(COMPETENCY.name) })).toBeVisible();
  await expect(page.getByRole("link", { name: ITS.title })).toHaveAttribute("href", ITS.url);
});

test("гость ссылок не видит", async ({ page }) => {
  await page.goto("/jobs/programmer/profile");
  await openAllDetails(page);
  await expect(page.getByText(COMPETENCY.name, { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: ITS.title })).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Материалы" })).toHaveCount(0);
});
