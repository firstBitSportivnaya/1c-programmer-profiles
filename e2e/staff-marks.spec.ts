import { expect, test, type Page, type Request } from "@playwright/test";
import { E2E_ADMIN } from "./env";

// Файл идёт после session.spec.ts (алфавит, один воркер): админ там уже создан.
// Шаги делят базу: админ заводит сотрудника и ИПР, дальше входит сотрудник.
test.describe.configure({ mode: "serial" });

const JUNIOR = { login: "e2e.junior", name: "Младший E2E", password: "e2e-junior-password" };
const OUTSIDE_ID = "comp-arhitektura-resheniya-granicy-sistem-i-konturov";
const JUNIOR_CRITERIA = "Осваивает незнакомый механизм платформы по ИТС и документации";
const TARGET_CRITERIA = "Пишет модульные тесты на YAxUnit";

async function login(page: Page, account: { login: string; password: string }) {
  await page.goto("/login");
  const form = page.locator('form:has(input[name="intent"][value="login"])');
  await form.getByLabel("Логин").fill(account.login);
  await form.getByLabel("Пароль", { exact: true }).fill(account.password);
  await form.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/me$/);
}

function markRow(page: Page, competency: string) {
  return page.locator("li", { has: page.getByLabel(`Статус: ${competency}`) });
}

async function fillNote(note: ReturnType<Page["getByLabel"]>, value: string) {
  await note.fill(value);
  await note.evaluate((element: HTMLTextAreaElement) => {
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await note.blur();
}

async function saveMark(page: Page, run: () => Promise<unknown>) {
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

test("админ заводит сотрудника на младшего программиста и ИПР на программиста", async ({ page }) => {
  await login(page, E2E_ADMIN);

  await page.goto("/people");
  const form = page.locator("form", { has: page.getByRole("heading", { name: "Новый сотрудник" }) });
  await form.getByLabel("Логин").fill(JUNIOR.login);
  await form.getByLabel("Имя").fill(JUNIOR.name);
  await form.getByLabel("Пароль").fill(JUNIOR.password);
  await form.getByLabel(/^Должность/).selectOption("junior");
  await form.getByLabel(/^Руководитель/).selectOption({ label: E2E_ADMIN.name });
  await form.getByRole("button", { name: "Создать" }).click();
  await expect(page.getByRole("link", { name: JUNIOR.name, exact: true })).toBeVisible();

  await page.goto("/idps");
  await page.getByLabel(/^Сотрудник/).selectOption({ label: JUNIOR.name });
  await page.getByLabel(/^Цель/).selectOption("programmer");
  await page.getByLabel("Начало").fill("2026-01-01");
  await page.getByLabel("Конец").fill("2026-12-31");
  await page.getByRole("button", { name: "Создать" }).click();
  await expect(page.getByText(`${JUNIOR.name} · создал ${E2E_ADMIN.name}`)).toBeVisible();
});

test("в кабинете сводка текущего набора, списки на отдельной странице", async ({ page }) => {
  await login(page, JUNIOR);

  await expect(page.getByRole("heading", { level: 2, name: "Мои пометки по компетенциям" })).toBeVisible();
  await expect(page.getByTestId("marks-has")).toHaveText("0");
  await expect(page.getByTestId("marks-lacks")).toHaveText("0");
  await expect(page.getByTestId("marks-progress")).toHaveText("0");
  await expect(page.getByLabel(/^Статус:/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ок" })).toHaveCount(0);
  await page.getByRole("link", { name: "Открыть пометки" }).click();
  await expect(page).toHaveURL(/\/me\/marks$/);
  await expect(page.getByRole("heading", { level: 1, name: "Мои пометки по компетенциям" })).toBeVisible();

  const learn = markRow(page, "Обучаемость");
  await expect(learn.getByText("цель ИПР")).toHaveCount(0);
  await expect(learn).toContainText(JUNIOR_CRITERIA);
  await expect(learn).not.toContainText("Самостоятельно разбирается в незнакомой подсистеме");
  const testing = markRow(page, "Автоматизированное тестирование");
  await expect(testing.getByText("цель ИПР")).toBeVisible();
  await expect(testing).toContainText(TARGET_CRITERIA);
  await expect(page.getByLabel("Статус: Алгоритмизация поставленных задач (A/01.3)")).toHaveCount(0);
  await expect(page.getByText("Архитектура решения: границы систем и контуров")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Вне текущего профиля" })).toHaveCount(0);
  for (const option of ["не отмечено", "есть", "нет", "в процессе"]) {
    await expect(page.getByLabel("Статус: Обучаемость").locator("option", { hasText: option })).toHaveCount(1);
  }
});

test("статус и пояснение пишутся без кнопки и не меняют должность и ИПР", async ({ page }) => {
  await login(page, JUNIOR);
  await page.goto("/me/marks");

  await saveMark(page, () => page.getByLabel("Статус: Обучаемость").selectOption("has"));
  await expect(page.getByLabel("Статус: Обучаемость")).toHaveValue("has");
  await expect(page.getByLabel("Пояснение: Обучаемость")).toBeVisible();
  const note = page.getByLabel("Пояснение: Обучаемость");
  await saveMark(page, () => fillNote(note, "смотрю ИТС"));
  await saveMark(page, () => page.getByLabel("Статус: Автоматизированное тестирование").selectOption("in_progress"));
  await expect(page.getByLabel("Статус: Автоматизированное тестирование")).toHaveValue("in_progress");

  await page.reload();
  await expect(page.getByLabel("Статус: Обучаемость")).toHaveValue("has");
  await expect(page.getByLabel("Пояснение: Обучаемость")).toHaveValue("смотрю ИТС");
  await expect(page.getByLabel("Статус: Автоматизированное тестирование")).toHaveValue("in_progress");
  await expect(markRow(page, "Обучаемость")).toHaveClass(/mark-has/);
  await expect(markRow(page, "Автоматизированное тестирование")).toHaveClass(/mark-progress/);

  await page.goto("/me");
  await expect(page.getByTestId("marks-has")).toHaveText("1");
  await expect(page.getByTestId("marks-progress")).toHaveText("1");
  await expect(page.getByRole("link", { name: "Младший программист", exact: true })).toBeVisible();
  await expect(page.getByText("принято 0 из 0")).toBeVisible();
});

test("ошибка статуса, чужого навыка и длинного пояснения не меняет запись", async ({ page }) => {
  await login(page, JUNIOR);
  await page.goto("/me/marks");
  const row = markRow(page, "Обучаемость");

  await saveMark(page, () =>
    row.locator("select").evaluate((select: HTMLSelectElement) => {
      select.add(new Option("подделка", "bogus"));
      select.value = "bogus";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }),
  );
  await expect(row.getByRole("alert")).toHaveText("Статус: есть, нет или в процессе");
  await expect(page.getByLabel("Статус: Обучаемость")).toHaveValue("has");

  await row.locator('input[name="competencyId"]').evaluate((input: HTMLInputElement) => {
    input.value = "no-such-competency";
  });
  await saveMark(page, () => page.getByLabel("Статус: Обучаемость").selectOption("lacks"));
  await expect(row.getByRole("alert")).toHaveText("Отметить можно только навык своей должности или цели ИПР");
  await expect(page.getByLabel("Статус: Обучаемость")).toHaveValue("has");

  await row.locator('input[name="competencyId"]').evaluate((input: HTMLInputElement, id: string) => {
    input.value = id;
  }, OUTSIDE_ID);
  await saveMark(page, () => page.getByLabel("Статус: Обучаемость").selectOption("lacks"));
  await expect(row.getByRole("alert")).toHaveText("Отметить можно только навык своей должности или цели ИПР");

  await page.reload();
  const fresh = markRow(page, "Обучаемость");
  const long = "я".repeat(1001);
  const note = page.getByLabel("Пояснение: Обучаемость");
  await saveMark(page, () => fillNote(note, long));
  await expect(fresh.getByRole("alert")).toHaveText("Пояснение: не длиннее 1000 символов");
  await expect(note).toHaveValue(long);

  await page.reload();
  await expect(page.getByLabel("Статус: Обучаемость")).toHaveValue("has");
  await expect(page.getByLabel("Пояснение: Обучаемость")).toHaveValue("смотрю ИТС");
  await expect(page.getByText("Архитектура решения: границы систем и контуров")).toHaveCount(0);
});

test("фильтр, поиск и чип цели сужают список", async ({ page }) => {
  await login(page, JUNIOR);
  await page.goto("/me/marks");

  await page.getByLabel("Поиск навыка").fill("Обуча");
  await expect(page.getByLabel("Статус: Обучаемость")).toBeVisible();
  await expect(page.getByLabel("Статус: Автоматизированное тестирование")).toHaveCount(0);
  await page.getByLabel("Поиск навыка").fill("");

  await page.getByLabel("Фильтр статуса").selectOption("has");
  await expect(page.getByLabel("Статус: Обучаемость")).toBeVisible();
  await expect(page.getByLabel("Статус: Автоматизированное тестирование")).toHaveCount(0);
  await page.getByLabel("Фильтр статуса").selectOption("");

  await page.getByRole("button", { name: "только цель ИПР" }).click();
  await expect(page.getByLabel("Статус: Автоматизированное тестирование")).toBeVisible();
  await expect(page.getByLabel("Статус: Обучаемость")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Вне текущего профиля" })).toHaveCount(0);
});

test("пометка вне набора правится, снятие убирает её и не входит в сводку", async ({ page }) => {
  await login(page, JUNIOR);
  await expect(page.getByTestId("marks-has")).toHaveText("1");
  await expect(page.getByTestId("marks-progress")).toHaveText("1");

  await page.getByRole("button", { name: "Выйти" }).click();
  await login(page, E2E_ADMIN);
  await page.goto("/idps");
  await page
    .locator("li", { hasText: JUNIOR.name })
    .getByRole("link", { name: "Младший программист → Программист" })
    .click();
  await page.getByRole("button", { name: "Отменить" }).click();
  await expect(page.getByText("отменён", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Выйти" }).click();
  await login(page, JUNIOR);
  await expect(page.getByTestId("marks-has")).toHaveText("1");
  await expect(page.getByTestId("marks-progress")).toHaveText("0");
  await page.goto("/me/marks");

  await expect(page.getByRole("heading", { name: "Вне текущего профиля" })).toBeVisible();
  await expect(page.getByText("убирает навык, пока он снова не войдёт")).toBeVisible();
  const testing = markRow(page, "Автоматизированное тестирование");
  await expect(testing.getByText("цель ИПР")).toHaveCount(0);
  await expect(testing).not.toContainText(TARGET_CRITERIA);
  await saveMark(page, () => page.getByLabel("Статус: Автоматизированное тестирование").selectOption("lacks"));
  const note = page.getByLabel("Пояснение: Автоматизированное тестирование");
  await saveMark(page, () => fillNote(note, "было в цели"));
  await page.reload();
  await expect(page.getByLabel("Статус: Автоматизированное тестирование")).toHaveValue("lacks");
  await expect(page.getByLabel("Пояснение: Автоматизированное тестирование")).toHaveValue("было в цели");

  await saveMark(page, () => page.getByLabel("Статус: Автоматизированное тестирование").selectOption(""));
  await expect(page.getByLabel("Статус: Автоматизированное тестирование")).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel("Статус: Автоматизированное тестирование")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Вне текущего профиля" })).toHaveCount(0);

  await page.goto("/me");
  await expect(page.getByTestId("marks-has")).toHaveText("1");
  await expect(page.getByTestId("marks-progress")).toHaveText("0");
});

test("руководитель-админ и гость пометок сотрудника не видят", async ({ page }) => {
  await login(page, E2E_ADMIN);
  await page.goto("/people");
  await page.getByRole("link", { name: JUNIOR.name, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: JUNIOR.name })).toBeVisible();
  await expect(page.getByText("Мои пометки по компетенциям")).toHaveCount(0);
  await expect(page.getByLabel(/^Статус:/)).toHaveCount(0);
  await expect(page.getByText("смотрю ИТС")).toHaveCount(0);

  await page.getByRole("button", { name: "Выйти" }).click();
  await page.goto("/jobs/junior/profile");
  await expect(page.getByLabel(/^Статус:/)).toHaveCount(0);
  await page.goto("/me/marks");
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/me");
  await expect(page).toHaveURL(/\/login$/);
});
