/**
 * Подтверждённые компетенции и достижения от обоих источников (ADR 0011, issue #127).
 *
 * Файл работает от админа: сессия одна на воркер (см. `e2e/fixtures.ts`). Сотрудников заводят эти же
 * тесты, поэтому база воркера не зависит от seed. Проверки критериев 1–4 смотрят и экран, и строки
 * `employee_achievements`, `idp_items` в базе воркера: видно, что записалось, а не только что показано.
 * Ручное подтверждение и его отзыв идут через форму карточки — так же, как у человека.
 */
import type { Page, TestInfo } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { E2E_ADMIN, workerDbPath } from "./env";
import { expect, login, test } from "./fixtures";

test.describe.configure({ mode: "serial" });

test.use({ asAdmin: true });

const STAMP = Date.now();
const PASSWORD = "e2e-confirmed-calc-password";

function account(tag: string, name: string) {
  return { login: `e2e.calc.${tag}.${STAMP}`, name: `${name} ${STAMP}`, password: PASSWORD };
}

const A = account("a", "Расчёт A");
const B = account("b", "Расчёт B");
const C = account("c", "Расчёт C");
const D = account("d", "Расчёт D");
const E = account("e", "Расчёт E");
const M = account("m", "Руководитель M");
const S = account("s", "Подчинённый S");

/** Навыки профиля junior и пула junior→programmer: все три подтверждаются в сценариях. */
const PROGRAMMING = "comp-navyki-programmirovaniya-na-yazyke-1s";
const OBUCHAEMOST = "comp-obuchaemost";
const QUERY = "comp-znanie-yazyka-zaprosov-1s";

const A_NOTE = `Подтверждение A E2E ${STAMP}`;
const B_NOTE = `Подтверждение B E2E ${STAMP}`;
const C_NOTE = `Подтверждение C E2E ${STAMP}`;
const D_PROGRAMMING_NOTE = `Подтверждение D1 E2E ${STAMP}`;
const D_OBUCHAEMOST_NOTE = `Подтверждение D2 E2E ${STAMP}`;
const D_QUERY_NOTE = `Подтверждение D3 E2E ${STAMP}`;
const E_NOTE = `Подтверждение E E2E ${STAMP}`;
const S_NOTE = `Подтверждение S E2E ${STAMP}`;
const C_REVOKE_REASON = `Причина отзыва C E2E ${STAMP}`;
const S_REVOKE_REASON = `Причина отзыва S E2E ${STAMP}`;

const C_ITEM_ACCEPTED = `Расчёт C: запросы 1 ${STAMP}`;
const C_ITEM_OPEN = `Расчёт C: запросы 2 ${STAMP}`;
const D_ITEM = `Расчёт D: программирование ${STAMP}`;

/** Строка выдачи сотрудника: критерии смотрят базу, а не только экран. */
type Grant = {
  achievement_id: string;
  source: string;
  rule_key: string | null;
  source_ref: string | null;
  granted_at: number;
  granted_by_id: string | null;
  revoked_at: number | null;
};

/** Строка плана: приёмка должна пережить отзыв ручного подтверждения. */
type PlanItem = {
  assignment_name: string;
  competency_id: string;
  accepted_at: number | null;
};

/** База воркера этого теста: у каждого воркера своя, см. `e2e/env.ts`. */
function dbFile(testInfo: TestInfo) {
  return workerDbPath(testInfo.parallelIndex);
}

/** Выдачи сотрудника по логину. Отозванные тоже возвращаются: критерий 3 проверяет, что строка осталась. */
function grants(testInfo: TestInfo, loginName: string): Grant[] {
  const db = new DatabaseSync(dbFile(testInfo), { readOnly: true });
  try {
    return db
      .prepare(
        `SELECT ea.achievement_id, ea.source, ea.rule_key, ea.source_ref, ea.granted_at,
                ea.granted_by_id, ea.revoked_at
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

/** Строки всех планов сотрудника: по ним видно, что приёмка не отозвана вместе с подтверждением. */
function planItems(testInfo: TestInfo, loginName: string): PlanItem[] {
  const db = new DatabaseSync(dbFile(testInfo), { readOnly: true });
  try {
    return db
      .prepare(
        `SELECT ii.assignment_name, ii.competency_id, ii.accepted_at
         FROM idp_items ii
         JOIN idps p ON p.id = ii.idp_id
         JOIN employees e ON e.id = p.employee_id
         WHERE e.login = ?
         ORDER BY ii.id`,
      )
      .all(loginName) as PlanItem[];
  } finally {
    db.close();
  }
}

/** Пул живого плана: по нему видно, что до «Пул закрыт» осталось одно подтверждение. */
function poolCompetencies(testInfo: TestInfo, planId: string): string[] {
  const db = new DatabaseSync(dbFile(testInfo), { readOnly: true });
  try {
    return (
      db.prepare("SELECT competency_id FROM idp_pool WHERE idp_id = ? ORDER BY competency_id").all(planId) as {
        competency_id: string;
      }[]
    ).map((row) => row.competency_id);
  } finally {
    db.close();
  }
}

/** Оставляет в пуле плана одну компетенцию: так правило пула проверяется одним ручным подтверждением. */
function keepOnlyPoolCompetency(testInfo: TestInfo, planId: string, competencyId: string) {
  const db = new DatabaseSync(dbFile(testInfo));
  try {
    db.prepare("DELETE FROM idp_pool WHERE idp_id = ? AND competency_id <> ?").run(planId, competencyId);
  } finally {
    db.close();
  }
}

/** id сотрудника: карточка и форма подтверждения открываются по нему. */
function employeeId(testInfo: TestInfo, loginName: string): string {
  const db = new DatabaseSync(dbFile(testInfo), { readOnly: true });
  try {
    const row = db.prepare("SELECT id FROM employees WHERE login = ?").get(loginName) as { id: string } | undefined;
    return row?.id ?? "";
  } finally {
    db.close();
  }
}

/**
 * Ручная выдача прямо в базу: админской формы для этой проверки не нужно, а правило расчёта
 * от способа выдачи не зависит. Возвращает `granted_at`, чтобы сверить, что сверка его не переписала.
 */
function grantManually(testInfo: TestInfo, loginName: string, achievementId: string): number {
  const db = new DatabaseSync(dbFile(testInfo));
  try {
    const admin = db.prepare("SELECT id FROM employees WHERE is_admin = 1 ORDER BY login LIMIT 1").get() as
      | { id: string }
      | undefined;
    const employee = db.prepare("SELECT id FROM employees WHERE login = ?").get(loginName) as { id: string } | undefined;
    if (!admin || !employee) throw new Error(`ручная выдача: не найден сотрудник ${loginName} или админ`);
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

/** Заводит сотрудника админской формой `/people`; руководитель ставится там же, если он нужен. */
async function createStaff(
  page: Page,
  staff: { login: string; name: string; password: string },
  jobId: string,
  managerName?: string,
) {
  await page.goto("/people");
  const form = page.locator("form", { has: page.getByRole("heading", { name: "Новый сотрудник" }) });
  await form.getByLabel("Логин").fill(staff.login);
  await form.getByLabel("Имя").fill(staff.name);
  await form.getByLabel("Пароль").fill(staff.password);
  await form.getByLabel(/^Должность/).selectOption(jobId);
  if (managerName) await form.getByLabel(/^Руководитель/).selectOption({ label: managerName });
  await form.getByRole("button", { name: "Создать" }).click();
  await expect(page.getByRole("link", { name: staff.name, exact: true })).toBeVisible();
}

/** Создаёт ИПР сотруднику и открывает карточку плана; возвращает путь к ней. */
async function createPlan(page: Page, staff: { name: string }, targetJobId: string) {
  await page.goto("/idps");
  const form = page.locator("form", { has: page.getByRole("heading", { name: "Новый ИПР" }) });
  await form.getByLabel(/^Сотрудник/).selectOption({ label: staff.name });
  await form.getByLabel(/^Цель/).selectOption(targetJobId);
  await form.getByLabel("Начало").fill("2026-03-01");
  await form.getByLabel("Конец").fill("2026-09-30");
  await form.getByRole("button", { name: "Создать" }).click();
  const row = page.locator("li", { hasText: staff.name });
  const link = row.getByRole("link", { name: "Младший программист → Программист" });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page.getByRole("heading", { name: "Добавить задание" })).toBeVisible();
  return new URL(page.url()).pathname;
}

/** Форма добавления строки: узнаётся по заголовку, а не по порядку на странице. */
function addItemForm(page: Page) {
  return page.locator("form", { has: page.getByRole("heading", { name: "Добавить задание" }) });
}

/** Добавляет задание выбранной компетенции и ждёт его строку в таблице. */
async function addItem(page: Page, competencyId: string, name: string) {
  const form = addItemForm(page);
  await form.getByLabel(/^Компетенция/).selectOption(competencyId);
  await form.getByLabel(/^Название/).fill(name);
  await form.getByLabel(/^Узнать/).fill(`Узнать ${name}`);
  await form.getByLabel(/^Проверить/).fill(`Проверить ${name}`);
  await form.getByRole("button", { name: "Добавить" }).click();
  await expect(page.getByRole("row", { name: new RegExp(name) })).toBeVisible();
}

/** Приёмка строки плана: ждёт отметку «принято» в той же строке, значит ответ сервера уже получен. */
async function acceptItem(page: Page, name: string) {
  const row = page.getByRole("row", { name: new RegExp(name) });
  await row.getByRole("button", { name: "Подтвердить" }).click();
  await expect(row.getByText("принято", { exact: true })).toBeVisible();
}

/** Страница достижений: заголовок и оба блока на месте. */
async function openAchievements(page: Page) {
  await page.goto("/me/achievements");
  await expect(page.getByRole("heading", { level: 1, name: "Достижения" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Подтверждённые компетенции" })).toBeVisible();
}

/** Узел дерева навыков и его значок подтверждения. */
function skillNode(page: Page, competencyId: string) {
  return page.getByTestId(`skill-node-${competencyId}`);
}

function skillBadge(page: Page, competencyId: string) {
  return page.getByTestId(`skill-badge-${competencyId}`);
}

/** Блок подтверждённых компетенций: записи ищутся внутри него, чтобы не поймать список достижений. */
function confirmedBlock(page: Page) {
  return page.getByTestId("confirmed-competencies");
}

/** Секция «Компетенции» карточки: все локаторы держатся внутри неё. */
function section(page: Page) {
  return page.getByTestId("employee-confirmations");
}

/**
 * Форма подтверждения — единственная форма секции с кнопкой «Подтвердить». У `select` внутри
 * `<label>` в подпись попадают названия вариантов, поэтому навык ищется по началу подписи.
 */
function confirmForm(page: Page) {
  return section(page).locator("form", { has: page.getByRole("button", { name: "Подтвердить", exact: true }) });
}

/** Строка действующего подтверждения: в ней же живёт форма отзыва. */
function confirmationRow(page: Page, competencyId: string) {
  return page.getByTestId(`employee-confirmation-${competencyId}`);
}

/** Открывает карточку и ждёт секцию: без неё проверять нечего. */
async function openCard(page: Page, employee: string) {
  await page.goto(`/people/${employee}`);
  await expect(section(page)).toBeVisible();
}

/** POST, которым форма карточки вызывает серверное действие. */
function cardPost(page: Page, employee: string) {
  return page.waitForResponse(
    (response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/people/${employee}`,
  );
}

/** Подтверждение через форму карточки: заодно ждёт строку в списке. */
async function confirmViaUi(page: Page, employee: string, competencyId: string, note: string) {
  await openCard(page, employee);
  const form = confirmForm(page);
  await form.getByRole("combobox", { name: /^Навык/ }).selectOption(competencyId);
  await form.getByRole("textbox", { name: "Основание", exact: true }).fill(note);
  const posted = cardPost(page, employee);
  await form.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await posted;
  await expect(confirmationRow(page, competencyId)).toBeVisible();
}

/** Отзыв через форму строки: причина обязательна, после успеха строка уходит из списка. */
async function revokeViaUi(page: Page, employee: string, competencyId: string, reason: string) {
  await openCard(page, employee);
  const row = confirmationRow(page, competencyId);
  await expect(row).toBeVisible();
  await row.getByRole("textbox", { name: "Причина", exact: true }).fill(reason);
  const posted = cardPost(page, employee);
  await row.getByRole("button", { name: "Отозвать", exact: true }).click();
  await posted;
  await expect(confirmationRow(page, competencyId)).toHaveCount(0);
}

test("критерий 1: ручное подтверждение без плана даёт отметку в дереве и запись без ссылки", async ({
  page,
}, testInfo) => {
  await createStaff(page, A, "junior");
  const employee = employeeId(testInfo, A.login);
  expect(employee, "id сотрудника A найден").not.toBe("");

  await confirmViaUi(page, employee, PROGRAMMING, A_NOTE);

  // При ручном источнике плана нет, поэтому `source_ref` выдаче не ставится.
  const rows = grants(testInfo, A.login).filter((row) => row.achievement_id === "idp-competency-confirmed");
  expect(rows, "выдача «Компетенция подтверждена» одна").toHaveLength(1);
  expect(rows[0].source, "источник автоматический").toBe("auto");
  expect(rows[0].source_ref, "ручной записи план не приписан").toBeNull();
  expect(rows[0].revoked_at, "выдача действует").toBeNull();

  await login(page, A);
  await page.goto("/me/skills");
  await expect(skillNode(page, PROGRAMMING), "узел навыка подтверждён").toHaveAttribute("data-confirmed", "true");
  await expect(skillBadge(page, PROGRAMMING), "значок подтверждения виден").toBeVisible();

  await openAchievements(page);
  const record = page.getByTestId(`confirmed-${PROGRAMMING}`);
  await expect(record, "запись подтверждённой компетенции одна").toHaveCount(1);
  await expect(record).toContainText("вручную");
  await expect(record, "в записи имя автора-админа").toContainText(E2E_ADMIN.name);
  await expect(record.locator("a"), "у ручного подтверждения ссылки на план нет").toHaveCount(0);
  await expect(page.getByTestId("confirmed-empty"), "пустого состояния нет").toHaveCount(0);

  await login(page);
});

test("критерий 2: ручная выдача «Первый шаг» не переписана, повторное открытие не дублирует строку", async ({
  page,
}, testInfo) => {
  await createStaff(page, B, "junior");
  const employee = employeeId(testInfo, B.login);
  expect(employee, "id сотрудника B найден").not.toBe("");
  const grantedAt = grantManually(testInfo, B.login, "idp-first-step");

  await confirmViaUi(page, employee, PROGRAMMING, B_NOTE);

  const afterConfirm = grants(testInfo, B.login);
  expect(
    afterConfirm.filter((row) => row.achievement_id === "idp-competency-confirmed"),
    "автоматическая выдача появилась",
  ).toHaveLength(1);
  const firstStep = afterConfirm.filter((row) => row.achievement_id === "idp-first-step");
  expect(firstStep, "ручная строка по-прежнему одна").toHaveLength(1);
  expect(firstStep[0].source, "источник остался ручным").toBe("manual");
  expect(firstStep[0].granted_at, "дата ручной выдачи не переписана").toBe(grantedAt);

  // Два открытия страницы прогоняют сверку дважды: второй автоматической строки быть не должно.
  await login(page, B);
  await openAchievements(page);
  await openAchievements(page);
  expect(
    grants(testInfo, B.login).filter((row) => row.achievement_id === "idp-competency-confirmed"),
    "строка выдачи одна после повторной сверки",
  ).toHaveLength(1);

  await login(page);
});

test("критерий 3: отзыв ручного подтверждения отзывает достижение, но не приёмку строки", async ({
  page,
}, testInfo) => {
  await createStaff(page, C, "junior");
  const employee = employeeId(testInfo, C.login);
  expect(employee, "id сотрудника C найден").not.toBe("");

  await confirmViaUi(page, employee, PROGRAMMING, C_NOTE);
  const planPath = await createPlan(page, C, "programmer");
  // В пуле junior→programmer «Обучаемости» нет: у младшего и программиста она одного уровня (2),
  // поэтому берём «Знание языка запросов 1С» — она в разрыве и в профиле младшего.
  await addItem(page, QUERY, C_ITEM_ACCEPTED);
  await addItem(page, QUERY, C_ITEM_OPEN);
  await acceptItem(page, C_ITEM_ACCEPTED);

  const beforeRevoke = grants(testInfo, C.login).find((row) => row.achievement_id === "idp-competency-confirmed");
  expect(beforeRevoke, "до отзыва достижение выдано ручным подтверждением").toBeDefined();
  expect(beforeRevoke!.revoked_at, "до отзыва выдача действует").toBeNull();

  await revokeViaUi(page, employee, PROGRAMMING, C_REVOKE_REASON);

  const afterRevoke = grants(testInfo, C.login).find((row) => row.achievement_id === "idp-competency-confirmed");
  expect(afterRevoke, "отозванная строка осталась в базе").toBeDefined();
  expect(afterRevoke!.revoked_at, "отзыв записан: компетенций для достижения не осталось").not.toBeNull();

  const items = planItems(testInfo, C.login);
  const accepted = items.find((item) => item.assignment_name === C_ITEM_ACCEPTED);
  const open = items.find((item) => item.assignment_name === C_ITEM_OPEN);
  expect(accepted?.accepted_at, "принятая строка сохранила дату приёмки").not.toBeNull();
  expect(open?.accepted_at, "вторая строка плана не принята").toBeNull();

  await login(page, C);
  await page.goto("/me/skills");
  await expect(skillNode(page, PROGRAMMING), "после отзыва навык не подтверждён").toHaveAttribute(
    "data-confirmed",
    "false",
  );
  await expect(skillBadge(page, PROGRAMMING), "значка подтверждения нет").toHaveCount(0);

  await openAchievements(page);
  await expect(page.getByTestId(`confirmed-${PROGRAMMING}`), "записи в блоке нет").toHaveCount(0);

  await page.goto(planPath);
  await expect(
    page.getByRole("row", { name: new RegExp(C_ITEM_ACCEPTED) }).getByText("принято", { exact: true }),
    "принятая строка плана осталась принятой",
  ).toBeVisible();

  await login(page);
});

test("критерий 4: два источника считаются одной компетенцией, третья даёт достижение один раз", async ({
  page,
}, testInfo) => {
  await createStaff(page, D, "junior");
  const employee = employeeId(testInfo, D.login);
  expect(employee, "id сотрудника D найден").not.toBe("");

  await confirmViaUi(page, employee, PROGRAMMING, D_PROGRAMMING_NOTE);
  await confirmViaUi(page, employee, OBUCHAEMOST, D_OBUCHAEMOST_NOTE);

  const planPath = await createPlan(page, D, "programmer");
  await addItem(page, PROGRAMMING, D_ITEM);
  await acceptItem(page, D_ITEM);

  await login(page, D);
  await openAchievements(page);
  const block = confirmedBlock(page);
  const record = page.getByTestId(`confirmed-${PROGRAMMING}`);
  await expect(record, "у компетенции одна запись, а не две").toHaveCount(1);
  await expect(record.getByRole("link", { name: "приёмкой ИПР" })).toHaveAttribute("href", planPath);
  await expect(record).toContainText("вручную");
  await expect(block.getByRole("listitem"), "подтверждённых компетенций две").toHaveCount(2);

  // PROGRAMMING посчитана один раз: при удвоении записей подтверждённых стало бы три.
  expect(
    grants(testInfo, D.login).filter((row) => row.achievement_id === "competency-3"),
    "двух компетенций недостаточно для «Трёх компетенций»",
  ).toHaveLength(0);

  await login(page);
  await confirmViaUi(page, employee, QUERY, D_QUERY_NOTE);

  const three = grants(testInfo, D.login).filter((row) => row.achievement_id === "competency-3");
  expect(three, "третья компетенция дала достижение").toHaveLength(1);
  expect(three[0].revoked_at, "достижение действует").toBeNull();

  await login(page, D);
  await openAchievements(page);
  await expect(confirmedBlock(page).getByRole("listitem"), "в блоке три компетенции").toHaveCount(3);
});

test("критерий 2 (пул): ручное подтверждение закрывает пул живого плана", async ({ page }, testInfo) => {
  await createStaff(page, E, "junior");
  const employee = employeeId(testInfo, E.login);
  expect(employee, "id сотрудника E найден").not.toBe("");
  const planPath = await createPlan(page, E, "programmer");
  const planId = planPath.split("/").pop() ?? "";
  expect(planId, "id плана известен").not.toBe("");

  // Пул живого плана — разрыв junior→programmer; оставляем одну компетенцию, чтобы её закрыло
  // одно ручное подтверждение. Строки плана при этом остаются пустыми.
  keepOnlyPoolCompetency(testInfo, planId, QUERY);
  expect(poolCompetencies(testInfo, planId), "в пуле осталась одна компетенция").toEqual([QUERY]);

  await confirmViaUi(page, employee, QUERY, E_NOTE);

  // Отдельного открытия `/me/achievements` нет: сверку запускает само действие подтверждения.
  const poolClosed = grants(testInfo, E.login).filter((row) => row.achievement_id === "idp-pool-closed");
  expect(poolClosed, "выдача «Пул закрыт» одна").toHaveLength(1);
  expect(poolClosed[0].source, "источник автоматический").toBe("auto");
  expect(poolClosed[0].source_ref, "в выдаче записан план").toBe(planId);
  expect(poolClosed[0].revoked_at, "выдача действует").toBeNull();
});

test("критерий 2 (руководитель): подтверждение подчинённого даёт и снимает «Ученик подтвердил»", async ({
  page,
}, testInfo) => {
  await createStaff(page, M, "junior");
  await createStaff(page, S, "junior", M.name);
  const employee = employeeId(testInfo, S.login);
  expect(employee, "id сотрудника S найден").not.toBe("");

  await confirmViaUi(page, employee, QUERY, S_NOTE);

  // Плана у S нет, поэтому ручная запись подтверждения не даёт ссылки на ИПР.
  const mentorRow = () => grants(testInfo, M.login).find((row) => row.achievement_id === "mentor-competency");
  await expect
    .poll(
      () => {
        const row = mentorRow();
        return row ? { revoked_at: row.revoked_at, source_ref: row.source_ref } : null;
      },
      { message: "подтверждение подчинённого выдаёт руководителю «Ученик подтвердил»" },
    )
    .toEqual({ revoked_at: null, source_ref: null });

  await revokeViaUi(page, employee, QUERY, S_REVOKE_REASON);

  await expect
    .poll(() => mentorRow()?.revoked_at ?? null, {
      message: "снятие подтверждения отзывает достижение руководителя",
    })
    .not.toBeNull();
});
