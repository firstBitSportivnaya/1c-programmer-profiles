/**
 * Достижения: ручная выдача и отзыв (ADR 0010, issue #119).
 *
 * Файл работает от админа: сессия одна на воркер (см. `e2e/fixtures.ts`). Сотрудники и оргсвязи
 * создаются этими же тестами, поэтому база воркера не зависит от seed. Проверки критериев 1–7
 * смотрят и экран, и строку выдачи в базе воркера: видно, что записалось, а не только что показано.
 * Повторный POST действия снимается с настоящей формы и проигрывается от чужого имени.
 */
import type { Page, TestInfo } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { expect, login, test } from "./fixtures";
import { workerDbPath } from "./env";

test.describe.configure({ mode: "serial" });

test.use({ asAdmin: true });

const STAMP = Date.now();
const PASSWORD = "e2e-manual-password";

function account(tag: string, name: string) {
  return { login: `e2e.ach.manual.${tag}.${STAMP}`, name: `${name} ${STAMP}`, password: PASSWORD };
}

const A = account("a", "Ручная выдача A");
const M2 = account("m2", "Руководитель M2");
const S2 = account("s2", "Подчинённый S2");
const M3 = account("m3", "Руководитель M3");
const S3 = account("s3", "Подчинённый S3");
const O3 = account("o3", "Чужой O3");
const X4 = account("x4", "Чужой X4");
const Y4 = account("y4", "Сотрудник Y4");
const R5 = account("r5", "Отзыв R5");
const G6 = account("g6", "Повтор G6");
const H7 = account("h7", "Автоматика H7");

const KNOWLEDGE = "contribution-knowledge";
const MENTOR = "contribution-mentoring";
const STANDARD = "contribution-standard";
const INCIDENT = "contribution-incident";
const SECURITY = "contribution-security";
const PROCESS = "contribution-process";
const FIRST_STEP = "idp-first-step";

const REVOKE_REASON = `Причина отзыва E2E ${STAMP}`;
const REPEAT_REASON = `Снимаем для повтора E2E ${STAMP}`;

/** Строка выдачи сотрудника: проверки смотрят базу, а не только экран. */
type Grant = {
  achievement_id: string;
  source: string;
  rule_key: string | null;
  source_ref: string | null;
  granted_at: number;
  granted_by_id: string | null;
  revoked_at: number | null;
  revoked_by_id: string | null;
  revoke_reason: string | null;
};

/** База воркера этого теста: у каждого воркера своя, см. `e2e/env.ts`. */
function dbFile(testInfo: TestInfo) {
  return workerDbPath(testInfo.parallelIndex);
}

/** Выдачи сотрудника по логину. Отозванные тоже возвращаются: проверки смотрят историю строки. */
function grants(testInfo: TestInfo, loginName: string): Grant[] {
  const db = new DatabaseSync(dbFile(testInfo), { readOnly: true });
  try {
    return db
      .prepare(
        `SELECT ea.achievement_id, ea.source, ea.rule_key, ea.source_ref, ea.granted_at, ea.granted_by_id,
                ea.revoked_at, ea.revoked_by_id, ea.revoke_reason
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

/** id админа: по нему подписаны ручная выдача и отзыв. */
function adminId(testInfo: TestInfo): string {
  const db = new DatabaseSync(dbFile(testInfo), { readOnly: true });
  try {
    const row = db.prepare("SELECT id FROM employees WHERE is_admin = 1 ORDER BY login LIMIT 1").get() as
      | { id: string }
      | undefined;
    return row?.id ?? "";
  } finally {
    db.close();
  }
}

/** Заводит сотрудника админской формой `/people`; возвращает его id. */
async function createPerson(
  page: Page,
  person: { login: string; name: string; password: string },
  managerName?: string,
) {
  await page.goto("/people");
  const form = page.locator("form", { has: page.getByRole("heading", { name: "Новый сотрудник" }) });
  await form.getByLabel("Логин").fill(person.login);
  await form.getByLabel("Имя").fill(person.name);
  await form.getByLabel("Пароль").fill(person.password);
  await form.getByLabel(/^Должность/).selectOption("junior");
  if (managerName) await form.getByLabel(/^Руководитель/).selectOption({ label: managerName });
  await form.getByRole("button", { name: "Создать" }).click();
  const link = page.getByRole("link", { name: person.name, exact: true });
  await expect(link).toBeVisible();
  return new URL((await link.getAttribute("href")) ?? "", "http://127.0.0.1").pathname.split("/").pop() ?? "";
}

/** Форма выдачи в секции достижений: узнаётся по кнопке, а не по порядку форм на странице. */
function grantForm(page: Page) {
  return page.getByTestId("employee-achievements").locator("form", {
    has: page.getByRole("button", { name: "Выдать", exact: true }),
  });
}

/** Руководитель или админ выдаёт достижение через форму карточки и ждёт строку в списке. */
async function grantViaUi(page: Page, employee: string, achievementId: string) {
  await page.goto(`/people/${employee}`);
  const form = grantForm(page);
  await form.getByRole("combobox", { name: /^Выдать достижение/ }).selectOption(achievementId);
  const posted = page.waitForResponse(
    (response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/people/${employee}`,
  );
  await form.getByRole("button", { name: "Выдать", exact: true }).click();
  await posted;
  await expect(page.getByTestId(`employee-achievement-${achievementId}`)).toBeVisible();
}

/** Отзыв через форму строки: причина обязательна, после успеха строка уходит из списка. */
async function revokeViaUi(page: Page, employee: string, achievementId: string, reason: string) {
  const row = page.getByTestId(`employee-achievement-${achievementId}`);
  await expect(row).toBeVisible();
  await row.getByRole("textbox", { name: "Причина", exact: true }).fill(reason);
  const posted = page.waitForResponse(
    (response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/people/${employee}`,
  );
  await row.getByRole("button", { name: "Отозвать", exact: true }).click();
  await posted;
  await expect(page.getByTestId(`employee-achievement-${achievementId}`)).toHaveCount(0);
}

/** Страница достижений сотрудника: заголовок и список на месте. */
async function openOwnAchievements(page: Page) {
  await page.goto("/me/achievements");
  await expect(page.getByRole("heading", { level: 1, name: "Достижения" })).toBeVisible();
}

/** Строка каталога на `/me/achievements` по названию: отозванная не должна находиться. */
function achievementRows(page: Page, title: string) {
  return page.getByTestId("achievements-list").getByRole("listitem").filter({ hasText: title });
}

/** Снятый с формы POST: действие и тело настоящие, запись в базу не проходит. */
type CapturedPost = { url: string; headers: Record<string, string>; body: Buffer };

/**
 * Снимает тело настоящего POST формы выдачи, не давая ему дойти до сервера.
 * Нужно, чтобы повторить действие от имени, которому оно запрещено.
 */
async function captureGrantPost(page: Page, employee: string, achievementId: string): Promise<CapturedPost> {
  let release!: (value: CapturedPost) => void;
  const captured = new Promise<CapturedPost>((resolve) => {
    release = resolve;
  });
  const pattern = `**/people/${employee}`;
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
  try {
    await page.goto(`/people/${employee}`);
    const form = grantForm(page);
    await form.getByRole("combobox", { name: /^Выдать достижение/ }).selectOption(achievementId);
    await form.getByRole("button", { name: "Выдать", exact: true }).click();
    return await Promise.race([
      captured,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("форма выдачи не отправила POST")), 20_000),
      ),
    ]);
  } finally {
    await page.unroute(pattern);
  }
}

/** Повтор снятого POST от текущей учётки: сервер обязан отказать до записи в базу. */
async function replayCaptured(page: Page, captured: CapturedPost) {
  return page.request.post(captured.url, {
    headers: {
      "next-action": captured.headers["next-action"],
      "content-type": captured.headers["content-type"],
      accept: captured.headers.accept ?? "text/x-component",
    },
    data: captured.body,
    maxRedirects: 0,
  });
}

/** Создаёт ИПР сотруднику и открывает карточку плана: внутри уже есть форма добавления задания. */
async function createPlan(page: Page, person: { name: string }) {
  await page.goto("/idps");
  const form = page.locator("form", { has: page.getByRole("heading", { name: "Новый ИПР" }) });
  await form.getByLabel(/^Сотрудник/).selectOption({ label: person.name });
  await form.getByLabel(/^Цель/).selectOption("programmer");
  await form.getByLabel("Начало").fill("2026-03-01");
  await form.getByLabel("Конец").fill("2026-09-30");
  await form.getByRole("button", { name: "Создать" }).click();
  const row = page.locator("li", { hasText: person.name });
  await expect(row.getByRole("link").first()).toBeVisible();
  await row.getByRole("link").first().click();
  await expect(addItemForm(page)).toBeVisible();
}

/** Форма добавления строки: узнаётся по заголовку, а не по порядку на странице. */
function addItemForm(page: Page) {
  return page.locator("form", { has: page.getByRole("heading", { name: "Добавить задание" }) });
}

/** Добавляет задание в открытый ИПР и ждёт его строку в таблице. */
async function addItem(page: Page, name: string) {
  const form = addItemForm(page);
  await form.getByLabel(/^Название/).fill(name);
  await form.getByLabel(/^Узнать/).fill(`Узнать ${name}`);
  await form.getByLabel(/^Проверить/).fill(`Проверить ${name}`);
  await form.getByRole("button", { name: "Добавить" }).click();
  await expect(page.getByRole("row", { name: new RegExp(name) })).toBeVisible();
}

/** Приёмка строки плана: ждёт отметку «принято» в той же строке таблицы. */
async function acceptItem(page: Page, name: string) {
  const row = page.getByRole("row", { name: new RegExp(name) });
  await row.getByRole("button", { name: "Подтвердить" }).click();
  await expect(row.getByText("принято", { exact: true })).toBeVisible();
}

test("критерий 1: админ выдаёт достижение, сотрудник видит его, в базе ручная выдача", async ({ page }, testInfo) => {
  await login(page);
  const employee = await createPerson(page, A);
  expect(employee, "id сотрудника найден").not.toBe("");
  const admin = adminId(testInfo);
  expect(admin, "id админа найден").not.toBe("");

  await grantViaUi(page, employee, KNOWLEDGE);

  const row = grants(testInfo, A.login).find((item) => item.achievement_id === KNOWLEDGE);
  expect(row, "строка выдачи записана").toBeDefined();
  expect(row).toMatchObject({ source: "manual", revoked_at: null });
  expect(row!.granted_by_id, "автор ручной выдачи записан").toBe(admin);
  expect(row!.granted_at, "дата выдачи записана").toBeGreaterThan(0);

  await login(page, A);
  await openOwnAchievements(page);
  await expect(achievementRows(page, "Передача знаний"), "сотрудник видит выданное достижение").toBeVisible();
});

test("критерий 2: руководитель выдаёт достижение прямому подчинённому", async ({ page }, testInfo) => {
  await login(page);
  const manager = await createPerson(page, M2);
  const subordinate = await createPerson(page, S2, M2.name);
  expect(subordinate, "id подчинённого найден").not.toBe("");

  await login(page, M2);
  await grantViaUi(page, subordinate, MENTOR);

  const row = grants(testInfo, S2.login).find((item) => item.achievement_id === MENTOR);
  expect(row, "выдача прямому подчинённому записана").toBeDefined();
  expect(row).toMatchObject({ source: "manual", revoked_at: null });
  expect(row!.granted_by_id, "выдал руководитель").toBe(manager);

  await login(page, S2);
  await openOwnAchievements(page);
  await expect(achievementRows(page, "Наставник"), "подчинённый видит выданное руководителем").toBeVisible();
});

test("критерий 3 (негативный): руководитель не выдаёт достижение не своему подчинённому", async ({
  page,
}, testInfo) => {
  await login(page);
  await createPerson(page, M3);
  await createPerson(page, S3, M3.name);
  const outsider = await createPerson(page, O3);
  expect(outsider, "id чужого сотрудника найден").not.toBe("");
  const before = grants(testInfo, O3.login);

  // Действие снимается с настоящей формы, пока страницу открывает админ.
  const captured = await captureGrantPost(page, outsider, STANDARD);

  await login(page, M3);
  const card = await page.goto(`/people/${outsider}`);
  expect(card?.status(), "карточка не своему подчинённому не открывается").toBe(404);
  await expect(page.getByTestId("employee-achievements"), "секции достижений на 404 нет").toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: /^Выдать достижение/ }),
    "формы выдачи на 404 нет",
  ).toHaveCount(0);

  const replay = await replayCaptured(page, captured);
  expect(await replay.text(), "сервер отказал в выдаче").toContain("Нельзя выдать достижение этому сотруднику");

  expect(grants(testInfo, O3.login), "строки в базе нет").toEqual(before);
});

test("критерий 4 (негативный): сотрудник не выдаёт на чужой карточке и себе", async ({ page }, testInfo) => {
  await login(page);
  const target = await createPerson(page, X4);
  const actor = await createPerson(page, Y4);
  expect(actor, "id сотрудника найден").not.toBe("");
  const beforeTarget = grants(testInfo, X4.login);
  const beforeSelf = grants(testInfo, Y4.login);

  // Оба POST снимаются админом: первый — на чужую карточку, второй — на свою.
  const targetPost = await captureGrantPost(page, target, SECURITY);
  const selfPost = await captureGrantPost(page, actor, PROCESS);

  await login(page, Y4);
  const foreign = await page.goto(`/people/${target}`);
  expect(foreign?.status(), "чужая карточка недоступна").toBe(404);
  await expect(page.getByTestId("employee-achievements"), "чужой секции достижений нет").toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: /^Выдать достижение/ }),
    "чужой формы выдачи нет",
  ).toHaveCount(0);

  await page.goto(`/people/${actor}`);
  const section = page.getByTestId("employee-achievements");
  await expect(section, "своя секция достижений видна").toBeVisible();
  await expect(
    section.getByRole("combobox", { name: /^Выдать достижение/ }),
    "сотрудник не видит форму выдачи",
  ).toHaveCount(0);
  await expect(section.getByRole("button", { name: "Выдать", exact: true })).toHaveCount(0);
  await expect(section.getByRole("button", { name: "Отозвать", exact: true })).toHaveCount(0);

  const foreignReplay = await replayCaptured(page, targetPost);
  expect(await foreignReplay.text(), "сервер отказал на чужой карточке").toContain(
    "Нельзя выдать достижение этому сотруднику",
  );
  const selfReplay = await replayCaptured(page, selfPost);
  expect(await selfReplay.text(), "сервер отказал в выдаче себе").toContain(
    "Нельзя выдать достижение этому сотруднику",
  );

  expect(grants(testInfo, X4.login), "чужой карточке ничего не выдано").toEqual(beforeTarget);
  expect(grants(testInfo, Y4.login), "себе ничего не выдано").toEqual(beforeSelf);
});

test("критерий 5: админ отзывает с причиной, строка остаётся в базе", async ({ page }, testInfo) => {
  await login(page);
  const employee = await createPerson(page, R5);
  const admin = adminId(testInfo);
  expect(admin, "id админа найден").not.toBe("");

  await grantViaUi(page, employee, INCIDENT);
  await revokeViaUi(page, employee, INCIDENT, REVOKE_REASON);

  const rows = grants(testInfo, R5.login).filter((item) => item.achievement_id === INCIDENT);
  expect(rows, "строка выдачи осталась одна").toHaveLength(1);
  expect(rows[0].revoked_at, "дата отзыва записана").not.toBeNull();
  expect(rows[0].revoked_by_id, "отзыв подписан админом").toBe(admin);
  expect(rows[0].revoke_reason, "причина отзыва записана").toBe(REVOKE_REASON);

  await login(page, R5);
  await openOwnAchievements(page);
  await expect(achievementRows(page, "Разбор инцидента"), "отозванное достижение не показано").toHaveCount(0);
});

test("критерий 6: повторная выдача отозванного обновляет ту же строку", async ({ page }, testInfo) => {
  await login(page);
  const employee = await createPerson(page, G6);

  await grantViaUi(page, employee, MENTOR);
  const first = grants(testInfo, G6.login).find((item) => item.achievement_id === MENTOR);
  expect(first, "первая выдача записана").toBeDefined();

  await revokeViaUi(page, employee, MENTOR, REPEAT_REASON);
  // Секунда нужна, чтобы новая дата выдачи отличалась от прежней: `granted_at` хранится в секундах.
  await page.waitForTimeout(1100);
  await grantViaUi(page, employee, MENTOR);

  const rows = grants(testInfo, G6.login).filter((item) => item.achievement_id === MENTOR);
  expect(rows, "строка выдачи по-прежнему одна").toHaveLength(1);
  expect(rows[0].revoked_at, "отзыв снят").toBeNull();
  expect(rows[0].revoked_by_id, "подпись отзыва стёрта").toBeNull();
  expect(rows[0].revoke_reason, "причина отзыва стёрта").toBeNull();
  expect(rows[0].granted_at, "дата выдачи обновлена").toBeGreaterThan(first!.granted_at);
  expect(rows[0].source, "выдача осталась ручной").toBe("manual");

  await login(page, G6);
  await openOwnAchievements(page);
  await expect(achievementRows(page, "Наставник"), "достижение снова видно сотруднику").toBeVisible();
});

test("критерий 7 (негативный): автоматическая выдача после ручной не отзывает и не переписывает ручную", async ({
  page,
}, testInfo) => {
  await login(page);
  const employee = await createPerson(page, H7);
  expect(employee, "id сотрудника найден").not.toBe("");

  // Ручная выдача достижения, у каталога которого есть автоматическое правило.
  await grantViaUi(page, employee, FIRST_STEP);
  const before = grants(testInfo, H7.login).find((item) => item.achievement_id === FIRST_STEP);
  expect(before, "ручная выдача записана").toBeDefined();
  expect(before!.source, "выдача ручная").toBe("manual");

  // Теперь условие правила выполняется: принимаем первую строку ИПР.
  await createPlan(page, H7);
  await addItem(page, `Цель H7 ${STAMP}`);
  await acceptItem(page, `Цель H7 ${STAMP}`);

  // Сверка правил действительно прошла: рядом появилась автоматическая выдача.
  await expect
    .poll(
      () => grants(testInfo, H7.login).some((item) => item.achievement_id === "idp-competency-confirmed"),
      "автоматическая сверка после приёмки прошла",
    )
    .toBe(true);

  const rows = grants(testInfo, H7.login).filter((item) => item.achievement_id === FIRST_STEP);
  expect(rows, "строка выдачи одна").toHaveLength(1);
  expect(rows[0], "ручная строка не переписана").toEqual(before);
  expect(rows[0].revoked_at, "ручная строка не отозвана").toBeNull();

  await login(page, H7);
  await openOwnAchievements(page);
  await expect(achievementRows(page, "Первый шаг"), "ручное достижение осталось у сотрудника").toBeVisible();
});
