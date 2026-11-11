import type { Locator, Page, TestInfo } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { expect, login, logout, test } from "./fixtures";
import { E2E_ADMIN, workerDbPath } from "./env";

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
  const links = page.locator("ul.panel").getByRole("link");
  const upper = await links.allTextContents();
  await search.fill("лид");
  await expect.poll(query).toBe("лид");
  await expect(links).toHaveText(upper);
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

type PersonRow = { id: string; is_active: number; manager_id: string | null };
type PlanRow = { id: string; status: string; items: number };
type CapturedPost = { url: string; headers: Record<string, string>; body: Buffer };

function personRow(testInfo: TestInfo, loginName: string) {
  const db = new DatabaseSync(path.resolve(workerDbPath(testInfo.parallelIndex)));
  try {
    return db
      .prepare("select id, is_active, manager_id from employees where login = ?")
      .get(loginName) as PersonRow | undefined;
  } finally {
    db.close();
  }
}

function plansOf(testInfo: TestInfo, loginName: string) {
  const db = new DatabaseSync(path.resolve(workerDbPath(testInfo.parallelIndex)));
  try {
    return db
      .prepare(
        `select i.id, i.status,
           (select count(*) from idp_items where idp_id = i.id) as items
         from idps i
         where i.employee_id = (select id from employees where login = ?)
         order by i.updated_at`,
      )
      .all(loginName) as PlanRow[];
  } finally {
    db.close();
  }
}

function fact(page: Page, term: string) {
  return page.locator("dt", { hasText: term }).locator("xpath=following-sibling::dd[1]");
}

function peopleRow(page: Page, name: string) {
  return page.locator("li").filter({ has: page.getByRole("link", { name, exact: true }) });
}

async function addPerson(
  page: Page,
  account: { login: string; name: string; password: string },
  jobId: string,
  managerName?: string,
) {
  await page.goto("/people");
  const create = page.locator("form").filter({ has: page.getByRole("heading", { name: "Новый сотрудник" }) });
  await create.getByLabel("Логин").fill(account.login);
  await create.getByLabel("Имя").fill(account.name);
  await create.getByLabel("Пароль").fill(account.password);
  await create.getByLabel(/^Должность/).selectOption(jobId);
  await create.getByLabel(/^Руководитель/).selectOption(managerName ? { label: managerName } : "");
  await create.getByRole("button", { name: "Создать" }).click();
  await expect(page.getByRole("link", { name: account.name, exact: true })).toBeVisible();
}

async function openPerson(page: Page, name: string) {
  await page.goto("/people");
  await page.getByRole("link", { name, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

function returnForm(page: Page) {
  return page.locator("form", { has: page.getByRole("button", { name: "Вернуть в активные" }) });
}

async function deactivate(page: Page) {
  await page.getByRole("button", { name: "Деактивировать" }).click();
  await expect(page.getByRole("button", { name: "Вернуть в активные" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Деактивировать" })).toHaveCount(0);
}

test("критерии 1, 4 и 5: возврат с руководителем не оживляет план и не возвращает подчинённых", async ({
  page,
}, testInfo) => {
  const boss = { login: "e2e.back.boss", name: "Руководитель возврата E2E", password: "e2e-back-boss-password" };
  const person = { login: "e2e.back", name: "Возврат E2E", password: "e2e-back-password" };
  const report = { login: "e2e.back.report", name: "Подчинённый возврата E2E", password: "e2e-back-report-password" };
  const goal = "Строка до деактивации";

  await login(page);
  await addPerson(page, boss, "junior");
  await addPerson(page, person, "junior", boss.name);
  await addPerson(page, report, "junior", person.name);

  await page.goto("/idps");
  await page.getByLabel(/^Сотрудник/).selectOption({ label: person.name });
  await page.getByLabel(/^Цель/).selectOption("programmer");
  await page.getByLabel("Начало").fill("2026-03-01");
  await page.getByLabel("Конец").fill("2026-09-30");
  await page.getByRole("button", { name: "Создать" }).click();
  await page
    .locator("li", { hasText: person.name })
    .getByRole("link", { name: "Младший программист → Программист" })
    .click();
  const add = page.locator("form", { has: page.getByRole("heading", { name: "Добавить задание" }) });
  await add.getByLabel(/^Компетенция/).selectOption({ index: 1 });
  await add.getByLabel("Название (если новое)").fill(goal);
  await add.getByLabel("Узнать").fill("Что было в плане");
  await add.getByLabel("Проверить").fill("Строка на месте");
  await add.getByRole("button", { name: "Добавить" }).click();
  await expect(page.getByRole("row", { name: new RegExp(goal) })).toBeVisible();
  const idpPath = new URL(page.url()).pathname;

  await openPerson(page, person.name);
  await deactivate(page);
  await expect(fact(page, "Активен")).toHaveText("нет");
  await expect(fact(page, "Руководитель")).toHaveText("нет");
  await expect(page.getByText("Активного плана нет")).toBeVisible();
  await expect(page.getByText("отменён", { exact: true })).toBeVisible();
  await page.goto(idpPath);
  await expect(page.getByRole("row", { name: new RegExp(goal) })).toBeVisible();

  await page.goto("/people");
  await expect(peopleRow(page, person.name)).toContainText("не активен");
  await openPerson(page, report.name);
  await expect(fact(page, "Руководитель")).toHaveText("нет");
  const reportBefore = personRow(testInfo, report.login);
  expect(reportBefore?.manager_id).toBeNull();
  const cancelled = plansOf(testInfo, person.login);
  expect(cancelled).toHaveLength(1);
  expect(cancelled[0]?.status).toBe("cancelled");
  expect(cancelled[0]?.items).toBeGreaterThan(0);

  await openPerson(page, person.name);
  const back = returnForm(page);
  await back.getByLabel(/^Руководитель/).selectOption({ label: boss.name });
  await back.getByRole("button", { name: "Вернуть в активные" }).click();
  await expect(page.getByRole("button", { name: "Деактивировать" })).toBeVisible();
  await expect(page.locator(".form-error")).toHaveCount(0);
  await expect(fact(page, "Активен")).toHaveText("да");
  await expect(fact(page, "Руководитель")).toHaveText(boss.name);
  await expect(page.getByText("Активного плана нет")).toBeVisible();
  await expect(page.getByText("отменён", { exact: true })).toBeVisible();

  await logout(page);
  await login(page, person);
  await expect(page).toHaveURL(/\/me$/);

  await login(page);
  await page.goto("/people");
  await expect(peopleRow(page, person.name)).not.toContainText("не активен");
  await openPerson(page, report.name);
  await expect(fact(page, "Руководитель")).toHaveText("нет");
  expect(personRow(testInfo, report.login)?.manager_id).toBeNull();
  expect(personRow(testInfo, person.login)).toMatchObject({ is_active: 1, manager_id: personRow(testInfo, boss.login)?.id });

  await page.goto("/idps");
  await page.getByLabel(/^Сотрудник/).selectOption({ label: person.name });
  await page.getByLabel(/^Цель/).selectOption("programmer");
  await page.getByLabel("Начало").fill("2026-04-01");
  await page.getByLabel("Конец").fill("2026-10-31");
  await page.getByRole("button", { name: "Создать" }).click();
  await expect(page.locator("li", { hasText: person.name }).getByText("активен", { exact: true })).toBeVisible();
  await page.goto(idpPath);
  await expect(page.getByRole("row", { name: new RegExp(goal) })).toBeVisible();
  const plans = plansOf(testInfo, person.login);
  expect(plans.filter((row) => row.status === "cancelled")).toEqual(cancelled);
  expect(plans.some((row) => row.status === "active")).toBe(true);
});

test("критерий 2: возврат без руководителя оставляет «нет» и не показывает ошибку", async ({ page }, testInfo) => {
  const person = { login: "e2e.back.none", name: "Возврат без руководителя E2E", password: "e2e-back-none-password" };
  await login(page);
  await addPerson(page, person, "junior");
  await openPerson(page, person.name);
  await deactivate(page);
  await returnForm(page).getByLabel(/^Руководитель/).selectOption({ label: "нет" });
  await returnForm(page).getByRole("button", { name: "Вернуть в активные" }).click();
  await expect(page.getByRole("button", { name: "Деактивировать" })).toBeVisible();
  await expect(page.locator(".form-error")).toHaveCount(0);
  await expect(fact(page, "Активен")).toHaveText("да");
  await expect(fact(page, "Руководитель")).toHaveText("нет");
  expect(personRow(testInfo, person.login)).toMatchObject({ is_active: 1, manager_id: null });
});

test("критерий 3: не админ и деактивированный не возвращают сотрудника", async ({ page }, testInfo) => {
  const boss = { login: "e2e.back.deny.boss", name: "Не админ возврата E2E", password: "e2e-back-deny-boss-password" };
  const person = { login: "e2e.back.deny", name: "Чужой возврат E2E", password: "e2e-back-deny-password" };
  await login(page);
  await addPerson(page, boss, "junior");
  await addPerson(page, person, "junior", boss.name);
  await openPerson(page, person.name);
  await deactivate(page);
  const employeeId = new URL(page.url()).pathname.split("/").filter(Boolean).pop() ?? "";

  const cardPath = new URL(page.url()).pathname;
  let release!: (value: CapturedPost) => void;
  const captured = new Promise<CapturedPost>((resolve) => {
    release = resolve;
  });
  const pattern = `**/people/${employeeId}`;
  await page.route(pattern, async (route) => {
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
    await returnForm(page).getByRole("button", { name: "Вернуть в активные" }).click();
    post = await captured;
  } finally {
    await page.unroute(pattern);
  }
  await page.goto(cardPath);
  await expect(fact(page, "Активен")).toHaveText("нет");

  await logout(page);
  await page.goto("/login");
  const form = page.locator('form:has(input[name="intent"][value="login"])');
  await form.getByLabel("Логин").fill(person.login);
  await form.getByLabel("Пароль", { exact: true }).fill(person.password);
  await form.getByRole("button", { name: "Войти" }).click();
  await expect(page.locator(".form-error[role='alert']")).toHaveText("Неверный логин или пароль");
  const guest = await page.request.post(post.url, {
    headers: {
      "next-action": post.headers["next-action"],
      "content-type": post.headers["content-type"],
      accept: post.headers.accept ?? "text/x-component",
    },
    data: post.body,
    maxRedirects: 0,
  });
  expect(await guest.text()).toContain("Нужна сессия сотрудника");

  await login(page, boss);
  const denied = await page.request.post(post.url, {
    headers: {
      "next-action": post.headers["next-action"],
      "content-type": post.headers["content-type"],
      accept: post.headers.accept ?? "text/x-component",
    },
    data: post.body,
    maxRedirects: 0,
  });
  expect(await denied.text()).toContain("Нужна сессия администратора");
  expect(personRow(testInfo, person.login)?.is_active).toBe(0);
});
