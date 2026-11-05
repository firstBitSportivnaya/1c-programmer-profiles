/**
 * Достижения: хранимые выдачи по автоматическим правилам (ADR 0010, issue #117).
 *
 * Файл работает от админа: сессия одна на воркер (см. `e2e/fixtures.ts`). Сотрудников заводят эти же
 * тесты, поэтому база воркера не зависит от seed. Проверки критериев 1–3 смотрят и экран, и строку
 * выдачи в базе воркера: видно, что записалось, а не только что показано.
 */
import type { Page, TestInfo } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { expect, login, test } from "./fixtures";
import { workerDbPath } from "./env";

test.describe.configure({ mode: "serial" });

test.use({ asAdmin: true });

const STAMP = Date.now();
const ACCOUNT = (suffix: string, name: string) => ({
  login: `e2e.ach.${suffix}.${STAMP}`,
  name: `${name} ${STAMP}`,
  password: "e2e-ach-password",
});
const A = ACCOUNT("a", "Ачивки A");
const B = ACCOUNT("b", "Ачивки B");
const C = ACCOUNT("c", "Ачивки C");
const D = ACCOUNT("d", "Ачивки D");
const E = ACCOUNT("e", "Ачивки E");
const F = ACCOUNT("f", "Ачивки F");
const G = ACCOUNT("g", "Ачивки G");
const H = ACCOUNT("h", "Ачивки H");
const I = ACCOUNT("i", "Ачивки I");
const J = ACCOUNT("j", "Ачивки J");
const K = ACCOUNT("k", "Ачивки K");
const A_GOAL = `Цель A ${STAMP}`;
const A_SECOND = `Цель A2 ${STAMP}`;
const C_GOAL = `Цель C ${STAMP}`;
const C_SECOND = `Цель C2 ${STAMP}`;
const D_GOAL = `Цель D ${STAMP}`;
const D_SECOND = `Цель D2 ${STAMP}`;
const I_GOAL = `Цель I ${STAMP}`;
const I_SECOND = `Цель I2 ${STAMP}`;
const J_GOAL = `Цель J ${STAMP}`;
const J_SECOND = `Цель J2 ${STAMP}`;
const K_GOAL = `Цель K ${STAMP}`;
const K_SECOND = `Цель K2 ${STAMP}`;
let aPlanPath = "";
let cCompetency = "";
let cSecondCompetency = "";
let dPlanPath = "";

/** Строка выдачи сотрудника: проверки критериев смотрят базу, а не только экран. */
type Grant = {
  achievement_id: string;
  source: string;
  rule_key: string | null;
  source_ref: string | null;
  granted_at: number;
  granted_by_id: string | null;
  revoked_at: number | null;
  revoked_by_id: string | null;
};

/** База воркера этого теста: у каждого воркера своя, см. `e2e/env.ts`. */
function dbFile(testInfo: TestInfo) {
  return workerDbPath(testInfo.parallelIndex);
}

/** Выдачи сотрудника по логину. Отозванные тоже возвращаются: критерий 3 проверяет, что строка осталась. */
function grants(testInfo: TestInfo, login: string): Grant[] {
  const db = new DatabaseSync(dbFile(testInfo), { readOnly: true });
  try {
    return db
      .prepare(
        `SELECT ea.achievement_id, ea.source, ea.rule_key, ea.source_ref, ea.granted_at, ea.granted_by_id,
                ea.revoked_at, ea.revoked_by_id
         FROM employee_achievements ea
         JOIN employees e ON e.id = ea.employee_id
         WHERE e.login = ?
         ORDER BY ea.achievement_id`,
      )
      .all(login) as Grant[];
  } finally {
    db.close();
  }
}

/** id сотрудника: админская карточка и оргсвязь задаются по нему. */
function employeeId(testInfo: TestInfo, login: string): string {
  const db = new DatabaseSync(dbFile(testInfo), { readOnly: true });
  try {
    const row = db.prepare("SELECT id FROM employees WHERE login = ?").get(login) as { id: string } | undefined;
    return row?.id ?? "";
  } finally {
    db.close();
  }
}

/** Ручная выдача прямо в базу: админской формы в этом этапе ещё нет, а правило проверки не зависит от неё. */
function grantManually(testInfo: TestInfo, login: string, achievementId: string): number {
  const db = new DatabaseSync(dbFile(testInfo));
  try {
    const admin = db.prepare("SELECT id FROM employees WHERE is_admin = 1 ORDER BY login LIMIT 1").get() as
      | { id: string }
      | undefined;
    const employee = db.prepare("SELECT id FROM employees WHERE login = ?").get(login) as { id: string } | undefined;
    if (!admin || !employee) throw new Error(`ручная выдача: не найден сотрудник ${login} или админ`);
    const t = Math.floor(Date.now() / 1000);
    db.prepare(
      `INSERT INTO employee_achievements
         (employee_id, achievement_id, source, rule_key, source_ref, granted_at, granted_by_id)
       VALUES (?, ?, 'manual', NULL, NULL, ?, ?)`,
    ).run(employee.id, achievementId, t, admin.id);
    return t;
  } finally {
    db.close();
  }
}

/** Ручной отзыв выдачи прямо в базу: админской формы в этом этапе ещё нет, правило проверки от неё не зависит. */
function revokeManually(testInfo: TestInfo, login: string, achievementId: string): { revokedAt: number; adminId: string } {
  const db = new DatabaseSync(dbFile(testInfo));
  try {
    const admin = db.prepare("SELECT id FROM employees WHERE is_admin = 1 ORDER BY login LIMIT 1").get() as
      | { id: string }
      | undefined;
    const employee = db.prepare("SELECT id FROM employees WHERE login = ?").get(login) as { id: string } | undefined;
    if (!admin || !employee) throw new Error(`ручной отзыв: не найден сотрудник ${login} или админ`);
    const revokedAt = Math.floor(Date.now() / 1000);
    db.prepare(
      `UPDATE employee_achievements SET revoked_at = ?, revoked_by_id = ?
       WHERE employee_id = ? AND achievement_id = ?`,
    ).run(revokedAt, admin.id, employee.id, achievementId);
    return { revokedAt, adminId: admin.id };
  } finally {
    db.close();
  }
}

/** Убирает строку профиля прямо в базе: профиль младшего — данные seed, e2e должна вернуть его как был. */
function removeProfileSkill(testInfo: TestInfo, jobId: string, name: string) {
  const db = new DatabaseSync(dbFile(testInfo));
  try {
    db.prepare(
      `DELETE FROM profile_skills
       WHERE profile_id = (SELECT id FROM profiles WHERE job_id = ?)
         AND competency_id = (SELECT id FROM competencies WHERE name = ?)`,
    ).run(jobId, name);
  } finally {
    db.close();
  }
}

/** Сколько раз компетенция стоит в профиле должности: проверка уборки после теста. */
function profileSkillCount(testInfo: TestInfo, jobId: string, name: string): number {
  const db = new DatabaseSync(dbFile(testInfo), { readOnly: true });
  try {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n FROM profile_skills
         WHERE profile_id = (SELECT id FROM profiles WHERE job_id = ?)
           AND competency_id = (SELECT id FROM competencies WHERE name = ?)`,
      )
      .get(jobId, name) as { n: number };
    return row.n;
  } finally {
    db.close();
  }
}

/** Вход учёткой; на первом прогоне сначала создаёт админа и переключается на нужного сотрудника. */
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

/** Создаёт ИПР сотруднику и возвращает путь к карточке плана. */
async function createPlan(
  page: Page,
  staff: { name: string },
  targetJobId: string,
  options: { emptyPool?: boolean; rowText?: string } = {},
) {
  await page.goto("/idps");
  const form = page.locator("form", { has: page.getByRole("heading", { name: "Новый ИПР" }) });
  await form.getByLabel(/^Сотрудник/).selectOption({ label: staff.name });
  await form.getByLabel(/^Цель/).selectOption(targetJobId);
  await form.getByLabel("Начало").fill("2026-03-01");
  await form.getByLabel("Конец").fill("2026-09-30");
  await form.getByRole("button", { name: "Создать" }).click();
  const rows = page.locator("li", { hasText: staff.name });
  const row = options.rowText ? rows.filter({ hasText: options.rowText }) : rows;
  await expect(row.getByRole("link").first()).toBeVisible();
  await row.getByRole("link").first().click();
  if (options.emptyPool) {
    await expect(page.getByText("В пуле нет компетенций")).toBeVisible();
  } else {
    await expect(addItemForm(page)).toBeVisible();
  }
  return new URL(page.url()).pathname;
}

/** Форма добавления строки: узнаётся по заголовку, а не по порядку на странице. */
function addItemForm(page: Page) {
  return page.locator("form", { has: page.getByRole("heading", { name: "Добавить задание" }) });
}

/** Добавляет задание в открытый ИПР и ждёт его строку в таблице. */
async function addItem(page: Page, name: string, competencyIndex = 0) {
  const form = addItemForm(page);
  if (competencyIndex > 0) {
    await form.getByLabel(/^Компетенция/).selectOption({ index: competencyIndex });
  }
  await form.getByLabel(/^Название/).fill(name);
  await form.getByLabel(/^Узнать/).fill(`Узнать ${name}`);
  await form.getByLabel(/^Проверить/).fill(`Проверить ${name}`);
  await form.getByRole("button", { name: "Добавить" }).click();
  await expect(page.getByRole("row", { name: new RegExp(name) })).toBeVisible();
}

/** Название компетенции из списка формы добавления: из подписи убирается планка уровня. */
async function competencyName(page: Page, index: number) {
  const option = addItemForm(page).getByLabel(/^Компетенция/).locator("option").nth(index);
  return (await option.innerText()).replace(/\s·\sур\.\s\d+$/, "");
}

/** Приёмка строки плана: ждёт отметку «принято» в той же строке таблицы. */
async function acceptItem(page: Page, name: string) {
  const row = page.getByRole("row", { name: new RegExp(name) });
  await row.getByRole("button", { name: "Подтвердить" }).click();
  await expect(row.getByText("принято", { exact: true })).toBeVisible();
}

/** Снятие приёмки: отметка «принято» из строки уходит. */
async function unacceptItem(page: Page, name: string) {
  const row = page.getByRole("row", { name: new RegExp(name) });
  await row.getByRole("button", { name: "Снять подтверждение" }).click();
  await expect(row.getByText("принято", { exact: true })).toHaveCount(0);
}

/** Страница достижений: заголовок, пояснение и оба блока на месте. */
async function openAchievements(page: Page) {
  await page.goto("/me/achievements");
  await expect(page.getByRole("heading", { level: 1, name: "Достижения" })).toBeVisible();
  await expect(page.getByText("очков нет", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Подтверждённые компетенции" })).toBeVisible();
}

/** Правка сотрудника админом: должность или руководитель. Форма узнаётся по скрытому `id`. */
/** Правка сотрудника админом: должность или руководитель. Форма узнаётся по скрытому `id`. */
function editForm(page: Page) {
  return page.locator("form").filter({ has: page.locator('input[name="id"]') });
}

/** Сохраняет карточку сотрудника и ждёт ответ на POST: проверка базы сразу после должна видеть запись. */
async function saveStaff(page: Page, employee: string, patch: { job?: string; manager?: string }) {
  await page.goto(`/people/${employee}`);
  const form = editForm(page);
  if (patch.job) await form.getByLabel(/^Должность/).selectOption(patch.job);
  if (patch.manager) await form.getByLabel(/^Руководитель/).selectOption({ label: patch.manager });
  const posted = page.waitForResponse((response) => response.request().method() === "POST");
  await form.getByRole("button", { name: "Сохранить" }).click();
  await posted;
}

test("критерий 1: первая принятая строка даёт «Первый шаг» и запись с правилом", async ({ page }, testInfo) => {
  await createStaff(page, A, "junior");
  aPlanPath = await createPlan(page, A, "programmer");
  await addItem(page, A_GOAL);
  await addItem(page, A_SECOND, 1);
  await acceptItem(page, A_GOAL);

  await login(page, A);
  await openAchievements(page);
  const list = page.getByTestId("achievements-list");
  await expect(list.getByRole("link", { name: "Первый шаг" })).toHaveAttribute("href", aPlanPath);
  await expect(list.getByRole("listitem").filter({ hasText: "Компетенция подтверждена" })).toHaveCount(1);

  const first = grants(testInfo, A.login).filter((row) => row.achievement_id === "idp-first-step");
  expect(first, "выдача «Первый шаг» одна").toHaveLength(1);
  expect(first[0].source, "источник автоматический").toBe("auto");
  expect(first[0].rule_key, "правило записано в выдачу").toBe("idp.first-accepted-item");
  expect(first[0].source_ref, "в выдаче записан план").toBe(aPlanPath.split("/").pop());
  expect(first[0].granted_at, "дата выдачи записана").toBeGreaterThan(0);
  expect(first[0].granted_by_id, "у автоматической выдачи нет автора-человека").toBeNull();
  expect(first[0].revoked_at, "выдача не отозвана").toBeNull();
});

test("критерий 2: повторное выполнение условия не дублирует строку и снимает отзыв", async ({ page }, testInfo) => {
  const initial = grants(testInfo, A.login).find((row) => row.achievement_id === "idp-first-step");
  expect(initial, "выдача из критерия 1 на месте").toBeDefined();

  await page.goto(aPlanPath);
  await unacceptItem(page, A_GOAL);
  const revoked = grants(testInfo, A.login).find((row) => row.achievement_id === "idp-first-step");
  expect(revoked?.revoked_at, "снятие приёмки отзывает автоматическую выдачу").not.toBeNull();

  // Секунда нужна, чтобы новая дата выдачи отличалась от прежней: `granted_at` хранится в секундах.
  await page.waitForTimeout(1100);
  await acceptItem(page, A_GOAL);

  const again = grants(testInfo, A.login).filter((row) => row.achievement_id === "idp-first-step");
  expect(again, "строка выдачи по-прежнему одна").toHaveLength(1);
  expect(again[0].revoked_at, "отзыв снят").toBeNull();
  expect(again[0].granted_at, "дата выдачи обновлена").toBeGreaterThan(initial!.granted_at);
  expect(again[0].source_ref, "план в выдаче прежний").toBe(initial!.source_ref);

  await login(page, A);
  await openAchievements(page);
  await expect(page.getByTestId("achievements-list").getByRole("link", { name: "Первый шаг" })).toBeVisible();
});

test("критерий 3: снятая приёмка убирает достижение из списка, строка остаётся с отзывом", async ({ page }, testInfo) => {
  await page.goto(aPlanPath);
  await unacceptItem(page, A_GOAL);

  const rows = grants(testInfo, A.login);
  const first = rows.filter((row) => row.achievement_id === "idp-first-step");
  expect(first, "отозванная строка в базе осталась").toHaveLength(1);
  expect(first[0].revoked_at, "дата отзыва записана").not.toBeNull();

  await login(page, A);
  await openAchievements(page);
  await expect(page.getByTestId("achievements-empty")).toBeVisible();
  await expect(page.getByTestId("achievements-list")).toHaveCount(0);
  await expect(page.getByTestId("confirmed-empty")).toBeVisible();
  // Подтверждённых компетенций нет: вторая строка плана так и не принята.
  await expect(page.getByTestId("confirmed-competencies").getByRole("listitem")).toHaveCount(0);
});

test("критерий 4 (негативный): ручную выдачу проверка не отзывает и не переписывает", async ({ page }, testInfo) => {
  await createStaff(page, B, "junior");
  const grantedAt = grantManually(testInfo, B.login, "contribution-mentoring");

  await login(page, B);
  await openAchievements(page);
  await expect(page.getByTestId("achievements-list").getByRole("listitem").filter({ hasText: "Наставник" })).toBeVisible();

  // Открытие страницы прогоняет проверку всех правил: ручная строка ей не подчиняется.
  await openAchievements(page);
  const rows = grants(testInfo, B.login);
  expect(rows, "других выдач у сотрудника нет").toHaveLength(1);
  expect(rows[0].source, "источник остался ручным").toBe("manual");
  expect(rows[0].granted_at, "дата ручной выдачи не переписана").toBe(grantedAt);
  expect(rows[0].revoked_at, "ручная выдача не отозвана").toBeNull();
});

test("критерий 5: компетенции остаются текстом в блоке и не дают строку на каждую", async ({ page }) => {
  await createStaff(page, C, "junior");
  await createPlan(page, C, "programmer");
  await addItem(page, C_GOAL);
  cCompetency = await competencyName(page, 0);
  cSecondCompetency = await competencyName(page, 1);
  await addItem(page, C_SECOND, 1);
  await acceptItem(page, C_GOAL);
  await acceptItem(page, C_SECOND);

  await login(page, C);
  await openAchievements(page);
  const block = page.getByTestId("confirmed-competencies");
  await expect(block.getByRole("listitem").filter({ hasText: cCompetency })).toHaveCount(1);
  await expect(block.getByRole("listitem").filter({ hasText: cSecondCompetency })).toHaveCount(1);
  await expect(block.locator("a"), "компетенции в блоке — текст, а не ссылки").toHaveCount(0);

  const list = page.getByTestId("achievements-list");
  await expect(list.getByRole("listitem").filter({ hasText: "Компетенция подтверждена" })).toHaveCount(1);
  await expect(list.getByRole("listitem").filter({ hasText: cCompetency }), "компетенция строкой выдачи не стала").toHaveCount(0);
  await expect(list.getByRole("listitem").filter({ hasText: cSecondCompetency })).toHaveCount(0);
});

test("смена должности и оргсвязи выдаёт достижения без открытия страницы", async ({ page }, testInfo) => {
  await createStaff(page, E, "junior");
  await createStaff(page, F, "junior");
  await createStaff(page, G, "junior");
  const gid = employeeId(testInfo, G.login);
  expect(gid, "id сотрудника G найден").not.toBe("");

  // Подчинённый у F: правило наставничества проверяется в действии админки.
  await saveStaff(page, gid, { manager: F.name });
  await expect
    .poll(() => grants(testInfo, F.login).map((row) => row.achievement_id))
    .toContain("mentor-first-report");

  // Должность E: правило каталога ссылается на id должности.
  await saveStaff(page, employeeId(testInfo, E.login), { job: "programmer" });
  await expect
    .poll(() => grants(testInfo, E.login).map((row) => row.achievement_id))
    .toContain("career-programmer");

  await login(page, F);
  await openAchievements(page);
  await expect(page.getByTestId("achievements-list").getByRole("listitem").filter({ hasText: "Первый подчинённый" })).toBeVisible();
  await login(page, E);
  await openAchievements(page);
  await expect(page.getByTestId("achievements-list").getByRole("listitem").filter({ hasText: "Программист" })).toBeVisible();
});

test("достижение руководителя выдаётся при приёмке у подчинённого, без открытия его страницы", async ({ page }, testInfo) => {
  await createStaff(page, H, "junior");
  await createStaff(page, J, "junior");
  await saveStaff(page, employeeId(testInfo, J.login), { manager: H.name });
  expect(
    grants(testInfo, H.login).map((row) => row.achievement_id),
    "одна оргсвязь правило о компетенции подчинённого не выполняет",
  ).not.toContain("mentor-competency");

  await createPlan(page, J, "programmer");
  await addItem(page, J_GOAL);
  // Вторая строка остаётся непринятой: план не завершается, проверяется только приёмка.
  await addItem(page, J_SECOND, 1);
  await acceptItem(page, J_GOAL);

  // Отдельного открытия `/me/achievements` у H нет: выдачу должна дать приёмка подчинённого.
  await expect
    .poll(() => grants(testInfo, H.login).map((row) => row.achievement_id))
    .toContain("mentor-competency");

  await login(page, H);
  await openAchievements(page);
  await expect(
    page.getByTestId("achievements-list").getByRole("listitem").filter({ hasText: "Ученик подтвердил" }),
  ).toBeVisible();
});

test("ручная выдача поверх сработавшего правила остаётся ручной, отзыв человека не оживляется", async ({
  page,
}, testInfo) => {
  await createStaff(page, I, "junior");
  await createPlan(page, I, "programmer");
  await addItem(page, I_GOAL);
  await addItem(page, I_SECOND, 1);
  // Ручная строка появляется до приёмки: дальше условие выполнится, и сверка обязана её не тронуть.
  const grantedAt = grantManually(testInfo, I.login, "idp-first-step");
  await acceptItem(page, I_GOAL);

  const afterAccept = grants(testInfo, I.login).filter((row) => row.achievement_id === "idp-first-step");
  expect(afterAccept, "второй строки выдачи нет").toHaveLength(1);
  expect(afterAccept[0].source, "выдача осталась ручной").toBe("manual");
  expect(afterAccept[0].granted_at, "дата ручной выдачи не переписана").toBe(grantedAt);

  // Отзыв человека поверх выполненного условия: сверка не оживляет такую выдачу.
  const revoked = revokeManually(testInfo, I.login, "idp-first-step");

  await login(page, I);
  await openAchievements(page);
  const list = page.getByTestId("achievements-list");
  await expect(list.getByRole("link", { name: "Первый шаг" }), "отозванная выдача не показана").toHaveCount(0);
  await expect(list.getByRole("listitem").filter({ hasText: "Компетенция подтверждена" })).toBeVisible();
  await expect(page.getByTestId("confirmed-competencies").getByRole("listitem")).toHaveCount(1);

  const afterRevoke = grants(testInfo, I.login).filter((row) => row.achievement_id === "idp-first-step");
  expect(afterRevoke, "строка отзыва одна").toHaveLength(1);
  expect(afterRevoke[0].revoked_at, "дата отзыва сохранена").toBe(revoked.revokedAt);
  expect(afterRevoke[0].revoked_by_id, "отзыв остался за человеком").toBe(revoked.adminId);
});

test("правка профиля должности меняет достижения без открытия страницы сотрудника", async ({ page }, testInfo) => {
  await createStaff(page, K, "junior");
  await createPlan(page, K, "programmer");
  await addItem(page, K_GOAL);
  // Компетенция целевого профиля, которой нет у младшего: она подтверждает правило «вне профиля».
  const outside = await competencyName(page, 0);
  await addItem(page, K_SECOND, 1);
  await acceptItem(page, K_GOAL);
  await expect
    .poll(() => grants(testInfo, K.login).map((row) => row.achievement_id))
    .toContain("competency-outside-profile");

  // Админ дописывает эту компетенцию в профиль текущей должности сотрудника.
  await page.goto("/jobs/junior/profile");
  const addForm = page
    .locator("form", { has: page.getByRole("button", { name: "Добавить", exact: true }) })
    .filter({ has: page.locator("option", { hasText: outside }) });
  await addForm.locator('select[name="competencyId"]').selectOption({ label: outside });
  const posted = page.waitForResponse((response) => response.request().method() === "POST");
  await addForm.getByRole("button", { name: "Добавить" }).click();
  await posted;

  // Отдельного открытия `/me/achievements` у K нет: отзыв дала правка профиля.
  await expect
    .poll(() => grants(testInfo, K.login).find((row) => row.achievement_id === "competency-outside-profile")?.revoked_at)
    .not.toBeNull();

  // Профиль младшего — данные seed: строку убираем, чтобы она не меняла соседние спецификации.
  removeProfileSkill(testInfo, "junior", outside);
  expect(profileSkillCount(testInfo, "junior", outside), "добавленная строка профиля убрана").toBe(0);
});

test("отменённый план отзывает автоматические достижения", async ({ page }, testInfo) => {
  await createStaff(page, D, "junior");
  dPlanPath = await createPlan(page, D, "programmer");
  await addItem(page, D_GOAL);
  // Вторая строка остаётся непринятой: иначе план сразу выполнен и отменять нечего.
  await addItem(page, D_SECOND, 1);
  await acceptItem(page, D_GOAL);
  expect(grants(testInfo, D.login).map((row) => row.achievement_id)).toContain("idp-first-step");

  await page.goto(dPlanPath);
  await page.getByRole("button", { name: "Отменить" }).click();
  await expect(page.getByText("отменён", { exact: true })).toBeVisible();
  const first = grants(testInfo, D.login).find((row) => row.achievement_id === "idp-first-step");
  expect(first?.revoked_at, "отмена плана отзывает выдачу").not.toBeNull();

  await login(page, D);
  await openAchievements(page);
  await expect(page.getByTestId("achievements-empty")).toBeVisible();
});

test("страница только своя: чужой сотрудник и его id в адресе не дают", async ({ page }, testInfo) => {
  const cid = employeeId(testInfo, C.login);
  expect(cid, "id сотрудника C найден").not.toBe("");

  await login(page, B);
  await openAchievements(page);
  // У B только ручное «Наставник»: чужих достижений C здесь нет.
  await expect(page.getByTestId("achievements-list").getByRole("listitem").filter({ hasText: "Первый шаг" })).toHaveCount(0);

  await page.goto(`/me/achievements?employeeId=${encodeURIComponent(cid)}`);
  await expect(page.getByText("Первый шаг", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("achievements-list").getByRole("listitem").filter({ hasText: "Компетенция подтверждена" })).toHaveCount(0);
});

test.describe("гость", () => {
  // Гостевые проверки идут без cookie админа (см. e2e/fixtures.ts).
  test.use({ asAdmin: false });

  test("достижения и их цели закрыты для гостя", async ({ page }) => {
    await page.goto("/me/achievements");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Достижения" })).toHaveCount(0);
    await expect(page.getByText("Первый шаг")).toHaveCount(0);
    await expect(page.locator("[data-icon]")).toHaveCount(0);

    await page.goto(aPlanPath);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { level: 1, name: /^ИПР:/ })).toHaveCount(0);
  });
});
