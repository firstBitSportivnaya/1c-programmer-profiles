import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page, type Request } from "@playwright/test";
import { E2E_ADMIN, E2E_ADMIN_PASSWORD } from "./env";

// Файл идёт после session.spec.ts (алфавит, один воркер): первый админ там уже создан.
test.describe.configure({ mode: "serial" });

const STAMP = Date.now();
const STUDENT = {
  login: `e2e.tree.${STAMP}`,
  name: `Дерево ${STAMP}`,
  password: "e2e-tree-password",
};
const OUTSIDE = {
  login: `e2e.tree.out.${STAMP}`,
  name: `Дерево вне ${STAMP}`,
  password: "e2e-tree-password",
};
const ALONE = {
  login: `e2e.tree.alone.${STAMP}`,
  name: `Дерево без плана ${STAMP}`,
  password: "e2e-tree-password",
};
const EMPTY = {
  login: `e2e.tree.empty.${STAMP}`,
  name: `Дерево без профиля ${STAMP}`,
  password: "e2e-tree-password",
};

const PROGRAMMING = {
  id: "comp-navyki-programmirovaniya-na-yazyke-1s",
  name: "Навыки программирования на языке 1С",
};
const TESTING = {
  id: "comp-avtomatizirovannoe-testirovanie",
  name: "Автоматизированное тестирование",
};
const REST = "comp-rest-odata-http-servisy";
const OBUCHAEMOST = "comp-obuchaemost";

const GOAL_ITEM = `Дерево: программирование ${STAMP}`;
const TESTING_ITEM = `Дерево: тесты ${STAMP}`;
const MATERIAL = `Материал дерева ${STAMP}`;
const MATERIAL_URL = "https://example.org/tree-material";
const NOTE = `Дерево: личная заметка ${STAMP}`;

let studentPlanPath = "";
let outsidePlanPath = "";

/** Вход учёткой; на первом прогоне сначала создаёт админа и переключается на нужного сотрудника. */
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
      await login(page, account);
      return;
    }
  } else {
    const form = page.locator('form:has(input[name="intent"][value="login"])');
    await form.getByLabel("Логин").fill(account.login);
    await form.getByLabel("Пароль", { exact: true }).fill(account.password);
    await form.getByRole("button", { name: "Войти" }).click();
  }
  await expect(page).toHaveURL(/\/me$/);
}

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

/** Создаёт ИПР сотруднику и открывает карточку плана; возвращает путь. */
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

function addItemForm(page: Page) {
  return page.locator("form", { has: page.getByRole("heading", { name: "Добавить задание" }) });
}

async function addItem(page: Page, competencyId: string, name: string) {
  const form = addItemForm(page);
  await form.getByLabel(/^Компетенция/).selectOption(competencyId);
  await form.getByLabel(/^Название/).fill(name);
  await form.getByLabel(/^Узнать/).fill(`Узнать ${name}`);
  await form.getByLabel(/^Проверить/).fill(`Проверить ${name}`);
  await form.getByRole("button", { name: "Добавить" }).click();
  await expect(page.getByRole("row", { name: new RegExp(name) })).toBeVisible();
}

/**
 * Клиентский компонент после серверного ответа гидрируется не мгновенно:
 * select, выбранный до этого, не отправляет onChange и теряет запись.
 */
async function waitHydrated(locator: Locator) {
  await locator.evaluate(
    (element) =>
      new Promise<void>((resolve) => {
        const ready = () => Object.keys(element).some((key) => key.startsWith("__reactFiber$"));
        if (ready()) {
          resolve();
          return;
        }
        const timer = window.setInterval(() => {
          if (!ready()) return;
          window.clearInterval(timer);
          resolve();
        }, 25);
        window.setTimeout(() => {
          window.clearInterval(timer);
          resolve();
        }, 5000);
      }),
  );
}

/** Ждёт POST, который форма или селект отправляют без кнопки. */
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

async function acceptItem(page: Page, name: string) {
  const row = page.getByRole("row", { name: new RegExp(name) });
  await savePost(page, () => row.getByRole("button", { name: "Подтвердить" }).click());
  await expect(row.getByText("принято", { exact: true })).toBeVisible();
}

function skillNode(page: Page, competencyId: string) {
  return page.getByTestId(`skill-node-${competencyId}`);
}

/** Все рёбра холста — только предпосылки: от родителя на слой выше к навыку на слой ниже. */
async function expectPrerequisiteLayers(page: Page) {
  const graph = await page.evaluate(() => {
    const depth = new Map<string, number>();
    for (const element of document.querySelectorAll<HTMLElement>('[data-testid^="skill-node-"]')) {
      const id = element.dataset.testid?.slice("skill-node-".length) ?? "";
      depth.set(id, Number(element.dataset.depth));
    }
    const edges = [...document.querySelectorAll(".react-flow__edge")].map((element) => element.getAttribute("data-id") ?? "");
    return { edges, depths: [...depth.entries()] as [string, number][] };
  });
  const depths = new Map(graph.depths);
  expect(graph.edges.length).toBeGreaterThan(0);
  for (const id of graph.edges) {
    const [kind, parent, child] = id.split(":");
    expect(kind, id).toBe("prereq");
    expect(depths.get(parent), id).toBe((depths.get(child) ?? Number.NaN) - 1);
  }
}

/** Линия ребра не идёт по чужой карточке: между слоями есть пустая полоса. */
async function expectEdgesClearOfNodes(page: Page) {
  const hits = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll<HTMLElement>(".react-flow__node-skill")].map((element) => ({
      id: element.getAttribute("data-id") ?? "",
      box: element.getBoundingClientRect(),
    }));
    const found = new Set<string>();
    for (const edge of document.querySelectorAll<SVGGElement>(".react-flow__edge")) {
      const id = edge.getAttribute("data-id") ?? "";
      const [, parent, child] = id.split(":");
      const path = edge.querySelector("path");
      if (!path) continue;
      const line = path.getBoundingClientRect();
      if (line.width < 1 && line.height < 1) continue;
      for (const node of boxes) {
        if (node.id === `skill:${parent}` || node.id === `skill:${child}`) continue;
        const pad = 2;
        const hit =
          line.left < node.box.right - pad &&
          line.right > node.box.left + pad &&
          line.top < node.box.bottom - pad &&
          line.bottom > node.box.top + pad;
        if (hit) found.add(`${id} через ${node.id}`);
      }
    }
    return [...found];
  });
  expect(hits).toEqual([]);
}

/** Навыки справочника без обязанностей и групп разделов: столько узлов в полном дереве. */
const SKILL_COUNT = (
  JSON.parse(readFileSync("seed/data.json", "utf8")) as {
    competencies: { parentId: string | null; type: string }[];
  }
).competencies.filter((row) => row.parentId !== null && row.type !== "duty").length;

test("админ заводит сотрудников, ИПР, строки плана и материал", async ({ page }) => {
  await login(page);
  await createStaff(page, STUDENT, "junior");
  studentPlanPath = await createPlan(page, STUDENT, "programmer");
  await addItem(page, PROGRAMMING.id, GOAL_ITEM);
  await addItem(page, TESTING.id, TESTING_ITEM);

  const testingRow = page.getByRole("row", { name: new RegExp(TESTING_ITEM) });
  await waitHydrated(testingRow.getByLabel("Статус"));
  await savePost(page, () => testingRow.getByLabel("Статус").selectOption("in_progress"));
  await expect(testingRow.getByLabel("Статус")).toHaveValue("in_progress");

  await createStaff(page, OUTSIDE, "junior");
  outsidePlanPath = await createPlan(page, OUTSIDE, "programmer");

  await createStaff(page, ALONE, "junior");
  await createStaff(page, EMPTY, "consultant");

  await page.goto("/admin/competencies");
  await page.getByRole("link", { name: PROGRAMMING.name, exact: true }).click();
  const materials = page.getByRole("group", { name: `Материалы: ${PROGRAMMING.name}` });
  await materials.getByLabel(/^Вид/).selectOption("its");
  await materials.getByLabel("Название ссылки").fill(MATERIAL);
  await materials.getByLabel("Адрес").fill(MATERIAL_URL);
  await materials.getByRole("button", { name: "Добавить ссылку" }).click();
  await expect(materials.getByRole("link", { name: MATERIAL })).toHaveAttribute("href", MATERIAL_URL);
});

test("дерево слоями: предпосылки, планки и один узел на компетенцию, обязанностей нет", async ({ page }) => {
  await login(page, STUDENT);
  await page.goto("/me");
  await page.getByRole("link", { name: "Дерево навыков" }).click();
  await expect(page).toHaveURL(/\/me\/skills$/);
  await expect(page.getByRole("heading", { level: 1, name: "Дерево навыков" })).toBeVisible();

  const jobs = page.locator(".skill-tree-jobs");
  await expect(jobs).toContainText("Сейчас:");
  await expect(jobs.getByRole("link", { name: "Младший программист", exact: true })).toBeVisible();
  await expect(jobs).toContainText("Цель ИПР:");
  await expect(jobs.getByRole("link", { name: "Программист", exact: true })).toBeVisible();

  const programming = skillNode(page, PROGRAMMING.id);
  await expect(programming).toHaveAttribute("data-relation", "both");
  await expect(programming).toContainText("планка 1 → 2");
  await expect(skillNode(page, TESTING.id)).toHaveAttribute("data-relation", "target");
  await expect(skillNode(page, TESTING.id)).toContainText("планка цели 1");
  await expect(skillNode(page, OBUCHAEMOST)).toHaveAttribute("data-relation", "both");
  await expect(skillNode(page, OBUCHAEMOST)).toContainText("планка 2");
  await expect(skillNode(page, OBUCHAEMOST)).toHaveCount(1);

  // Предпосылка «высокоуровневый язык → программирование на 1С»: ребро между соседними слоями.
  await expect(page.locator('[data-id="prereq:comp-vysokourovnevyi-yazyk-programmirovaniya:comp-navyki-programmirovaniya-na-yazyke-1s"]')).toHaveCount(1);
  await expectPrerequisiteLayers(page);
  await expectEdgesClearOfNodes(page);
  await expect(page.locator(".skill-job-card")).toHaveCount(0);

  await expect(page.getByText("Алгоритмизация поставленных задач (A/01.3)")).toHaveCount(0);
  await expect(page.getByText("Написание программного кода на языке 1С по техническому заданию (A/02.3)")).toHaveCount(0);
});

test("заливка узла — пометка, панель показывает критерий, материал, пометку и строки плана", async ({ page }) => {
  await login(page, STUDENT);
  await page.goto("/me/marks");
  const testingStatus = page.getByLabel(`Статус: ${TESTING.name}`);
  const obuchaemostStatus = page.getByLabel("Статус: Обучаемость");
  await waitHydrated(testingStatus);
  await savePost(page, () => testingStatus.selectOption("in_progress"));
  await savePost(page, () => obuchaemostStatus.selectOption("has"));
  const note = page.getByLabel("Пояснение: Обучаемость");
  await waitHydrated(note);
  await savePost(page, async () => {
    await note.fill(NOTE);
    await note.blur();
  });

  await page.goto("/me/skills");
  await expect(skillNode(page, TESTING.id)).toHaveAttribute("data-mark", "in_progress");
  await expect(skillNode(page, OBUCHAEMOST)).toHaveAttribute("data-mark", "has");

  await skillNode(page, TESTING.id).click();
  const panel = page.getByTestId("skill-node-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("skill-panel-criteria")).toContainText("Пишет модульные тесты на YAxUnit");
  await expect(panel.getByTestId("skill-panel-mark")).toHaveText("в процессе");
  await expect(panel.getByRole("link", { name: "Изменить пометку" })).toHaveAttribute("href", "/me/marks");
  await expect(panel.getByTestId("skill-panel-rows")).toContainText(TESTING_ITEM);
  await expect(panel.getByRole("link", { name: TESTING_ITEM })).toHaveAttribute(
    "href",
    new RegExp(`^/idps/.+#item-\\d+$`),
  );

  await skillNode(page, PROGRAMMING.id).click();
  await expect(panel.getByTestId("skill-panel-level")).toHaveText("планка 1 → 2");
  await expect(panel.getByTestId("skill-panel-criteria")).toContainText(
    "Структурный подход к решению задач, отладке и исправлению ошибок",
  );
  await expect(panel.getByRole("link", { name: MATERIAL })).toHaveAttribute("href", MATERIAL_URL);
  await expect(panel.getByTestId("skill-panel-rows")).toContainText(GOAL_ITEM);

  await expect(page.getByTestId(`skill-plan-${TESTING.id}`)).toContainText("в работе");
  await expect(skillNode(page, TESTING.id)).toHaveAttribute("data-plan-state", "in_progress");
  await expect(skillNode(page, PROGRAMMING.id)).toHaveAttribute("data-plan-state", "not_started");
  await expect(skillNode(page, REST)).toHaveAttribute("data-plan-state", "none");
});

test("приёмка подтверждает узел и его шаг плана, снятие убирает значок и ачивку", async ({ page }) => {
  await login(page);
  await page.goto(studentPlanPath);
  await acceptItem(page, GOAL_ITEM);

  await login(page, STUDENT);
  await page.goto("/me/skills");
  await expect(skillNode(page, PROGRAMMING.id)).toHaveAttribute("data-confirmed", "true");
  await expect(page.getByTestId(`skill-badge-${PROGRAMMING.id}`)).toBeVisible();
  await expect(skillNode(page, PROGRAMMING.id)).toHaveAttribute("data-plan-state", "done");
  await expect(page.getByTestId(`skill-plan-${PROGRAMMING.id}`)).toContainText("принято");
  await expect(page.getByRole("heading", { name: "Достижения" })).toBeVisible();
  await expect(page.getByText("Компетенция подтверждена")).toBeVisible();
  await expect(page.getByTestId(`skill-badge-${TESTING.id}`)).toHaveCount(0);
  await expect(skillNode(page, TESTING.id)).toHaveAttribute("data-plan-state", "in_progress");

  await login(page);
  await page.goto(studentPlanPath);
  const row = page.getByRole("row", { name: new RegExp(GOAL_ITEM) });
  await savePost(page, () => row.getByRole("button", { name: "Снять подтверждение" }).click());
  await expect(row.getByText("принято", { exact: true })).toHaveCount(0);

  await login(page, STUDENT);
  await page.goto("/me/skills");
  await expect(skillNode(page, PROGRAMMING.id)).toHaveAttribute("data-confirmed", "false");
  await expect(page.getByTestId(`skill-badge-${PROGRAMMING.id}`)).toHaveCount(0);
  await expect(skillNode(page, PROGRAMMING.id)).not.toHaveAttribute("data-plan-state", "done");
  await expect(page.getByTestId(`skill-plan-${PROGRAMMING.id}`)).not.toContainText("принято");
  await expect(page.getByRole("heading", { name: "Достижения" })).toHaveCount(0);
});

test("без профиля — пустое состояние, без плана — только текущая должность и приглашение", async ({ page }) => {
  await login(page, EMPTY);
  await page.goto("/me/skills");
  const noProfile = page.getByTestId("skill-tree-no-profile");
  await expect(noProfile).toContainText("У должности нет профиля с навыками");
  await expect(noProfile.getByRole("link", { name: "Мои компетенции" })).toHaveAttribute("href", "/me/marks");
  await expect(page.locator(".skill-tree-shell")).toHaveCount(0);

  await login(page, ALONE);
  await page.goto("/me/skills");
  await expect(page.locator(".skill-tree-jobs")).toContainText("Сейчас:");
  await expect(page.locator(".skill-tree-jobs")).toContainText("активного ИПР нет");
  await expect(page.getByTestId("skill-tree-no-plan")).toContainText("Активного ИПР нет");
  await expect(page.getByTestId("skill-tree-no-plan").getByRole("link", { name: "ИПР" })).toHaveAttribute(
    "href",
    "/idps",
  );
  await expect(skillNode(page, PROGRAMMING.id)).toBeVisible();
  await expectPrerequisiteLayers(page);
  // Дерево есть всегда: без плана на узлах нет шагов, но предпосылки остаются.
  await expect(page.locator('[data-plan-state]:not([data-plan-state="none"])')).toHaveCount(0);
});

test("пометка вне профиля остаётся в дереве, отменённый план не считается", async ({ page }) => {
  await login(page, OUTSIDE);
  await page.goto("/me/marks");
  const outsideStatus = page.getByLabel(`Статус: ${TESTING.name}`);
  await waitHydrated(outsideStatus);
  await savePost(page, () => outsideStatus.selectOption("in_progress"));

  await login(page);
  await page.goto(outsidePlanPath);
  await page.getByRole("button", { name: "Отменить" }).click();
  await expect(page.getByText("отменён", { exact: true })).toBeVisible();

  await login(page, OUTSIDE);
  await page.goto("/me/skills");
  await expect(page.getByTestId("skill-tree-no-plan")).toBeVisible();
  await expect(page.locator(".skill-tree-jobs")).toContainText("активного ИПР нет");
  const outsideNode = skillNode(page, TESTING.id);
  await expect(outsideNode).toHaveAttribute("data-relation", "none");
  await expect(outsideNode).toHaveAttribute("data-mark", "in_progress");
  await expect(page.getByTestId(`skill-badge-${TESTING.id}`)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Достижения" })).toHaveCount(0);
  await expect(page.locator('[data-plan-state]:not([data-plan-state="none"])')).toHaveCount(0);
});

test("отбор «Мои» убирает чужие ветви, переключатель открывает всё дерево", async ({ page }) => {
  await login(page, STUDENT);
  await page.goto("/me/skills");
  const nodes = page.locator('[data-testid^="skill-node-"]');
  await expect(nodes.first()).toBeVisible();
  const filtered = await nodes.count();
  expect(filtered).toBeLessThan(SKILL_COUNT);

  await page.getByLabel("Показывать всё дерево").check();
  await expect(nodes).toHaveCount(SKILL_COUNT);
  await expectPrerequisiteLayers(page);

  const ids = await nodes.evaluateAll((list) => list.map((element) => element.getAttribute("data-testid")));
  expect(new Set(ids).size).toBe(ids.length);
});

test("гость уходит на вход, чужой сотрудник дерево и пометки не видит", async ({ page }) => {
  await login(page);
  await page.goto("/people");
  const studentHref = await page.getByRole("link", { name: STUDENT.name, exact: true }).getAttribute("href");
  expect(studentHref).toBeTruthy();
  await page.goto(studentHref!);
  await expect(page.getByRole("heading", { level: 1, name: STUDENT.name })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Дерево навыков" })).toHaveCount(0);
  await expect(page.getByText("Мои компетенции")).toHaveCount(0);

  await page.goto("/me/skills");
  await expect(page.locator(".skill-tree-jobs")).toContainText("Сейчас:");
  await expect(page.getByText(NOTE)).toHaveCount(0);

  await page.getByRole("button", { name: "Выйти" }).click();
  await page.goto("/me/skills");
  await expect(page).toHaveURL(/\/login$/);
});
