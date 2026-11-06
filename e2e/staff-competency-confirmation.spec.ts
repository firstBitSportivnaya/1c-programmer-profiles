/**
 * Компетенции: ручное подтверждение и отзыв (ADR 0011, issue #126).
 *
 * Файл работает от админа: сессия одна на воркер (см. `e2e/fixtures.ts`). Сотрудники и оргсвязи
 * создаются этими же тестами, поэтому база воркера не зависит от seed. Проверки критериев 1–5
 * смотрят и экран, и строку `employee_competency_confirmations` в базе воркера: видно, что
 * записалось, а не только что показано. Повторный POST действия снимается с настоящей формы и
 * проигрывается от чужого имени: страница могла бы просто спрятать форму, сервер обязан отказать.
 */
import type { Page, TestInfo } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { E2E_ADMIN, workerDbPath } from "./env";
import { expect, login, test } from "./fixtures";

test.describe.configure({ mode: "serial" });

test.use({ asAdmin: true });

const STAMP = Date.now();
const PASSWORD = "e2e-confirmation-password";

function account(tag: string, name: string) {
  return { login: `e2e.confirm.${tag}.${STAMP}`, name: `${name} ${STAMP}`, password: PASSWORD };
}

const C1 = account("c1", "Подтверждение C1");
const M2 = account("m2", "Руководитель M2");
const S2 = account("s2", "Подчинённый S2");
const O2 = account("o2", "Чужой O2");
const X3 = account("x3", "Чужой X3");
const Y3 = account("y3", "Сотрудник Y3");
const P4 = account("p4", "Основание P4");
const D4 = account("d4", "Подложное D4");
const R5 = account("r5", "Отзыв R5");
const E5 = account("e5", "Причина E5");
const GT = account("gt", "Гость GT");

const SKILL = "comp-yazyk-sql";
const SKILL_NAME = "Язык SQL";
const DUTY_ID = "comp-algoritmizaciya-postavlennyh-zadach-a-01-03";
const DUTY_NAME = "Алгоритмизация поставленных задач (A/01.3)";

const NOTE = `Проект на проде E2E ${STAMP}`;
const NOTE_2 = `Наставничество E2E ${STAMP}`;
const MANAGER_NOTE = `Прямой подчинённый E2E ${STAMP}`;
const FOREIGN_NOTE = `Чужое подтверждение E2E ${STAMP}`;
const FORGED_NOTE = `Подложенное подтверждение E2E ${STAMP}`;
const OWN_NOTE = `Подтверждение сотрудника E2E ${STAMP}`;
const REVOKE_REASON = `Причина отзыва E2E ${STAMP}`;
const FOREIGN_REASON = `Чужой отзыв E2E ${STAMP}`;
const OWN_REASON = `Свой отзыв E2E ${STAMP}`;
const GUEST_NOTE = `Гостевое подтверждение E2E ${STAMP}`;

const CONFIRM_DENIED = "Нельзя подтвердить компетенцию этому сотруднику";
const REVOKE_DENIED = "Нельзя отозвать подтверждение этого сотрудника";

/** Снятый с формы POST: действие и тело настоящие, запись в базу не проходит. */
type CapturedPost = { url: string; headers: Record<string, string>; body: Buffer };

/** Карточка и POST для гостевой проверки: их готовит админ в критерии 3, `describe` идёт следом. */
let guestTarget = "";
let guestConfirmPost: CapturedPost | null = null;

/** Строка подтверждения: проверки смотрят базу, а не только экран. */
type Confirmation = {
  competency_id: string;
  competency_name: string;
  note: string;
  confirmed_at: number;
  confirmed_by_id: string;
  revoked_at: number | null;
  revoked_by_id: string | null;
  revoke_reason: string | null;
};

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
                ecc.revoked_at, ecc.revoked_by_id, ecc.revoke_reason
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

/** id админа: по нему подписаны подтверждение и отзыв. */
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

/** Секция «Компетенции»: все локаторы держатся внутри неё, чтобы не поймать блок ИПР и правку админа. */
function section(page: Page) {
  return page.getByTestId("employee-confirmations");
}

/**
 * Форма подтверждения — единственная форма секции с кнопкой «Подтвердить». У `select` внутри
 * `<label>` в подпись попадают названия вариантов, поэтому навык ищется по началу подписи.
 */
function confirmForm(page: Page) {
  return page.getByTestId("employee-confirmations").locator("form", {
    has: page.getByRole("button", { name: "Подтвердить", exact: true }),
  });
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

/**
 * Снимает тело настоящего POST формы карточки, не давая ему дойти до сервера.
 * Нужно, чтобы повторить действие от имени, которому оно запрещено.
 */
async function capturePost(page: Page, employee: string, submit: () => Promise<void>): Promise<CapturedPost> {
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
    await openCard(page, employee);
    await submit();
    return await Promise.race([
      captured,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("форма карточки не отправила POST")), 20_000),
      ),
    ]);
  } finally {
    await page.unroute(pattern);
  }
}

/** Снимает POST подтверждения с настоящей формы, пока страницу открывает админ. */
function captureConfirmPost(page: Page, employee: string, competencyId: string, note: string) {
  return capturePost(page, employee, async () => {
    const form = confirmForm(page);
    await form.getByRole("combobox", { name: /^Навык/ }).selectOption(competencyId);
    await form.getByRole("textbox", { name: "Основание", exact: true }).fill(note);
    await form.getByRole("button", { name: "Подтвердить", exact: true }).click();
  });
}

/** Снимает POST отзыва из формы строки: причина заполняется, но на сервер запрос не уходит. */
function captureRevokePost(page: Page, employee: string, competencyId: string, reason: string) {
  return capturePost(page, employee, async () => {
    const row = confirmationRow(page, competencyId);
    await expect(row).toBeVisible();
    await row.getByRole("textbox", { name: "Причина", exact: true }).fill(reason);
    await row.getByRole("button", { name: "Отозвать", exact: true }).click();
  });
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

/**
 * Подменяет значение поля в теле снятого POST: тело `multipart/form-data` границ частей не меняет,
 * поэтому замена строки на другую длины остаётся корректной. Так проверяется серверная проверка
 * на подложенных значениях, которые форма отправить не даёт.
 */
function withBodyValue(captured: CapturedPost, from: string, to: string): CapturedPost {
  const text = captured.body.toString("utf8");
  expect(text, `поле «${from}» найдено в теле запроса`).toContain(from);
  return { ...captured, body: Buffer.from(text.split(from).join(to), "utf8") };
}

test("критерий 1: админ подтверждает навык с основанием, повтор обновляет ту же строку", async ({
  page,
}, testInfo) => {
  await login(page);
  const employee = await createPerson(page, C1);
  expect(employee, "id сотрудника найден").not.toBe("");
  const admin = adminId(testInfo);
  expect(admin, "id админа найден").not.toBe("");

  await openCard(page, employee);
  await expect(page.getByTestId("employee-confirmations-empty"), "подтверждений ещё нет").toBeVisible();
  const skills = confirmForm(page).getByRole("combobox", { name: /^Навык/ });
  await expect(
    skills.locator("option", { hasText: DUTY_NAME }),
    "обязанности в списке навыков нет",
  ).toHaveCount(0);
  await expect(skills.locator("option", { hasText: SKILL_NAME }), "навык для подтверждения есть").toHaveCount(1);

  await confirmViaUi(page, employee, SKILL, NOTE);

  const first = confirmations(testInfo, C1.login).find((item) => item.competency_id === SKILL);
  expect(first, "строка подтверждения записана").toBeDefined();
  expect(first!.confirmed_by_id, "автор подтверждения — админ").toBe(admin);
  expect(first!.confirmed_at, "дата подтверждения записана").toBeGreaterThan(0);
  expect(first!.note, "основание записано").toBe(NOTE);
  expect(first!.revoked_at, "подтверждение действует").toBeNull();

  const row = confirmationRow(page, SKILL);
  await expect(row, "строка видна в карточке").toBeVisible();
  await expect(row, "в строке название навыка").toContainText(SKILL_NAME);
  await expect(row, "в строке основание").toContainText(NOTE);
  await expect(row, "в строке дата ДД.ММ.ГГГГ").toContainText(/\d{2}\.\d{2}\.\d{4}/);
  await expect(row, "в строке автор подтверждения").toContainText(E2E_ADMIN.name);

  // Секунда нужна, чтобы новая дата отличалась от прежней: `confirmed_at` хранится в секундах.
  await page.waitForTimeout(1100);
  await confirmViaUi(page, employee, SKILL, NOTE_2);

  const rows = confirmations(testInfo, C1.login).filter((item) => item.competency_id === SKILL);
  expect(rows, "вторая строка не появилась").toHaveLength(1);
  expect(rows[0].note, "основание обновлено").toBe(NOTE_2);
  expect(rows[0].confirmed_at, "дата подтверждения обновлена").toBeGreaterThan(first!.confirmed_at);
  expect(rows[0].revoked_at, "повторное подтверждение действует").toBeNull();
  await expect(confirmationRow(page, SKILL), "в карточке новое основание").toContainText(NOTE_2);
});

test("критерий 2: руководитель подтверждает прямому подчинённому, чужое подтверждение отклоняется", async ({
  page,
}, testInfo) => {
  await login(page);
  const manager = await createPerson(page, M2);
  const subordinate = await createPerson(page, S2, M2.name);
  const outsider = await createPerson(page, O2);
  expect(manager, "id руководителя найден").not.toBe("");
  expect(subordinate, "id подчинённого найден").not.toBe("");
  expect(outsider, "id чужого сотрудника найден").not.toBe("");
  const before = confirmations(testInfo, O2.login);

  // Действие снимается с настоящей формы, пока карточку чужого сотрудника открывает админ.
  const captured = await captureConfirmPost(page, outsider, SKILL, FOREIGN_NOTE);

  await login(page, M2);
  await confirmViaUi(page, subordinate, SKILL, MANAGER_NOTE);

  const row = confirmations(testInfo, S2.login).find((item) => item.competency_id === SKILL);
  expect(row, "подтверждение прямому подчинённому записано").toBeDefined();
  expect(row!.confirmed_by_id, "подтвердил руководитель").toBe(manager);
  expect(row!.note, "основание записано").toBe(MANAGER_NOTE);
  expect(row!.revoked_at, "подтверждение действует").toBeNull();

  const replay = await replayCaptured(page, captured);
  expect(await replay.text(), "сервер отказал чужому руководителю").toContain(CONFIRM_DENIED);

  expect(confirmations(testInfo, O2.login), "строк в базе не прибавилось").toEqual(before);
});

test("критерий 3 (негативный): сотрудник не подтверждает себе и чужому, не отзывает подтверждение", async ({
  page,
}, testInfo) => {
  await login(page);
  const target = await createPerson(page, X3);
  const actor = await createPerson(page, Y3);
  expect(target, "id чужого сотрудника найден").not.toBe("");
  expect(actor, "id сотрудника найден").not.toBe("");

  // Действующие строки, которые сотрудник попробует переписать и отозвать.
  await confirmViaUi(page, target, SKILL, FOREIGN_NOTE);
  await confirmViaUi(page, actor, SKILL, OWN_NOTE);
  const beforeTarget = confirmations(testInfo, X3.login);
  const beforeSelf = confirmations(testInfo, Y3.login);

  // Оба POST подтверждения и оба POST отзыва снимаются админом: чужая карточка и своя.
  const foreignPost = await captureConfirmPost(page, target, SKILL, FORGED_NOTE);
  const selfPost = await captureConfirmPost(page, actor, SKILL, FORGED_NOTE);
  const revokePost = await captureRevokePost(page, target, SKILL, FOREIGN_REASON);
  const selfRevokePost = await captureRevokePost(page, actor, SKILL, OWN_REASON);

  await login(page, Y3);
  const foreign = await page.goto(`/people/${target}`);
  expect(foreign?.status(), "чужая карточка недоступна").toBe(404);
  await expect(page.getByTestId("employee-confirmations"), "чужой секции компетенций нет").toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: /^Навык/ }),
    "чужой формы подтверждения нет",
  ).toHaveCount(0);

  await page.goto(`/people/${actor}`);
  const own = section(page);
  await expect(own, "своя секция компетенций видна").toBeVisible();
  await expect(own.getByTestId("employee-confirmations-list"), "список подтверждений виден").toBeVisible();
  await expect(confirmationRow(page, SKILL), "своё подтверждение видно").toContainText(OWN_NOTE);
  await expect(
    own.getByRole("combobox", { name: /^Навык/ }),
    "сотрудник не видит форму подтверждения",
  ).toHaveCount(0);
  await expect(
    own.getByRole("button", { name: "Подтвердить", exact: true }),
    "кнопки подтверждения нет",
  ).toHaveCount(0);

  const foreignReplay = await replayCaptured(page, foreignPost);
  expect(await foreignReplay.text(), "сервер отказал на чужой карточке").toContain(CONFIRM_DENIED);
  const selfReplay = await replayCaptured(page, selfPost);
  expect(await selfReplay.text(), "сервер отказал в подтверждении себе").toContain(CONFIRM_DENIED);
  const revokeReplay = await replayCaptured(page, revokePost);
  expect(await revokeReplay.text(), "сервер отказал в отзыве чужого").toContain(REVOKE_DENIED);
  // Своё подтверждение не отзывается так же: подмена «чужое» на «своё» не должна проходить.
  const selfRevokeReplay = await replayCaptured(page, selfRevokePost);
  expect(await selfRevokeReplay.text(), "сервер отказал в отзыве своего").toContain(REVOKE_DENIED);

  expect(confirmations(testInfo, X3.login), "чужая строка не изменилась").toEqual(beforeTarget);
  expect(confirmations(testInfo, Y3.login), "своя строка не изменилась").toEqual(beforeSelf);
  const targetRow = confirmations(testInfo, X3.login).find((item) => item.competency_id === SKILL);
  expect(targetRow, "строка чужого сотрудника на месте").toBeDefined();
  expect(targetRow!.revoked_at, "отзыв не записан").toBeNull();

  // Гостевой POST снимается с формы админом: в гостевом `describe` сессии уже не будет.
  await login(page);
  guestTarget = await createPerson(page, GT);
  expect(guestTarget, "id сотрудника для гостевой проверки найден").not.toBe("");
  guestConfirmPost = await captureConfirmPost(page, guestTarget, SKILL, GUEST_NOTE);
});

// Гость идёт без сессии: файл по умолчанию от админа, здесь это выключено.
test.describe("гость", () => {
  test.use({ asAdmin: false });

  test("критерий 3 (негативный): гость уходит на вход, подтверждение не проходит", async ({
    page,
  }, testInfo) => {
    expect(guestTarget, "карточка для гостя подготовлена админом").not.toBe("");
    expect(guestConfirmPost, "гостевой POST снят с формы").not.toBeNull();
    const before = confirmations(testInfo, GT.login);

    await page.goto(`/people/${guestTarget}`);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByTestId("employee-confirmations"), "секции компетенций гостю нет").toHaveCount(0);
    await expect(page.getByRole("combobox", { name: /^Навык/ }), "формы подтверждения гостю нет").toHaveCount(0);

    const replay = await replayCaptured(page, guestConfirmPost!);
    expect(await replay.text(), "сервер отказал гостю").toContain("Нужна сессия сотрудника");
    expect(confirmations(testInfo, GT.login), "база не изменилась").toEqual(before);
  });
});

test("критерий 4 (негативный): основание из пробелов отклоняется, записи нет", async ({ page }, testInfo) => {
  await login(page);
  const employee = await createPerson(page, P4);
  expect(employee, "id сотрудника найден").not.toBe("");

  await openCard(page, employee);
  const form = confirmForm(page);
  await form.getByRole("combobox", { name: /^Навык/ }).selectOption(SKILL);
  await form.getByRole("textbox", { name: "Основание", exact: true }).fill("   ");
  const posted = cardPost(page, employee);
  await form.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await posted;

  // Ошибку ищем внутри формы: в production-сборке рядом есть `__next-route-announcer__` с role="alert".
  await expect(form.getByRole("alert"), "ошибка показана в форме секции").toHaveText(
    "Нужно основание подтверждения",
  );
  await expect(page.getByTestId("employee-confirmations-empty"), "список остался пустым").toBeVisible();
  expect(confirmations(testInfo, P4.login), "записи в базе нет").toHaveLength(0);
});

test("критерий 4 (негативный): подложенная обязанность и основание длиннее 1000 символов отклоняются сервером", async ({
  page,
}, testInfo) => {
  await login(page);
  const employee = await createPerson(page, D4);
  expect(employee, "id сотрудника найден").not.toBe("");
  const captured = await captureConfirmPost(page, employee, SKILL, NOTE);

  // Обязанность есть в справочнике, но подтверждать её нельзя: форма такого варианта не даёт.
  const duty = await replayCaptured(page, withBodyValue(captured, SKILL, DUTY_ID));
  expect(await duty.text(), "обязанность подтвердить нельзя").toContain("Подтвердить можно только навык");

  const longNote = await replayCaptured(page, withBodyValue(captured, NOTE, "я".repeat(1001)));
  expect(await longNote.text(), "основание длиннее предела отклонено").toContain(
    "Основание: не длиннее 1000 символов",
  );

  expect(confirmations(testInfo, D4.login), "записей в базе нет").toHaveLength(0);
});

test("критерий 5: отзыв с причиной, повторное подтверждение возвращает строку, повторный отзыв данные не ломает", async ({
  page,
}, testInfo) => {
  await login(page);
  const employee = await createPerson(page, R5);
  expect(employee, "id сотрудника найден").not.toBe("");
  const admin = adminId(testInfo);
  expect(admin, "id админа найден").not.toBe("");

  await confirmViaUi(page, employee, SKILL, NOTE);
  const captured = await captureRevokePost(page, employee, SKILL, REVOKE_REASON);
  await revokeViaUi(page, employee, SKILL, REVOKE_REASON);

  const revoked = confirmations(testInfo, R5.login).find((item) => item.competency_id === SKILL);
  expect(revoked, "строка осталась в базе").toBeDefined();
  expect(revoked!.revoked_at, "дата отзыва записана").not.toBeNull();
  expect(revoked!.revoked_by_id, "отзыв подписан админом").toBe(admin);
  expect(revoked!.revoke_reason, "причина отзыва записана").toBe(REVOKE_REASON);
  await expect(confirmationRow(page, SKILL), "строка ушла из списка").toHaveCount(0);

  const replay = await replayCaptured(page, captured);
  expect(await replay.text(), "повторный отзыв отклонён").toContain("Подтверждение не найдено");
  const after = confirmations(testInfo, R5.login);
  expect(after, "повторный отзыв строку не изменил").toEqual([revoked]);

  // Секунда нужна, чтобы новая дата отличалась от прежней: `confirmed_at` хранится в секундах.
  await page.waitForTimeout(1100);
  await confirmViaUi(page, employee, SKILL, NOTE_2);

  const restored = confirmations(testInfo, R5.login);
  expect(restored, "строк по-прежнему одна").toHaveLength(1);
  expect(restored[0].revoked_at, "отзыв снят").toBeNull();
  expect(restored[0].revoked_by_id, "подпись отзыва стёрта").toBeNull();
  expect(restored[0].revoke_reason, "причина отзыва стёрта").toBeNull();
  expect(restored[0].note, "основание обновлено").toBe(NOTE_2);
  expect(restored[0].confirmed_at, "дата подтверждения обновлена").toBeGreaterThan(revoked!.confirmed_at);
  await expect(confirmationRow(page, SKILL), "строка вернулась в список").toContainText(NOTE_2);
});

test("критерий 5 (негативный): отзыв без причины и из пробелов отклоняется, строка остаётся действующей", async ({
  page,
}, testInfo) => {
  await login(page);
  const employee = await createPerson(page, E5);
  expect(employee, "id сотрудника найден").not.toBe("");

  await confirmViaUi(page, employee, SKILL, NOTE);
  const before = confirmations(testInfo, E5.login);
  const row = confirmationRow(page, SKILL);
  await expect(row, "строка подтверждения видна").toBeVisible();
  const form = row.locator("form");

  // Поле причины не имеет `required`: пустое значение и пробелы доходят до сервера и получают отказ.
  for (const reason of ["", "   "]) {
    await form.getByRole("textbox", { name: "Причина", exact: true }).fill(reason);
    await form.getByRole("button", { name: "Отозвать", exact: true }).click();
    await expect(form.getByRole("alert"), `отзыв с причиной «${reason}» отклонён`).toHaveText(
      "Нужна причина отзыва",
    );
  }

  await expect(confirmationRow(page, SKILL), "строка не ушла из списка").toBeVisible();
  expect(confirmations(testInfo, E5.login), "строка в базе не изменилась").toEqual(before);
});
