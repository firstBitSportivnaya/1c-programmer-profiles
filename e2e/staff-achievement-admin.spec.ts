/**
 * Достижения: админка каталога (ADR 0010, issue #118).
 *
 * Файл работает от админа: сессия одна на воркер (см. `e2e/fixtures.ts`). Записи каталога создаются
 * с ключом от `Date.now()`, поэтому прогон на одной базе не упирается в уже занятый ключ. Проверки
 * смотрят и экран, и строку каталога в базе воркера: видно, что записалось, а не только что показано.
 */
import { DatabaseSync } from "node:sqlite";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { expect, login, test } from "./fixtures";
import { workerDbPath } from "./env";

test.describe.configure({ mode: "serial" });

test.use({ asAdmin: true });

const STAMP = Date.now();
const KEY = `e2e-award-${STAMP}`;
const TITLE = `E2E награда ${STAMP}`;
const DESCRIPTION = `Описание награды ${STAMP}`;
const EDITED = `E2E награда правка ${STAMP}`;
const EDITED_DESCRIPTION = `Описание после правки ${STAMP}`;
const JOB_KEY = `e2e-award-job-${STAMP}`;
const RULE_KEY = `e2e-award-changerule-${STAMP}`;
const PLAIN = { login: `e2e.award.admin.${STAMP}`, name: `Не админ каталога ${STAMP}`, password: "e2e-award-password" };
/** Идентификатор серверного действия создания: его запоминает проверка сотрудника, гость повторяет POST. */
let createActionId = "";

type CatalogRow = {
  id: string;
  title: string;
  description: string;
  category: string;
  rule: string;
  rule_param: string | null;
  icon: string;
  archived: number;
};

type Grant = {
  achievement_id: string;
  source: string;
  granted_by_id: string | null;
  revoked_at: number | null;
};

/** База воркера этого теста: у каждого воркера своя, см. `e2e/env.ts`. */
function dbFile(testInfo: TestInfo) {
  return workerDbPath(testInfo.parallelIndex);
}

/** Строка каталога по ключу: проверки критериев смотрят базу, а не только экран. */
function catalogRow(testInfo: TestInfo, id: string): CatalogRow | undefined {
  const db = new DatabaseSync(dbFile(testInfo), { readOnly: true });
  try {
    return db
      .prepare(
        `SELECT id, title, description, category, rule, rule_param, icon, archived
         FROM achievements WHERE id = ?`,
      )
      .get(id) as CatalogRow | undefined;
  } finally {
    db.close();
  }
}

/** id сотрудника по логину: ручная выдача в этом этапе задаётся строкой в базе. */
function employeeId(testInfo: TestInfo, loginName: string): string {
  const db = new DatabaseSync(dbFile(testInfo), { readOnly: true });
  try {
    const row = db.prepare("SELECT id FROM employees WHERE login = ?").get(loginName) as { id: string } | undefined;
    return row?.id ?? "";
  } finally {
    db.close();
  }
}

/** Ручная выдача прямо в базу: формы выдачи в этом этапе ещё нет (issue #119), критерий от неё не зависит. */
function grantManually(testInfo: TestInfo, loginName: string, achievementId: string) {
  const db = new DatabaseSync(dbFile(testInfo));
  try {
    const admin = db.prepare("SELECT id FROM employees WHERE is_admin = 1 ORDER BY login LIMIT 1").get() as
      | { id: string }
      | undefined;
    const employee = db.prepare("SELECT id FROM employees WHERE login = ?").get(loginName) as
      | { id: string }
      | undefined;
    if (!admin || !employee) throw new Error(`ручная выдача: не найден сотрудник ${loginName} или админ`);
    db.prepare(
      `INSERT INTO employee_achievements
         (employee_id, achievement_id, source, rule_key, source_ref, granted_at, granted_by_id)
       VALUES (?, ?, 'manual', NULL, NULL, ?, ?)`,
    ).run(employee.id, achievementId, Math.floor(Date.now() / 1000), admin.id);
  } finally {
    db.close();
  }
}

/** Автоматическая выдача прямо в базу: смена правила каталога не должна ждать выполнения условия. */
function grantAuto(testInfo: TestInfo, loginName: string, achievementId: string, ruleKey: string) {
  const db = new DatabaseSync(dbFile(testInfo));
  try {
    const employee = db.prepare("SELECT id FROM employees WHERE login = ?").get(loginName) as
      | { id: string }
      | undefined;
    if (!employee) throw new Error(`автоматическая выдача: не найден сотрудник ${loginName}`);
    db.prepare(
      `INSERT INTO employee_achievements
         (employee_id, achievement_id, source, rule_key, source_ref, granted_at, granted_by_id)
       VALUES (?, ?, 'auto', ?, NULL, ?, NULL)`,
    ).run(employee.id, achievementId, ruleKey, Math.floor(Date.now() / 1000));
  } finally {
    db.close();
  }
}

/** Выдачи сотрудника по логину: проверка, что скрытие каталога строку выдачи не трогает. */
function grants(testInfo: TestInfo, loginName: string): Grant[] {
  const db = new DatabaseSync(dbFile(testInfo), { readOnly: true });
  try {
    return db
      .prepare(
        `SELECT ea.achievement_id, ea.source, ea.granted_by_id, ea.revoked_at
         FROM employee_achievements ea
         JOIN employees e ON e.id = ea.employee_id
         WHERE e.login = ?
         ORDER BY ea.achievement_id`,
      )
      .all(loginName) as Grant[];
  } finally {
    db.close();
  }
}

/** Заводит сотрудника админской формой `/people`; возвращает его id. */
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

/** Форма создания: поля каталога и кнопка «Создать». */
function createForm(page: Page) {
  return page.locator("form", { has: page.getByRole("button", { name: "Создать", exact: true }) });
}

/** Форма правки: карточка записи каталога. */
function editForm(page: Page) {
  return page.locator("form", { has: page.getByRole("button", { name: "Сохранить", exact: true }) });
}

/** Строка каталога в списке: ссылка ведёт на карточку по ключу. */
function catalogRowUi(page: Page, id: string) {
  return page
    .getByTestId("achievements-catalog")
    .getByRole("listitem")
    .filter({ has: page.locator(`a[href="/admin/achievements/${id}"]`) });
}

/** Заполняет поля записи. Значения по умолчанию — допустимые: тест меняет только проверяемое поле. */
async function fillAchievement(
  form: Locator,
  values: { key: string; title: string; description: string; category?: string; rule?: string; icon?: string },
) {
  await form.getByRole("textbox", { name: "Ключ", exact: true }).fill(values.key);
  await form.getByRole("textbox", { name: "Название", exact: true }).fill(values.title);
  await form.getByRole("textbox", { name: "Описание", exact: true }).fill(values.description);
  if (values.category) await form.getByLabel(/^Категория/).selectOption(values.category);
  if (values.rule) await form.getByLabel(/^Правило/).selectOption(values.rule);
  if (values.icon) await form.getByRole("combobox", { name: /^Иконка/ }).selectOption(values.icon);
}

/** Значение, которого нет в закрытом списке: так проверяется отказ сервера, а не только подсказка в форме. */
async function addOption(select: Locator, value: string) {
  await select.evaluate((element, optionValue) => {
    const option = document.createElement("option");
    option.value = optionValue;
    option.textContent = optionValue;
    element.append(option);
  }, value);
  await select.selectOption(value);
}

/** Ошибка формы после отправки: текст роли `alert` внутри формы, а не класс оформления. */
async function expectFormError(form: Locator, message: string) {
  await form.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(form.getByRole("alert")).toHaveText(message);
}

/**
 * id серверного действия создания из HTML страницы. В RSC-потоке ссылка на действие стоит рядом
 * с `"bound"`; по ней форма и уходит на сервер. Нужен, чтобы повторить POST от чужого имени.
 */
async function readCreateActionId(page: Page) {
  const html = await (await page.request.get("/admin/achievements/new")).text();
  const match = [...html.matchAll(/[0-9a-f]{40,44}/g)].find((item) =>
    html
      .slice((item.index ?? 0) + item[0].length, (item.index ?? 0) + item[0].length + 40)
      .includes("bound"),
  );
  if (!match) throw new Error("в разметке нет идентификатора действия создания");
  return match[0];
}

/** Повтор POST формы каталога от чужого имени: сервер обязан отказать до записи в базу. */
async function replaySave(page: Page, values: { key: string; create: boolean }) {
  return page.request.post("/admin/achievements/new", {
    headers: { "next-action": createActionId, accept: "text/x-component" },
    multipart: {
      ...(values.create ? { "1_create": "1" } : {}),
      "1_id": values.key,
      "1_title": "Чужая правка каталога",
      "1_description": "Запись, которую не должен создать не админ",
      "1_category": "idp",
      "1_rule": "manual",
      "1_icon": "flag",
      "0": '[null,"$K1"]',
    },
    maxRedirects: 0,
  });
}

test("критерий 1: создание записи, список и сохранённые значения после перезагрузки", async ({ page }, testInfo) => {
  await page.goto("/admin/achievements/new");
  const form = createForm(page);
  await fillAchievement(form, {
    key: KEY,
    title: TITLE,
    description: DESCRIPTION,
    category: "mentoring",
    rule: "idp.items-3",
    icon: "clock",
  });
  await form.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/achievements/${KEY}$`));
  await expect(page.getByRole("heading", { level: 1, name: TITLE })).toBeVisible();

  // После перезагрузки карточка показывает те же категорию, правило и иконку.
  await page.reload();
  const edit = editForm(page);
  await expect(edit.getByRole("textbox", { name: "Название", exact: true })).toHaveValue(TITLE);
  await expect(edit.getByLabel(/^Категория/)).toHaveValue("mentoring");
  await expect(edit.getByLabel(/^Правило/)).toHaveValue("idp.items-3");
  await expect(edit.getByRole("combobox", { name: /^Иконка/ })).toHaveValue("clock");

  // Список: ключ, категория, правило и иконка видны в строке.
  await page.goto("/admin/achievements");
  const rows = page.getByTestId("achievements-catalog").getByRole("listitem");
  expect(await rows.count(), "в каталоге тридцать записей seed и больше").toBeGreaterThanOrEqual(30);
  const row = catalogRowUi(page, KEY);
  await expect(row.getByRole("link", { name: TITLE })).toBeVisible();
  await expect(row).toContainText(KEY);
  await expect(row).toContainText("Наставничество");
  await expect(row).toContainText("Три строки ИПР");
  await expect(row.locator('svg[data-icon="clock"]')).toBeVisible();
  await expect(row.getByText("скрыто", { exact: true })).toHaveCount(0);

  expect(catalogRow(testInfo, KEY), "запись каталога в базе").toMatchObject({
    title: TITLE,
    description: DESCRIPTION,
    category: "mentoring",
    rule: "idp.items-3",
    rule_param: null,
    icon: "clock",
    archived: 0,
  });
});

test("критерий 1: правило «Назначена должность» сохраняет параметр и скрывается", async ({ page }, testInfo) => {
  await page.goto("/admin/achievements/new");
  const form = createForm(page);
  await fillAchievement(form, {
    key: JOB_KEY,
    title: `E2E должность ${STAMP}`,
    description: `Описание должности ${STAMP}`,
    category: "career",
    rule: "job.assigned",
    icon: "code",
  });
  // Поле должности появляется только у правила с параметром.
  await form.getByLabel(/^Должность/).selectOption("architect");
  await form.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/achievements/${JOB_KEY}$`));
  await page.reload();
  await expect(editForm(page).getByLabel(/^Правило/)).toHaveValue("job.assigned");
  await expect(editForm(page).getByLabel(/^Должность/)).toHaveValue("architect");
  expect(catalogRow(testInfo, JOB_KEY)?.rule_param, "параметр правила записан").toBe("architect");

  // Запись не нужна соседним спецификациям: скрываем её той же кнопкой, что и в критерии 3.
  await page.getByRole("button", { name: "Скрыть", exact: true }).click();
  await expect
    .poll(() => catalogRow(testInfo, JOB_KEY)?.archived, "запись скрыта")
    .toBe(1);
  await page.goto("/admin/achievements");
  await expect(catalogRowUi(page, JOB_KEY).getByText("скрыто", { exact: true })).toBeVisible();
});

test("критерий 2: правка названия и описания, ключ прежний", async ({ page }, testInfo) => {
  const before = catalogRow(testInfo, KEY);
  expect(before, "запись из критерия 1 на месте").toBeDefined();

  await page.goto(`/admin/achievements/${KEY}`);
  const form = editForm(page);
  await expect(form.getByRole("textbox", { name: "Ключ" })).toHaveCount(0);
  await form.getByRole("textbox", { name: "Название", exact: true }).fill(EDITED);
  await form.getByRole("textbox", { name: "Описание", exact: true }).fill(EDITED_DESCRIPTION);
  const posted = page.waitForResponse((response) => response.request().method() === "POST");
  await form.getByRole("button", { name: "Сохранить", exact: true }).click();
  await posted;

  await expect(page.getByRole("heading", { level: 1, name: EDITED })).toBeVisible();
  await page.goto("/admin/achievements");
  await expect(catalogRowUi(page, KEY).getByRole("link", { name: EDITED })).toBeVisible();

  const after = catalogRow(testInfo, KEY);
  expect(after, "строка каталога одна и с тем же ключом").toMatchObject({
    id: KEY,
    title: EDITED,
    description: EDITED_DESCRIPTION,
    category: before!.category,
    rule: before!.rule,
    icon: before!.icon,
  });
});

test("критерий 3: скрытие убирает запись из выдачи, но не забирает достижение у сотрудника", async ({ page }, testInfo) => {
  await createStaff(page, PLAIN, "junior");
  const employee = employeeId(testInfo, PLAIN.login);
  expect(employee, "id сотрудника найден").not.toBe("");
  grantManually(testInfo, PLAIN.login, KEY);

  await login(page, PLAIN);
  await page.goto("/me/achievements");
  await expect(
    page.getByTestId("achievements-list").getByRole("listitem").filter({ hasText: EDITED }),
    "до скрытия достижение видно сотруднику",
  ).toBeVisible();

  await login(page);
  await page.goto(`/admin/achievements/${KEY}`);
  const posted = page.waitForResponse((response) => response.request().method() === "POST");
  await page.getByRole("button", { name: "Скрыть", exact: true }).click();
  await posted;
  await expect.poll(() => catalogRow(testInfo, KEY)?.archived, "запись скрыта в каталоге").toBe(1);

  await page.goto("/admin/achievements");
  const row = catalogRowUi(page, KEY);
  await expect(row.getByRole("link", { name: EDITED }), "скрытая запись остаётся в списке").toBeVisible();
  await expect(row.getByText("скрыто", { exact: true })).toBeVisible();

  const grantsAfterHide = grants(testInfo, PLAIN.login).filter((item) => item.achievement_id === KEY);
  expect(grantsAfterHide, "выдача одна").toHaveLength(1);
  expect(grantsAfterHide[0], "скрытие каталога выдачи не отзывает").toMatchObject({
    source: "manual",
    revoked_at: null,
  });
  expect(grantsAfterHide[0].granted_by_id, "автор ручной выдачи записан").not.toBeNull();

  await login(page, PLAIN);
  await page.goto("/me/achievements");
  await expect(
    page.getByTestId("achievements-list").getByRole("listitem").filter({ hasText: EDITED }),
    "достижение остаётся у сотрудника",
  ).toBeVisible();
});

test("смена правила на «Вручную» отзывает автоматическую выдачу прошлого правила", async ({ page }, testInfo) => {
  // Предыдущий шаг закончился учёткой сотрудника: каталог правит админ.
  await login(page);
  await page.goto("/admin/achievements/new");
  const create = createForm(page);
  await fillAchievement(create, {
    key: RULE_KEY,
    title: `E2E правило ${STAMP}`,
    description: `Описание правила ${STAMP}`,
    category: "idp",
    rule: "idp.items-3",
    icon: "checklist",
  });
  await create.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/achievements/${RULE_KEY}$`));

  // Автоматическая выдача прошлого правила: строку пишем в базу, условие выполнять не нужно.
  grantAuto(testInfo, PLAIN.login, RULE_KEY, "idp.items-3");

  const edit = editForm(page);
  await edit.getByLabel(/^Правило/).selectOption("manual");
  const posted = page.waitForResponse((response) => response.request().method() === "POST");
  await edit.getByRole("button", { name: "Сохранить", exact: true }).click();
  await posted;

  // Страницу достижений сотрудника не открываем: отзыв даёт само сохранение правила.
  await expect
    .poll(
      () => grants(testInfo, PLAIN.login).find((row) => row.achievement_id === RULE_KEY)?.revoked_at,
      "автоматическая выдача отозвана",
    )
    .not.toBeNull();
  expect(catalogRow(testInfo, RULE_KEY)?.rule, "правило записи стало ручным").toBe("manual");
});

test("критерий 4 (негативный): сотрудник раздел не видит, сервер правку не принимает", async ({ page }, testInfo) => {
  await page.goto("/admin/achievements/new");
  createActionId = await readCreateActionId(page);
  const before = catalogRow(testInfo, KEY);

  await login(page, PLAIN);
  await page.goto("/admin/achievements");
  await expect(page).toHaveURL(/\/me$/);
  await expect(page.getByRole("heading", { name: "Каталог достижений" })).toHaveCount(0);
  await expect(page.getByTestId("achievements-catalog")).toHaveCount(0);

  await page.goto("/admin/achievements/new");
  await expect(page).toHaveURL(/\/me$/);
  await page.goto(`/admin/achievements/${KEY}`);
  await expect(page).toHaveURL(/\/me$/);
  await expect(page.getByRole("button", { name: "Сохранить" })).toHaveCount(0);

  // Повтор настоящего POST формы: страница могла бы просто спрятать форму, сервер обязан отказать.
  const edit = await replaySave(page, { key: KEY, create: false });
  expect(await edit.text(), "сервер отказал в правке").toContain("Нужна сессия администратора");
  const create = await replaySave(page, { key: `e2e-award-forged-${STAMP}`, create: true });
  expect(await create.text(), "сервер отказал в создании").toContain("Нужна сессия администратора");

  expect(catalogRow(testInfo, KEY), "строка каталога не изменилась").toEqual(before);
  expect(catalogRow(testInfo, `e2e-award-forged-${STAMP}`), "чужой ключ не записан").toBeUndefined();
});

test.describe("гость", () => {
  // Гостевые проверки идут без cookie админа (см. e2e/fixtures.ts).
  test.use({ asAdmin: false });

  test("критерий 4 (негативный): гость уходит на вход, действие правки не проходит", async ({ page }, testInfo) => {
    expect(createActionId, "идентификатор действия снят с админской страницы").not.toBe("");
    const before = catalogRow(testInfo, KEY);

    await page.goto("/admin/achievements");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Каталог достижений" })).toHaveCount(0);
    await page.goto("/admin/achievements/new");
    await expect(page).toHaveURL(/\/login$/);
    await page.goto(`/admin/achievements/${KEY}`);
    await expect(page).toHaveURL(/\/login$/);

    const edit = await replaySave(page, { key: KEY, create: false });
    expect(await edit.text(), "сервер отказал гостю").toContain("Нужна сессия сотрудника");
    expect(catalogRow(testInfo, KEY), "строка каталога не изменилась").toEqual(before);
  });
});

test("критерий 5 (негативный): пустое название и значения вне закрытых списков не сохраняются", async ({
  page,
}, testInfo) => {
  // Пустое название.
  const emptyKey = `e2e-award-empty-${STAMP}`;
  await page.goto("/admin/achievements/new");
  let form = createForm(page);
  await fillAchievement(form, { key: emptyKey, title: "", description: DESCRIPTION });
  await expectFormError(form, "Нужно название");
  expect(catalogRow(testInfo, emptyKey), "запись без названия не создана").toBeUndefined();

  // Категория, правило и иконка вне закрытых списков: значение добавляется в DOM и уходит в POST.
  const cases = [
    { suffix: "category", field: /^Категория/, message: "Категория: выберите из списка" },
    { suffix: "rule", field: /^Правило/, message: "Правило: выберите из списка" },
    { suffix: "icon", field: /^Иконка/, message: "Иконка: выберите из списка" },
  ] as const;
  for (const item of cases) {
    const key = `e2e-award-${item.suffix}-${STAMP}`;
    await page.goto("/admin/achievements/new");
    form = createForm(page);
    await fillAchievement(form, { key, title: `E2E ${item.suffix}`, description: DESCRIPTION });
    const select = form.getByRole("combobox", { name: item.field });
    await addOption(select, "space");
    await expectFormError(form, item.message);
    expect(catalogRow(testInfo, key), `запись с чужим значением ${item.suffix} не создана`).toBeUndefined();
  }

  // Правилу «Назначена должность» нужна существующая должность: без параметра запись не пишется.
  const jobKey = `e2e-award-nojob-${STAMP}`;
  await page.goto("/admin/achievements/new");
  form = createForm(page);
  await fillAchievement(form, { key: jobKey, title: `E2E без должности ${STAMP}`, description: DESCRIPTION, rule: "job.assigned" });
  await expect(form.getByLabel(/^Должность/)).toHaveValue("");
  await expectFormError(form, "Правилу «Назначена должность» нужна должность");
  expect(catalogRow(testInfo, jobKey), "запись без должности не создана").toBeUndefined();
});

test("поиск каталога не зависит от регистра, сортировка остаётся в адресе", async ({ page }) => {
  await page.goto("/admin/achievements");
  const catalog = page.getByTestId("achievements-catalog");
  await page.getByLabel("Поиск").fill("НАГРАДА");
  await expect(page).toHaveURL(/[?&]q=/);
  const links = catalog.getByRole("link");
  const upper = await links.allTextContents();
  expect(upper.length).toBeGreaterThan(0);
  await page.getByLabel("Поиск").fill("награда");
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("награда");
  await expect(links).toHaveText(upper);

  await page.getByLabel("Поиск").fill(`нет-награды-${STAMP}`);
  await expect(page.getByText("Ничего не найдено", { exact: true })).toBeVisible();
  await expect(catalog.locator("ul")).toHaveCount(0);

  await page.getByLabel("Поиск").fill("");
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe(null);
  await expect.poll(() => catalog.getByRole("link").count()).toBeGreaterThan(upper.length);
  const beforeSort = await catalog.getByRole("link").allTextContents();
  await page.getByLabel("Сортировка").selectOption("name-desc");
  await expect(page).toHaveURL(/[?&]sort=name-desc/);
  await expect(page).not.toHaveURL(/[?&]q=/);
  await expect.poll(async () => (await catalog.getByRole("link").allTextContents()).join("\n")).not.toBe(beforeSort.join("\n"));
  const names = await catalog.getByRole("link").allTextContents();
  expect(names).toEqual([...names].sort((a, b) => b.localeCompare(a, "ru")));
});

test("ключ new зарезервирован: запись, которую нельзя открыть и скрыть, не создаётся", async ({ page }, testInfo) => {
  await page.goto("/admin/achievements/new");
  const form = createForm(page);
  await fillAchievement(form, { key: "new", title: `E2E ключ new ${STAMP}`, description: DESCRIPTION });
  await expectFormError(form, "Ключ new зарезервирован");
  expect(catalogRow(testInfo, "new"), "запись с ключом new не создана").toBeUndefined();
});
