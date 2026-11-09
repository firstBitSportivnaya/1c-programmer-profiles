/**
 * Дерево навыков сотрудника для руководителя и админа (issue #133, ADR 0007, 0011).
 *
 * Файл работает от админа: сессия одна на воркер (см. `e2e/fixtures.ts`). Сотрудники и оргсвязи
 * создаются этими же тестами, поэтому база воркера не зависит от seed. Проверки критериев 1–5
 * смотрят и экран, и строки `employee_competency_confirmations` / `employee_competency_marks`:
 * видно, что записалось, а не только что показано. Повтор POST снимается с настоящей формы и
 * проигрывается от чужого имени: страница могла бы просто спрятать форму, сервер обязан отказать.
 */
import type { Page, Request, TestInfo } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { workerDbPath } from "./env";
import { expect, login, logout, test } from "./fixtures";

test.describe.configure({ mode: "serial" });

test.use({ asAdmin: true });

const STAMP = Date.now();
const PASSWORD = "e2e-tree-review-password";

function account(tag: string, name: string) {
  return { login: `e2e.treereview.${tag}.${STAMP}`, name: `${name} ${STAMP}`, password: PASSWORD };
}

const MANAGER = account("m", "Руководитель дерева");
const STAFF = account("s", "Подчинённый дерева");
const OUTSIDER = account("o", "Чужой дерева");

/** Навык текущей и целевой должности: виден в обоих профилях. */
const CURRENT = "comp-znanie-yazyka-zaprosov-1s";
/** Навык только цели ИПР: в профиле junior его нет. */
const TARGET = "comp-avtomatizirovannoe-testirovanie";
/** Навык junior без подтверждений: на нём проверяется обязательное основание. */
const FREE = "comp-znanie-tipovyh-konfiguracii";
/** Навык вне обеих должностей и вне ветвей профиля: подтверждение держит его в разделе «Вне профиля». */
const OUTSIDE = "comp-integracionnye-platformy-i-esb";
/** Навык junior, на котором сотрудник ставит личную пометку с пояснением. */
const MARKED = "comp-obuchaemost";

const ITEM_NAME = `Дерево: тесты ${STAMP}`;
/** Строка плана по навыку текущей должности: её приёмка подтверждает узел без ручной записи. */
const IDP_ITEM = `Дерево: приёмка ${STAMP}`;
const OUTSIDE_NOTE = `Проект вне профиля E2E ${STAMP}`;
const STAFF_NOTE = `Личная заметка сотрудника E2E ${STAMP}`;
const MANAGER_NOTE = `Подтверждение руководителя E2E ${STAMP}`;
const MANAGER_NOTE_2 = `Подтверждение руководителя, повтор E2E ${STAMP}`;
const REVOKE_REASON = `Причина снятия E2E ${STAMP}`;
const GUEST_NOTE = `Гостевое подтверждение E2E ${STAMP}`;

const CONFIRM_DENIED = "Нельзя подтвердить компетенцию этому сотруднику";
const REVOKE_DENIED = "Нельзя отозвать подтверждение этого сотрудника";
const NEED_NOTE = "Нужно основание подтверждения";
const NEED_REASON = "Нужна причина отзыва";
const PRIVACY = "Пометки сотрудника видны только ему.";

/** Снятый с формы POST: действие и тело настоящие, запись в базу не проходит. */
type CapturedPost = { url: string; headers: Record<string, string>; body: Buffer };

/** id сотрудника и снятые POST: их готовят тесты, гостевая проверка идёт следом. */
let staffId = "";
let planPath = "";
let capturedConfirm: CapturedPost | null = null;
let capturedRevoke: CapturedPost | null = null;

type Confirmation = {
  competency_id: string;
  competency_name: string;
  note: string;
  confirmed_at: number;
  confirmed_by_id: string;
  revoked_at: number | null;
  revoke_reason: string | null;
};

type Mark = { competency_id: string; status: string; note: string };

/** База воркера этого теста: у каждого воркера своя, см. `e2e/env.ts`. */
function dbFile(testInfo: TestInfo) {
  return workerDbPath(testInfo.parallelIndex);
}

/** Подтверждения сотрудника по логину. Отозванные тоже возвращаются: проверки смотрят историю строки. */
function confirmations(testInfo: TestInfo, loginName: string): Confirmation[] {
  const db = new DatabaseSync(dbFile(testInfo), { readOnly: true });
  try {
    return db
      .prepare(
        `SELECT ecc.competency_id, ecc.competency_name, ecc.note, ecc.confirmed_at, ecc.confirmed_by_id,
                ecc.revoked_at, ecc.revoke_reason
         FROM employee_competency_confirmations ecc
         JOIN employees e ON e.id = ecc.employee_id
         WHERE e.login = ?
         ORDER BY ecc.competency_id`,
      )
      .all(loginName) as Confirmation[];
  } finally {
    db.close();
  }
}

/** Личные пометки сотрудника по логину: в дерево другого человека они попадать не должны. */
function marks(testInfo: TestInfo, loginName: string): Mark[] {
  const db = new DatabaseSync(dbFile(testInfo), { readOnly: true });
  try {
    return db
      .prepare(
        `SELECT m.competency_id, m.status, m.note
         FROM employee_competency_marks m
         JOIN employees e ON e.id = m.employee_id
         WHERE e.login = ?
         ORDER BY m.competency_id`,
      )
      .all(loginName) as Mark[];
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

/** Создаёт ИПР сотруднику и открывает карточку плана; возвращает её путь. */
async function createPlan(page: Page, staff: { name: string }, targetJobId: string) {
  await page.goto("/idps");
  const form = page.locator("form", { has: page.getByRole("heading", { name: "Новый ИПР" }) });
  await form.getByLabel(/^Сотрудник/).selectOption({ label: staff.name });
  await form.getByLabel(/^Цель/).selectOption(targetJobId);
  await form.getByLabel("Начало").fill("2026-03-01");
  await form.getByLabel("Конец").fill("2026-09-30");
  await form.getByRole("button", { name: "Создать" }).click();
  const row = page.locator("li", { hasText: staff.name });
  await expect(row.getByRole("link", { name: "Младший программист → Программист" })).toBeVisible();
  await row.getByRole("link", { name: "Младший программист → Программист" }).click();
  await expect(page.getByRole("heading", { name: "Добавить задание" })).toBeVisible();
  return new URL(page.url()).pathname;
}

/** Строка плана по компетенции: она же строка узла в дереве. */
async function addItem(page: Page, competencyId: string, name: string) {
  const form = page.locator("form", { has: page.getByRole("heading", { name: "Добавить задание" }) });
  await form.getByLabel(/^Компетенция/).selectOption(competencyId);
  await form.getByLabel(/^Название/).fill(name);
  await form.getByLabel(/^Узнать/).fill(`Узнать ${name}`);
  await form.getByLabel(/^Проверить/).fill(`Проверить ${name}`);
  await form.getByRole("button", { name: "Добавить" }).click();
  await expect(page.getByRole("row", { name: new RegExp(name) })).toBeVisible();
}

/** Подтверждение через форму карточки: заодно ждёт строку в списке. */
async function confirmViaCard(page: Page, employee: string, competencyId: string, note: string) {
  await page.goto(`/people/${employee}`);
  const section = page.getByTestId("employee-confirmations");
  await expect(section).toBeVisible();
  const form = section.locator("form", { has: page.getByRole("button", { name: "Подтвердить", exact: true }) });
  await form.getByRole("combobox", { name: /^Навык/ }).selectOption(competencyId);
  await form.getByRole("textbox", { name: "Основание", exact: true }).fill(note);
  const posted = page.waitForResponse(
    (response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/people/${employee}`,
  );
  await form.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await posted;
  await expect(page.getByTestId(`employee-confirmation-${competencyId}`)).toBeVisible();
}

/** Ждёт отправки и завершения одиночного POST от селекта или ухода из поля. */
async function savePost(page: Page, run: () => Promise<unknown>) {
  const done: Promise<void>[] = [];
  const onRequest = (request: Request) => {
    if (request.method() !== "POST") return;
    done.push(
      new Promise((resolve) => {
        const finish = (finished: Request) => {
          if (finished !== request) return;
          page.off("requestfinished", finish);
          page.off("requestfailed", finish);
          resolve();
        };
        page.on("requestfinished", finish);
        page.on("requestfailed", finish);
      }),
    );
  };
  page.on("request", onRequest);
  try {
    await run();
    await expect.poll(() => done.length).toBeGreaterThan(0);
    await Promise.all(done);
  } finally {
    page.off("request", onRequest);
  }
}

/** Узел холста: его ищут по `data-testid`, а не по классам оформления. */
function skillNode(page: Page, competencyId: string) {
  return page.getByTestId(`skill-node-${competencyId}`);
}

/** Панель узла: формы подтверждения и снятия живут в ней. */
function nodePanel(page: Page) {
  return page.getByTestId("skill-node-panel");
}

/** Открывает дерево сотрудника и ждёт холст: без него проверять нечего. */
async function openTree(page: Page, employee: string) {
  await page.goto(`/people/${employee}/skills`);
  await expect(page.getByTestId("skill-tree-layout")).toBeVisible();
}

/** Открывает узел в дереве и ждёт панель. */
async function openNode(page: Page, competencyId: string) {
  const node = skillNode(page, competencyId);
  await expect(node).toBeVisible();
  await node.click();
  const panel = nodePanel(page);
  await expect(panel).toBeVisible();
  return panel;
}

/** Панель перекрывает правый край холста: перед кликом по другому узлу её закрывают. */
async function closeNodePanel(page: Page) {
  await page.keyboard.press("Escape");
  await expect(nodePanel(page)).toHaveCount(0);
}

/** `data-mark` всех узлов холста: по нему видно, что личного слоя в снимке нет. */
async function nodeMarks(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-testid^="skill-node-"][data-skill]')].map(
      (element) => element.dataset.mark ?? "",
    ),
  );
}

/** `data-relation` всех узлов холста: текущая должность, цель ИПР или обе. */
async function nodeRelations(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-testid^="skill-node-"][data-skill]')].map(
      (element) => element.dataset.relation ?? "",
    ),
  );
}

/**
 * Снимает тело настоящего POST формы, не давая ему дойти до сервера.
 * Нужно, чтобы повторить действие от имени, которому оно запрещено, и чтобы обновить ту же строку.
 */
async function capturePost(
  page: Page,
  pattern: string,
  prepare: () => Promise<void>,
  submit: () => Promise<void>,
): Promise<CapturedPost> {
  let release!: (value: CapturedPost) => void;
  const captured = new Promise<CapturedPost>((resolve) => {
    release = resolve;
  });
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
    await prepare();
    await submit();
    return await Promise.race([
      captured,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("форма не отправила POST")), 20_000),
      ),
    ]);
  } finally {
    await page.unroute(pattern);
  }
}

/** Повтор снятого POST от текущей учётки: сервер проверяет права сам. */
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

/**
 * Подменяет значение поля в теле снятого POST: тело `multipart/form-data` границ частей не меняет,
 * поэтому замена строки на другую длины остаётся корректной.
 */
function withBodyValue(captured: CapturedPost, from: string, to: string): CapturedPost {
  const text = captured.body.toString("utf8");
  expect(text, `поле «${from}» найдено в теле запроса`).toContain(from);
  return { ...captured, body: Buffer.from(text.split(from).join(to), "utf8") };
}

test("критерий 1: руководитель открывает дерево из карточки и не видит личных пометок", async ({
  page,
}, testInfo) => {
  await login(page);
  const manager = await createPerson(page, MANAGER);
  staffId = await createPerson(page, STAFF, MANAGER.name);
  const outsider = await createPerson(page, OUTSIDER);
  expect(manager, "id руководителя найден").not.toBe("");
  expect(staffId, "id подчинённого найден").not.toBe("");
  expect(outsider, "id чужого сотрудника найден").not.toBe("");

  // Цель ИПР и строки плана: дерево должно показать и узлы цели, и строки активного плана.
  // Строка по навыку текущей должности нужна для приёмки: она подтверждает узел без ручной записи.
  planPath = await createPlan(page, STAFF, "programmer");
  await addItem(page, TARGET, ITEM_NAME);
  await addItem(page, CURRENT, IDP_ITEM);

  // Подтверждение вне обеих должностей: оно держит навык в разделе «Вне профиля».
  await confirmViaCard(page, staffId, OUTSIDE, OUTSIDE_NOTE);

  // Личная пометка с пояснением: её не должен увидеть никто, кроме автора (ADR 0007).
  await logout(page);
  await login(page, STAFF);
  await page.goto("/me/skills");
  const markPanel = await openNode(page, MARKED);
  await savePost(page, () => markPanel.getByLabel(/^Статус:/).selectOption("has"));
  const noteField = markPanel.getByLabel(/^Пояснение:/);
  await expect(noteField).toBeVisible();
  await savePost(page, async () => {
    await noteField.fill(STAFF_NOTE);
    await noteField.blur();
  });
  expect(marks(testInfo, STAFF.login), "пометка сотрудника записана").toEqual(
    expect.arrayContaining([expect.objectContaining({ competency_id: MARKED, note: STAFF_NOTE })]),
  );

  await logout(page);
  await login(page, MANAGER);

  // Вход в дерево — из карточки сотрудника, не по адресу из головы.
  await page.goto(`/people/${staffId}`);
  await page.getByTestId("employee-skills-link").click();
  await expect(page).toHaveURL(new RegExp(`/people/${staffId}/skills$`));
  await expect(page.getByRole("heading", { level: 1, name: "Дерево навыков" })).toBeVisible();
  await expect(page.getByTestId("skill-tree-layout")).toBeVisible();

  // Узлы текущей должности и цели ИПР на холсте. Профиль junior — подмножество programmer,
  // поэтому навык текущей должности идёт с отношением «both», а не «current».
  // React Flow рисует узлы после гидратации: дожидаемся известного узла, а не читаем холст сразу.
  await expect(skillNode(page, TARGET), "навык цели виден по умолчанию").toBeVisible();
  await expect
    .poll(
      async () => {
        const relations = await nodeRelations(page);
        return relations.includes("both") && relations.includes("target");
      },
      { message: "навыки текущей должности и цели ИПР на холсте" },
    )
    .toBe(true);

  // Звезда подтверждения: строка в карточке дала её и вне профиля.
  await expect(skillNode(page, OUTSIDE), "подтверждённый навык вне профиля виден").toBeVisible();
  await expect(page.getByTestId(`skill-badge-${OUTSIDE}`), "звезда подтверждения горит").toBeVisible();
  await expect(page.getByTestId("skill-outside"), "раздел «Вне профиля» есть").toBeVisible();

  // Строки активного плана остаются: в панели узла цели видно задание.
  const targetPanel = await openNode(page, TARGET);
  await expect(targetPanel.getByTestId("skill-panel-rows"), "строки плана в панели").toContainText(ITEM_NAME);
  await expect(targetPanel.getByTestId("skill-panel-criteria"), "критерий навыка в панели").toBeVisible();

  // Блока пометки нет: ни селекта статуса, ни ссылки на список пометок.
  await expect(targetPanel.getByLabel(/^Статус:/), "формы пометки в чужом дереве нет").toHaveCount(0);
  await expect(
    targetPanel.getByRole("link", { name: "Все пометки по компетенциям" }),
    "ссылки на личные пометки нет",
  ).toHaveCount(0);
  await expect(targetPanel.getByTestId("skill-panel-confirmation"), "блок подтверждения есть").toBeVisible();

  // Счётчик «Освоено» и легенда пометок скрыты, вместо них подпись о приватности.
  await expect(page.getByTestId("skill-stat-mastered"), "счётчика «Освоено» нет").toHaveCount(0);
  await expect(page.getByTestId("skill-stat-privacy"), "подпись о приватности есть").toHaveText(PRIVACY);
  await expect(page.getByTestId("skill-legend-has"), "легенды пометок нет").toHaveCount(0);
  await expect(page.getByTestId("skill-legend-in_progress"), "легенды «в процессе» нет").toHaveCount(0);

  // Ни заливки, ни пояснения сотрудника: личный слой не пришёл даже в данные.
  expect(new Set(await nodeMarks(page)), "ни одного узла с пометкой").toEqual(new Set(["none"]));
  await expect(page.getByText(STAFF_NOTE), "пояснение сотрудника не показано").toHaveCount(0);
});

test("критерий 2: подтверждение в узле зажигает звезду, повтор обновляет ту же строку", async ({
  page,
}, testInfo) => {
  expect(staffId, "сотрудник из критерия 1 есть").not.toBe("");

  await login(page, MANAGER);
  await openTree(page, staffId);

  // POST снимается с настоящей формы: им же потом проверяется повторное подтверждение.
  capturedConfirm = await capturePost(
    page,
    `**/people/${staffId}/skills`,
    async () => {
      await openNode(page, TARGET);
    },
    async () => {
      const form = nodePanel(page).locator("form");
      await form.getByRole("textbox", { name: "Основание", exact: true }).fill(MANAGER_NOTE);
      await form.getByRole("button", { name: "Подтвердить", exact: true }).click();
    },
  );

  await openTree(page, staffId);
  const panel = await openNode(page, TARGET);
  await expect(panel.getByTestId("skill-panel-not-confirmed"), "до подтверждения записи нет").toBeVisible();
  const form = panel.locator("form");
  await form.getByRole("textbox", { name: "Основание", exact: true }).fill(MANAGER_NOTE);
  const posted = page.waitForResponse(
    (response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/people/${staffId}/skills`,
  );
  await form.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await posted;

  await expect(page.getByTestId(`skill-badge-${TARGET}`), "звезда загорелась без перезагрузки").toBeVisible();

  const first = confirmations(testInfo, STAFF.login).find((item) => item.competency_id === TARGET);
  expect(first, "строка подтверждения записана").toBeDefined();
  expect(first!.note, "основание записано").toBe(MANAGER_NOTE);
  expect(first!.revoked_at, "подтверждение действует").toBeNull();

  // Та же запись видна в карточке: дата, автор и основание, а не только звезда в дереве.
  await page.goto(`/people/${staffId}`);
  const row = page.getByTestId(`employee-confirmation-${TARGET}`);
  await expect(row, "строка видна в карточке").toBeVisible();
  await expect(row, "основание в карточке").toContainText(MANAGER_NOTE);
  await expect(row, "дата в карточке").toContainText(/\d{2}\.\d{2}\.\d{4}/);
  await expect(row, "автор в карточке — руководитель").toContainText(MANAGER.name);

  // Повтор: тело того же POST с другим основанием обновляет строку, второй записи нет.
  await page.waitForTimeout(1100);
  const repeated = await replayCaptured(page, withBodyValue(capturedConfirm!, MANAGER_NOTE, MANAGER_NOTE_2));
  expect(await repeated.text(), "повторное подтверждение принято").not.toContain(NEED_NOTE);

  const rows = confirmations(testInfo, STAFF.login).filter((item) => item.competency_id === TARGET);
  expect(rows, "вторая строка не появилась").toHaveLength(1);
  expect(rows[0].note, "основание обновлено").toBe(MANAGER_NOTE_2);
  expect(rows[0].confirmed_at, "дата обновлена").toBeGreaterThan(first!.confirmed_at);
  await page.goto(`/people/${staffId}`);
  await expect(page.getByTestId(`employee-confirmation-${TARGET}`), "в карточке новое основание").toContainText(
    MANAGER_NOTE_2,
  );
});

test("критерий 2: подтверждение приёмкой ИПР не снимается формой в узле", async ({ page }, testInfo) => {
  expect(staffId, "сотрудник из критерия 1 есть").not.toBe("");
  expect(planPath, "путь плана из критерия 1 сохранён").not.toBe("");

  await login(page, MANAGER);
  await page.goto(planPath);
  const row = page.getByRole("row", { name: new RegExp(IDP_ITEM) });
  await row.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await expect(row.getByText("принято", { exact: true })).toBeVisible();

  // Приёмка — источник подтверждения, но не ручная запись: снимать в узле нечего.
  expect(
    confirmations(testInfo, STAFF.login).filter((item) => item.competency_id === CURRENT),
    "ручной записи по приёмке нет",
  ).toEqual([]);

  await openTree(page, staffId);
  await expect(page.getByTestId(`skill-badge-${CURRENT}`), "звезда от приёмки горит").toBeVisible();
  const panel = await openNode(page, CURRENT);
  const state = panel.getByTestId("skill-panel-confirmation-state");
  await expect(state, "источник подтверждения виден").toContainText("Приёмкой ИПР");
  await expect(state.getByRole("link", { name: "план", exact: true }), "ссылка на план есть").toBeVisible();
  await expect(panel.getByTestId("skill-panel-confirmed-by-idp"), "подпись про отмену приёмки").toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Снять", exact: true }),
    "формы снятия подтверждения приёмкой нет",
  ).toHaveCount(0);
});

test("критерий 3 (негативный): в чужом дереве нет формы пометки, POST пометки пишет автору", async ({
  page,
}, testInfo) => {
  expect(staffId, "сотрудник из критерия 1 есть").not.toBe("");

  await login(page, MANAGER);
  await openTree(page, staffId);
  const panel = await openNode(page, CURRENT);
  await expect(panel.getByLabel(/^Статус:/), "формы пометки в чужом дереве нет").toHaveCount(0);

  // Пометку отправляет сам руководитель: селект на его личном дереве снимается с формы.
  const markPost = await capturePost(
    page,
    "**/me/skills",
    async () => {
      await page.goto("/me/skills");
      await openNode(page, CURRENT);
    },
    async () => {
      await nodePanel(page).getByLabel(/^Статус:/).selectOption("has");
    },
  );

  const beforeStaff = marks(testInfo, STAFF.login);
  await openTree(page, staffId);
  const replay = await replayCaptured(page, markPost);
  expect(await replay.text(), "сервер принял пометку от действующего пользователя").not.toContain("Нельзя");

  // Пометка записалась автору, а не сотруднику карточки: действие всегда пишет вошедшему.
  expect(
    marks(testInfo, MANAGER.login),
    "пометка руководителя записана ему",
  ).toEqual(expect.arrayContaining([expect.objectContaining({ competency_id: CURRENT, status: "has" })]));
  expect(marks(testInfo, STAFF.login), "пометок сотрудника не прибавилось").toEqual(beforeStaff);
  await openTree(page, staffId);
  expect(new Set(await nodeMarks(page)), "ни одного узла с пометкой").toEqual(new Set(["none"]));
});

test("критерий 4 (негативный): чужая учётка получает 404, повтор POST не меняет базу", async ({
  page,
}, testInfo) => {
  expect(staffId, "сотрудник из критерия 1 есть").not.toBe("");
  expect(capturedConfirm, "POST подтверждения снят в критерии 2").not.toBeNull();
  const before = confirmations(testInfo, STAFF.login);

  await login(page, OUTSIDER);

  const response = await page.goto(`/people/${staffId}/skills`);
  expect(response?.status(), "чужое дерево недоступно").toBe(404);
  await expect(page.getByTestId("skill-tree-layout"), "холста чужого дерева нет").toHaveCount(0);

  const replay = await replayCaptured(page, capturedConfirm!);
  expect(await replay.text(), "сервер отказал чужому сотруднику").toContain(CONFIRM_DENIED);
  expect(confirmations(testInfo, STAFF.login), "база не изменилась").toEqual(before);

  // Тот же снимок POST, но подложенное основание: отказ приходит до записи, а не из формы.
  const forged = await replayCaptured(page, withBodyValue(capturedConfirm!, MANAGER_NOTE, GUEST_NOTE));
  expect(await forged.text(), "подложенное подтверждение отклонено").toContain(CONFIRM_DENIED);
  expect(confirmations(testInfo, STAFF.login), "подложенная запись не появилась").toEqual(before);
});

test("критерий 5 (негативный): пустое основание и пустая причина отклоняются в панели", async ({
  page,
}, testInfo) => {
  expect(staffId, "сотрудник из критерия 1 есть").not.toBe("");

  await login(page, MANAGER);
  await openTree(page, staffId);

  // Основание из пробелов: у поля нет `required`, проверка серверная, ошибка остаётся в панели.
  const freePanel = await openNode(page, FREE);
  const confirmForm = freePanel.locator("form");
  await confirmForm.getByRole("textbox", { name: "Основание", exact: true }).fill("   ");
  const posted = page.waitForResponse(
    (response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/people/${staffId}/skills`,
  );
  await confirmForm.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await posted;
  await expect(confirmForm.getByRole("alert"), "ошибка основания показана в панели").toHaveText(NEED_NOTE);
  expect(
    confirmations(testInfo, STAFF.login).some((item) => item.competency_id === FREE),
    "записи без основания нет",
  ).toBe(false);
  await expect(page.getByTestId(`skill-badge-${FREE}`), "звезда не зажглась").toHaveCount(0);

  // Причина снятия: ручная запись из критерия 2, пустая и из пробелов причина отклоняются.
  await closeNodePanel(page);
  const targetPanel = await openNode(page, TARGET);
  await expect(targetPanel.getByTestId("skill-panel-confirmation-state"), "состояние подтверждения видно").toBeVisible();
  const before = confirmations(testInfo, STAFF.login);
  for (const reason of ["", "   "]) {
    const form = nodePanel(page).locator("form");
    await form.getByRole("textbox", { name: "Причина", exact: true }).fill(reason);
    const revoked = page.waitForResponse(
      (response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/people/${staffId}/skills`,
    );
    await form.getByRole("button", { name: "Снять", exact: true }).click();
    await revoked;
    await expect(form.getByRole("alert"), `снятие с причиной «${reason}» отклонено`).toHaveText(NEED_REASON);
  }
  expect(confirmations(testInfo, STAFF.login), "строка не изменилась").toEqual(before);

  // С причиной запись снимается: форма снятия есть только у ручной записи, а отзыв виден в базе.
  // Тело настоящего запроса сохраняется до ответа: им же потом проверяется отказ чужой учётке.
  const revokeForm = nodePanel(page).locator("form");
  await revokeForm.getByRole("textbox", { name: "Причина", exact: true }).fill(REVOKE_REASON);
  const revokeRequest = page.waitForRequest(
    (request) => request.method() === "POST" && new URL(request.url()).pathname === `/people/${staffId}/skills`,
  );
  const revokePosted = page.waitForResponse(
    (response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/people/${staffId}/skills`,
  );
  await revokeForm.getByRole("button", { name: "Снять", exact: true }).click();
  const request = await revokeRequest;
  await revokePosted;
  const body = request.postDataBuffer();
  expect(body, "тело запроса отзыва снято").not.toBeNull();
  capturedRevoke = {
    url: request.url(),
    headers: request.headers(),
    body: body!,
  };

  await expect(page.getByTestId(`skill-badge-${TARGET}`), "звезда погасла").toHaveCount(0);
  const revokedRow = confirmations(testInfo, STAFF.login).find((item) => item.competency_id === TARGET);
  expect(revokedRow, "строка осталась в базе").toBeDefined();
  expect(revokedRow!.revoked_at, "дата отзыва записана").not.toBeNull();
  expect(revokedRow!.revoke_reason, "причина отзыва записана").toBe(REVOKE_REASON);
});

test("критерий 4 (негативный): повтор POST отзыва от чужого отклоняется, строка не меняется", async ({
  page,
}, testInfo) => {
  expect(staffId, "сотрудник из критерия 1 есть").not.toBe("");
  expect(capturedRevoke, "POST отзыва снят в критерии 5").not.toBeNull();
  const before = confirmations(testInfo, STAFF.login);
  await login(page, OUTSIDER);
  const replay = await replayCaptured(page, capturedRevoke!);
  expect(await replay.text(), "сервер отказал чужому на отзыве").toContain(REVOKE_DENIED);
  expect(confirmations(testInfo, STAFF.login), "база не изменилась").toEqual(before);
});

// Гость идёт без сессии: файл по умолчанию от админа, здесь это выключено.
test.describe("гость", () => {
  test.use({ asAdmin: false });

  test("критерий 4 (негативный): гость уходит на вход, подтверждение не проходит", async ({ page }, testInfo) => {
    expect(staffId, "дерево для гостя подготовлено").not.toBe("");
    expect(capturedConfirm, "гостевой POST снят с формы").not.toBeNull();
    const before = confirmations(testInfo, STAFF.login);

    await page.goto(`/people/${staffId}/skills`);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByTestId("skill-tree-layout"), "холста гостю нет").toHaveCount(0);

    const replay = await replayCaptured(page, capturedConfirm!);
    expect(await replay.text(), "сервер отказал гостю").toContain("Нужна сессия сотрудника");
    expect(confirmations(testInfo, STAFF.login), "база не изменилась").toEqual(before);
  });
});
