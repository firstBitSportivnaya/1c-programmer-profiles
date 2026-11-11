import type { Page } from "@playwright/test";
import { expect, login, logout, test } from "./fixtures";
import { EMPLOYEE_IMPORT_COLUMNS } from "../src/lib/employee-workbook";
import { writeXlsxSheet } from "../src/lib/xlsx-sheet";

test.describe.configure({ mode: "serial" });

test.use({ asAdmin: true });

const STAMP = Date.now();
const PASS = "e2e-import-password";
const OTHER = "e2e-import-other-1";
const OLD = {
  login: `e2e.imp.old.${STAMP}`,
  name: `Уже есть ${STAMP}`,
  password: "e2e-import-old-1",
};
const FIRST = {
  login: `e2e.imp.a.${STAMP}`,
  name: `Из файла А ${STAMP}`,
  password: PASS,
};
const SECOND = {
  login: `e2e.imp.b.${STAMP}`,
  name: `Из файла Б ${STAMP}`,
  password: PASS,
};
const GOOD = {
  login: `e2e.imp.ok.${STAMP}`,
  name: `Рядом с ошибкой ${STAMP}`,
  password: PASS,
};
const UNKNOWN = {
  login: `e2e.imp.job.${STAMP}`,
  name: `Не та должность ${STAMP}`,
  password: PASS,
};
const SHORT = {
  login: `e2e.imp.short.${STAMP}`,
  name: `Короткий пароль ${STAMP}`,
  password: "1234567",
};
const EMPTY = {
  login: `e2e.imp.empty.${STAMP}`,
  name: `Пустой пароль ${STAMP}`,
  password: "",
};
const FRESH = {
  login: `e2e.imp.deny.${STAMP}`,
  name: `Чужой импорт ${STAMP}`,
  password: PASS,
};
const BOSS = {
  login: `e2e.imp.boss.${STAMP}`,
  name: `Руководитель импорта ${STAMP}`,
  password: "e2e-import-boss-1",
};

function sheet(rows: string[][]) {
  return writeXlsxSheet([[...EMPLOYEE_IMPORT_COLUMNS], ...rows]);
}

function uploadForm(page: Page) {
  return page.getByRole("form", { name: "Загрузка сотрудников" });
}

function fact(page: Page, label: string) {
  return page.locator("dt", { hasText: new RegExp(`^${label}$`) }).locator("xpath=following-sibling::dd[1]");
}

async function upload(page: Page, rows: string[][]) {
  await page.goto("/people");
  const form = uploadForm(page);
  await form.getByLabel("Файл", { exact: true }).setInputFiles({
    name: "employees.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: sheet(rows),
  });
  const done = page.waitForResponse(
    (response) => response.request().method() === "POST" && /\/people\/?$/.test(new URL(response.url()).pathname),
  );
  await form.getByRole("button", { name: "Загрузить" }).click();
  await done;
  return form;
}

async function addPerson(page: Page, person: { login: string; name: string; password: string }, jobId: string) {
  await page.goto("/people");
  const form = page.locator("form", { has: page.getByRole("heading", { name: "Новый сотрудник" }) });
  await form.getByLabel("Логин").fill(person.login);
  await form.getByLabel("Имя").fill(person.name);
  await form.getByLabel("Пароль").fill(person.password);
  await form.getByLabel(/^Должность/).selectOption(jobId);
  await form.getByRole("button", { name: "Создать" }).click();
  await expect(page.getByRole("link", { name: person.name, exact: true })).toBeVisible();
}

test("две новые строки создаются, занятый логин пропускается и не меняется", async ({ page }) => {
  await addPerson(page, OLD, "junior");
  const form = await upload(page, [
    [FIRST.login, FIRST.name, FIRST.password, "junior", "нет", "нет"],
    [SECOND.login, SECOND.name, SECOND.password, "Программист", "", "да"],
    [OLD.login, "Другое имя", OTHER, "programmer", "нет", "да"],
  ]);
  const report = form.getByRole("status");
  await expect(report).toContainText("Строка 2: создан");
  await expect(report).toContainText("Строка 3: создан");
  await expect(report).toContainText("Строка 4: пропущен: логин занят");
  await expect(report).not.toContainText(FIRST.password);
  await expect(report).not.toContainText(OTHER);
  await expect(page.getByRole("link", { name: FIRST.name, exact: true })).toBeVisible();
  const second = page.locator("li", { has: page.getByRole("link", { name: SECOND.name, exact: true }) });
  await expect(second).toContainText("админ");

  await login(page, FIRST);
  await login(page, SECOND);
  await login(page);

  await page.goto("/people");
  await page.getByRole("link", { name: OLD.name, exact: true }).click();
  await expect(fact(page, "Должность")).toContainText("Младший программист");
  await expect(fact(page, "Руководитель")).toHaveText("нет");
  await login(page, OLD);

  await login(page);
  const again = await upload(page, [[FIRST.login, "Смена имени", OTHER, "programmer", "нет", "да"]]);
  await expect(again.getByRole("status")).toContainText("Строка 2: пропущен: логин занят");
  await page.getByRole("link", { name: FIRST.name, exact: true }).click();
  await expect(fact(page, "Должность")).toContainText("Младший программист");
  await expect(fact(page, "Логин")).toHaveText(FIRST.login);
  await login(page, FIRST);
});

test("неизвестная должность и короткий пароль не создают строку и не мешают остальным", async ({ page }) => {
  await login(page);
  const form = await upload(page, [
    [GOOD.login, GOOD.name, GOOD.password, "junior", "нет", "нет"],
    [UNKNOWN.login, UNKNOWN.name, UNKNOWN.password, `Нет должности ${STAMP}`, "нет", "нет"],
    [SHORT.login, SHORT.name, SHORT.password, "junior", "нет", "нет"],
    [EMPTY.login, EMPTY.name, EMPTY.password, "junior", "нет", "нет"],
  ]);
  const report = form.getByRole("status");
  await expect(report).toContainText("Строка 2: создан");
  await expect(report).toContainText("Строка 3: ошибка: должность не найдена");
  await expect(report).toContainText("Строка 4: ошибка: пароль не короче 8 символов");
  await expect(report).toContainText("Строка 5: ошибка: пароль не короче 8 символов");
  await expect(report).not.toContainText(SHORT.password);
  await expect(page.getByRole("link", { name: GOOD.name, exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: UNKNOWN.name, exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: SHORT.name, exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: EMPTY.name, exact: true })).toHaveCount(0);
});

test("руководитель и гость не загружают файл", async ({ page }) => {
  await login(page);
  await addPerson(page, BOSS, "programmer");
  await page.goto("/people");

  type CapturedPost = { url: string; headers: Record<string, string>; body: Buffer };
  let release!: (value: CapturedPost) => void;
  const captured = new Promise<CapturedPost>((resolve) => {
    release = resolve;
  });
  await page.route("**/people", async (route) => {
    const request = route.request();
    if (request.method() !== "POST") {
      await route.continue();
      return;
    }
    const body = request.postDataBuffer();
    const headers = request.headers();
    if (!body || !headers["next-action"]) {
      await route.continue();
      return;
    }
    release({ url: request.url(), headers, body });
    await route.abort();
  });
  let post: CapturedPost;
  try {
    const form = uploadForm(page);
    await form.getByLabel("Файл", { exact: true }).setInputFiles({
      name: "employees.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: sheet([[FRESH.login, FRESH.name, FRESH.password, "junior", "нет", "нет"]]),
    });
    const click = form.getByRole("button", { name: "Загрузить" }).click();
    post = await captured;
    await click.catch(() => undefined);
  } finally {
    await page.unroute("**/people");
  }
  await page.goto("/people");
  await expect(page.getByRole("link", { name: FRESH.name, exact: true })).toHaveCount(0);

  const replay = (request: Page["request"]) =>
    request.post(post.url, {
      headers: {
        "next-action": post.headers["next-action"] ?? "",
        "content-type": post.headers["content-type"] ?? "",
        accept: post.headers.accept ?? "text/x-component",
      },
      data: post.body,
      maxRedirects: 0,
    });

  await logout(page);
  const guest = await replay(page.request);
  expect(await guest.text()).toContain("Нужна сессия сотрудника");
  expect(await guest.text()).not.toContain("Это не файл Excel");

  await login(page, BOSS);
  await page.goto("/people");
  await expect(uploadForm(page)).toHaveCount(0);
  const denied = await replay(page.request);
  expect(await denied.text()).toContain("Нужна сессия администратора");
  expect(await denied.text()).not.toContain("Это не файл Excel");
  await expect(page.getByRole("link", { name: FRESH.name, exact: true })).toHaveCount(0);
});
