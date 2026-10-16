import { expect, test, type Page } from "@playwright/test";
import { ASSIGNMENT_IMPORT_COLUMNS } from "../src/lib/assignment-workbook";
import { writeXlsxSheet } from "../src/lib/xlsx-sheet";
import { E2E_ADMIN, E2E_ADMIN_PASSWORD } from "./env";

test.describe.configure({ mode: "serial" });

const STAMP = Date.now();
const CMP = `e2exls${STAMP}`;
const CMP_NAME = `Компетенция файла ${STAMP}`;
const NAME = `Из файла ${STAMP}`;
const STAY = `Рядом ${STAMP}`;
const STAY_LEARN = `Узнать рядом ${STAMP}`;
const FRESH = `Новое после скрытого ${STAMP}`;
const SKIPPED = `Не записано ${STAMP}`;
const L1 = `Узнать файл ${STAMP}`;
const V1 = `Проверить файл ${STAMP}`;
const Q1 = `Вопрос файла ${STAMP}`;
const L2 = `Узнать замена ${STAMP}`;
const V2 = `Проверить замена ${STAMP}`;
const Q2 = `Вопрос замена ${STAMP}`;
const SNAP = `Снимок файла ${STAMP}`;
const L3 = `Узнать снимок ${STAMP}`;
const V3 = `Проверить снимок ${STAMP}`;
const Q3 = `Вопрос снимок ${STAMP}`;
const STAFF = { login: `e2e.xls.${STAMP}`, name: `Сотрудник файла ${STAMP}`, password: "e2e-xls-password" };
const MANAGER = { login: `e2e.xlsm.${STAMP}`, name: `Руководитель файла ${STAMP}`, password: "e2e-xls-manager" };

let cardPath = "";
let idpPath = "";

function sheet(rows: string[][]) {
  return writeXlsxSheet([[...ASSIGNMENT_IMPORT_COLUMNS], ...rows]);
}

function pair(
  competencyId: string,
  name: string,
  learn: string,
  verify: string,
  prompt: string,
  yes: string,
  no: string,
): string[][] {
  return [
    [competencyId, name, learn, verify, prompt, yes, "да"],
    [competencyId, name, learn, verify, prompt, no, "нет"],
  ];
}

async function login(page: Page, account: { login: string; password: string } = E2E_ADMIN) {
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
    if (account.login !== E2E_ADMIN.login) {
      await page.getByRole("button", { name: "Выйти" }).click();
      await page.goto("/login");
    }
  }
  if (!/\/me$/.test(page.url())) {
    const form = page.locator('form:has(input[name="intent"][value="login"])');
    await form.getByLabel("Логин").fill(account.login);
    await form.getByLabel("Пароль", { exact: true }).fill(account.password);
    await form.getByRole("button", { name: "Войти" }).click();
  }
  await expect(page).toHaveURL(/\/me$/);
}

function uploadForm(page: Page) {
  return page.getByRole("form", { name: "Загрузка" });
}

async function upload(page: Page, rows: string[][]) {
  await page.goto("/assignments");
  await uploadForm(page).getByLabel("Файл Excel").setInputFiles({
    name: "assignments.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: sheet(rows),
  });
  const done = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().includes("/assignments"),
  );
  await uploadForm(page).getByRole("button", { name: "Загрузить" }).click();
  await done;
}

test("новое задание из файла появляется в справочнике с вопросом", async ({ page }) => {
  await login(page);
  await page.goto("/admin/competencies/new");
  await page.getByLabel("Идентификатор").fill(CMP);
  await page.getByLabel("Название").fill(CMP_NAME);
  await page.getByRole("button", { name: "Создать" }).click();
  await expect(page.getByRole("heading", { level: 1, name: CMP_NAME })).toBeVisible();

  await upload(page, [
    [CMP, NAME, L1, V1, Q1, "Один", "да"],
    [CMP, NAME.toLowerCase(), L1, V1, Q1.toLowerCase(), "Два", "нет"],
  ]);
  await expect(uploadForm(page).getByRole("status")).toContainText("Загружено заданий: 1.");
  await page.getByRole("link", { name: NAME, exact: true }).click();
  await expect(page).toHaveURL(/\/assignments\/asg/);
  cardPath = new URL(page.url()).pathname;
  await expect(page.getByRole("heading", { level: 1, name: NAME })).toBeVisible();
  await expect(page.getByLabel("Вопрос")).toHaveValue(Q1);
  await expect(page.getByLabel("Вариант").nth(0)).toHaveValue("Один");
  await expect(page.getByLabel("Вариант").nth(1)).toHaveValue("Два");
  await expect(page.getByLabel(/^Уровень/)).toHaveValue("");
});

test("повторная загрузка меняет тексты и вопрос, чужое задание остаётся", async ({ page }) => {
  await login(page);
  await page.goto("/assignments/new");
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Создать" }) });
  await form.getByLabel(/^Компетенция/).selectOption(CMP);
  await form.getByLabel(/^Название/).fill(STAY);
  await form.getByLabel(/^Узнать/).fill(STAY_LEARN);
  await form.getByLabel(/^Проверить/).fill("Проверить рядом");
  await form.getByRole("button", { name: "Создать" }).click();
  await expect(page).toHaveURL(/\/assignments\/asg/);

  await page.goto(cardPath);
  const save = page.locator("form", { has: page.getByRole("button", { name: "Сохранить", exact: true }) });
  await save.getByLabel(/^Уровень/).selectOption("1");
  const saved = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().includes("/assignments/"),
  );
  await save.getByRole("button", { name: "Сохранить", exact: true }).click();
  await saved;
  await expect(save.getByLabel(/^Уровень/)).toHaveValue("1");

  await upload(page, pair(CMP, NAME.toLowerCase(), L2, V2, Q2, "Альфа", "Бета"));
  await page.goto(cardPath);
  await expect(page.getByLabel(/^Узнать/)).toHaveValue(L2);
  await expect(page.getByLabel(/^Проверить/)).toHaveValue(V2);
  await expect(page.getByLabel("Вопрос")).toHaveValue(Q2);
  await expect(page.getByLabel(/^Уровень/)).toHaveValue("1");
  await page.goto("/assignments");
  await expect(page.getByRole("link", { name: STAY, exact: true })).toBeVisible();
  await page.getByRole("link", { name: STAY, exact: true }).click();
  await expect(page.getByLabel(/^Узнать/)).toHaveValue(STAY_LEARN);
});

test("строка ИПР хранит тексты и вопрос до загрузки", async ({ page }) => {
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
  const poolId =
    (await page
      .locator("form", { has: page.getByRole("heading", { name: "Добавить задание" }) })
      .getByLabel(/^Компетенция/)
      .locator("option")
      .first()
      .getAttribute("value")) ?? "";

  await upload(page, pair(poolId, SNAP, L2, V2, Q2, "Альфа", "Бета"));
  await page.getByRole("link", { name: SNAP, exact: true }).click();
  const save = page.locator("form", { has: page.getByRole("button", { name: "Сохранить", exact: true }) });
  await save.getByLabel(/^Уровень/).selectOption("1");
  const saved = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().includes("/assignments/"),
  );
  await save.getByRole("button", { name: "Сохранить", exact: true }).click();
  await saved;
  await page.reload();
  await expect(page.getByLabel(/^Уровень/)).toHaveValue("1");

  await page.goto(idpPath);
  const add = page.locator("form", { has: page.getByRole("heading", { name: "Добавить задание" }) });
  const catalog = add.getByLabel(/^Из справочника/);
  await catalog.selectOption({ value: (await catalog.locator("option", { hasText: SNAP }).getAttribute("value")) ?? "" });
  await add.getByRole("button", { name: "Добавить" }).click();
  const row = page.getByRole("row", { name: new RegExp(SNAP) });
  await expect(row).toContainText(L2);
  await expect(row).toContainText(V2);

  await upload(page, pair(poolId, SNAP, L3, V3, Q3, "Гамма", "Дельта"));
  await page.goto(idpPath);
  const kept = page.getByRole("row", { name: new RegExp(SNAP) });
  await expect(kept).toContainText(L2);
  await expect(kept).toContainText(V2);
  await expect(kept).not.toContainText(L3);
  await expect(kept).not.toContainText(V3);

  await login(page, STAFF);
  await page.goto(idpPath);
  await page.getByRole("row", { name: new RegExp(SNAP) }).getByRole("link", { name: "Сдать тест" }).click();
  await expect(page.getByText(Q2)).toBeVisible();
  await expect(page.getByText(Q3)).toHaveCount(0);
  await expect(page.getByText(V2)).toBeVisible();
  await expect(page.getByText(V3)).toHaveCount(0);
});

test("ошибочный файл ничего не записывает и показывает перечень", async ({ page }) => {
  await login(page);
  await upload(page, [
    [`no-such-${STAMP}`, `Чужой ${STAMP}`, L1, V1, "Чужой вопрос", "Один", "да"],
    [`no-such-${STAMP}`, `Чужой ${STAMP}`, L1, V1, "Чужой вопрос", "Два", "нет"],
    [CMP, `Два верных ${STAMP}`, L1, V1, "Два верных", "А", "да"],
    [CMP, `Два верных ${STAMP}`, L1, V1, "Два верных", "Б", "да"],
    [CMP, SKIPPED, L1, V1, "", "", ""],
    [CMP, NAME, "", V3, "", "", ""],
  ]);
  const alert = uploadForm(page).getByRole("alert");
  await expect(alert).toContainText("Неизвестная компетенция");
  await expect(alert).toContainText("ровно один верный вариант");
  await expect(alert).toContainText("нужны «узнать» и «проверить»");
  await expect(page.getByRole("link", { name: SKIPPED, exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: `Два верных ${STAMP}`, exact: true })).toHaveCount(0);
  await page.goto(cardPath);
  await expect(page.getByLabel(/^Узнать/)).toHaveValue(L2);
  await expect(page.getByLabel("Вопрос")).toHaveValue(Q2);
});

test("не админ не видит загрузку", async ({ page }) => {
  await login(page);
  await page.goto("/people");
  const person = page.locator("form", { has: page.getByRole("heading", { name: "Новый сотрудник" }) });
  await person.getByLabel("Логин").fill(MANAGER.login);
  await person.getByLabel("Имя").fill(MANAGER.name);
  await person.getByLabel("Пароль").fill(MANAGER.password);
  await person.getByLabel(/^Должность/).selectOption("programmer");
  await person.getByRole("button", { name: "Создать" }).click();
  await expect(page.getByRole("link", { name: MANAGER.name, exact: true })).toBeVisible();
  await page.reload();
  await person.getByLabel("Логин").fill(`e2e.xlssub.${STAMP}`);
  await person.getByLabel("Имя").fill(`Подчинённый файла ${STAMP}`);
  await person.getByLabel("Пароль").fill("e2e-xls-sub");
  await person.getByLabel(/^Должность/).selectOption("junior");
  await person.getByLabel(/^Руководитель/).selectOption({ label: MANAGER.name });
  await person.getByRole("button", { name: "Создать" }).click();
  await expect(page.getByRole("link", { name: `Подчинённый файла ${STAMP}`, exact: true })).toBeVisible();

  await login(page, MANAGER);
  await page.goto("/assignments");
  await expect(page.getByRole("heading", { name: "Задания ИПР" })).toBeVisible();
  await expect(uploadForm(page)).toHaveCount(0);
});

test("скрытое задание файл не меняет и называет в итоге", async ({ page }) => {
  await login(page);
  await page.goto("/assignments");
  await page.getByRole("link", { name: STAY, exact: true }).click();
  await page.getByRole("button", { name: "Перенести в архив" }).click();
  await expect(page.getByRole("button", { name: "Вернуть" })).toBeVisible();

  await upload(page, [
    ...pair(CMP, STAY, `Узнать скрытое ${STAMP}`, "Проверить скрытое", "Вопрос скрытого", "Да", "Нет"),
    [CMP, FRESH, `Узнать новое ${STAMP}`, "Проверить новое", "", "", ""],
  ]);
  await expect(uploadForm(page).getByRole("status")).toContainText(`Скрытые без изменений: ${STAY}`);
  await expect(page.getByRole("link", { name: FRESH, exact: true })).toBeVisible();
  await page.getByRole("link", { name: STAY, exact: true }).click();
  await page.getByRole("button", { name: "Вернуть" }).click();
  await expect(page.getByLabel(/^Узнать/)).toHaveValue(STAY_LEARN);
  await page.goto("/assignments");
  await expect(page.getByRole("link", { name: STAY, exact: true })).toHaveCount(1);
});

test("колонка уровня записывает 1–3, пустая ячейка уровень не сбрасывает", async ({ page }) => {
  const leveled = `С уровнем ${STAMP}`;
  const header = [...ASSIGNMENT_IMPORT_COLUMNS, "Уровень"];
  function leveledFile(level: string) {
    return writeXlsxSheet([
      header,
      [CMP, leveled, L1, V1, "Вопрос уровня", "Да", "да", level],
      [CMP, leveled, L1, V1, "Вопрос уровня", "Нет", "нет", level],
    ]);
  }
  async function send(buffer: Buffer) {
    await page.goto("/assignments");
    await uploadForm(page).getByLabel("Файл Excel").setInputFiles({
      name: "assignments.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer,
    });
    const done = page.waitForResponse(
      (response) => response.request().method() === "POST" && response.url().includes("/assignments"),
    );
    await uploadForm(page).getByRole("button", { name: "Загрузить" }).click();
    await done;
  }

  await login(page);
  await send(leveledFile("2"));
  await expect(uploadForm(page).getByRole("status")).toContainText("Загружено заданий: 1.");
  await page.getByRole("link", { name: leveled, exact: true }).click();
  const card = new URL(page.url()).pathname;
  await expect(page.getByLabel(/^Уровень/)).toHaveValue("2");

  await send(leveledFile(""));
  await page.goto(card);
  await expect(page.getByLabel(/^Уровень/)).toHaveValue("2");

  await send(leveledFile("3"));
  await page.goto(card);
  await expect(page.getByLabel(/^Уровень/)).toHaveValue("3");

  const bad = `Плохой уровень ${STAMP}`;
  await send(
    writeXlsxSheet([
      header,
      [CMP, bad, L1, V1, "", "", "", "4"],
    ]),
  );
  await expect(uploadForm(page).getByRole("alert")).toContainText("уровень");
  await expect(page.getByRole("link", { name: bad, exact: true })).toHaveCount(0);
  await page.goto(card);
  await expect(page.getByLabel(/^Уровень/)).toHaveValue("3");
});
