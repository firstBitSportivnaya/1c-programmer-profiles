import type { Page } from "@playwright/test";
import { expect, login, test } from "./fixtures";

test.describe.configure({ mode: "serial" });

// Файл работает от админа: сессия одна на воркер (см. e2e/fixtures.ts).
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
const A_GOAL = `Цель A ${STAMP}`;
const A_SECOND = `Цель A2 ${STAMP}`;
const C_GOAL = `Цель C ${STAMP}`;
const D_FIRST = `Цель D1 ${STAMP}`;
const D_SECOND = `Цель D2 ${STAMP}`;
const F_GOAL = `Цель F ${STAMP}`;
let aPlanPath = "";
let cPlanPath = "";
let cCompetencyPath = "";
let dPlanPath = "";
let aGoalCompetency = "";
let aGoalCompetencyId = "";
let aOtherCompetency = "";

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

async function acceptItem(page: Page, name: string) {
  const row = page.getByRole("row", { name: new RegExp(name) });
  await row.getByRole("button", { name: "Подтвердить" }).click();
  await expect(row.getByText("принято", { exact: true })).toBeVisible();
}

/** Страница достижений: заголовок и пояснение на месте и при пустом списке. */
async function openAchievements(page: Page) {
  await page.goto("/me/achievements");
  await expect(page.getByRole("heading", { level: 1, name: "Достижения" })).toBeVisible();
  await expect(page.getByText("очков нет", { exact: false })).toBeVisible();
}

/** На `/me` и в дереве навыков списка нет: только ссылка на страницу достижений, ни одной строки ачивки. */
async function expectOnlyLink(page: Page) {
  // В кабинете у действия есть счётчик «Достижения (N)», в дереве навыков — просто «Достижения».
  await expect(page.getByRole("link", { name: /^Достижения/ })).toBeVisible();
  await expect(page.getByText("Первая принятая строка", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Компетенция подтверждена", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Все компетенции пула подтверждены", { exact: true })).toHaveCount(0);
  await expect(page.getByText("ИПР выполнен", { exact: true })).toHaveCount(0);
}

type GlyphColor = {
  /** Вычисленный `stroke` пиктограммы: `currentColor` уже развёрнут браузером. */
  stroke: string;
  /** `color` самой строки — от него пиктограмма наследует штрих. */
  rowColor: string;
  /** Контраст штриха к фону строки. */
  iconRatio: number;
  /** Контраст названия к тому же фону: штрих не должен читаться хуже текста. */
  titleRatio: number;
};

/** Цвета пиктограмм и контраст штриха: фон строки собирается из полупрозрачных предков. */
async function glyphColors(page: Page): Promise<GlyphColor[]> {
  return page.evaluate(() => {
    type Rgba = [number, number, number, number];
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

    function parse(value: string): Rgba {
      const rgb = value.match(/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/);
      if (rgb) return [+rgb[1], +rgb[2], +rgb[3], rgb[4] === undefined ? 1 : +rgb[4]];
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = value;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    }

    function over(top: Rgba, bottom: Rgba): Rgba {
      const a = top[3];
      return [top[0] * a + bottom[0] * (1 - a), top[1] * a + bottom[1] * (1 - a), top[2] * a + bottom[2] * (1 - a), 1];
    }

    function luminance([r, g, b]: Rgba) {
      const [lr, lg, lb] = [r, g, b].map((c) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
    }

    function ratio(x: Rgba, y: Rgba) {
      const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
      return (hi + 0.05) / (lo + 0.05);
    }

    function background(element: Element): Rgba {
      const chain: Element[] = [];
      for (let node: Element | null = element; node && node !== document.body; node = node.parentElement) {
        chain.unshift(node);
      }
      const pageBg = parse(getComputedStyle(document.body).backgroundColor);
      return chain.reduce((acc, node) => over(parse(getComputedStyle(node).backgroundColor), acc), pageBg);
    }

    return [...document.querySelectorAll<HTMLElement>('[data-testid="achievements-list"] > li')].map((row) => {
      const svg = row.querySelector("svg")!;
      const title = row.querySelector(".achievement-row__main > :not(svg)")!;
      const bg = background(row);
      const stroke = getComputedStyle(svg).stroke;
      return {
        stroke,
        rowColor: getComputedStyle(row).color,
        iconRatio: ratio(over(parse(stroke), bg), bg),
        titleRatio: ratio(over(parse(getComputedStyle(title).color), bg), bg),
      };
    });
  });
}

test("принятая строка даёт ачивки первой строки и компетенции — только на странице достижений", async ({ page }) => {
  await createStaff(page, A, "junior");
  aPlanPath = await createPlan(page, A, "programmer");

  await login(page, A);
  await openAchievements(page);
  await expect(page.getByTestId("achievements-empty")).toBeVisible();
  await expect(page.getByText("Первая принятая строка")).toHaveCount(0);

  // Строки плана заводит админ.
  await login(page);
  await page.goto(aPlanPath);
  await addItem(page, A_GOAL);

  const options = addItemForm(page).getByLabel(/^Компетенция/).locator("option");
  aGoalCompetencyId = (await options.nth(0).getAttribute("value")) ?? "";
  aGoalCompetency = (await options.nth(0).innerText()).replace(/\s·\sур\.\s\d+$/, "");
  aOtherCompetency = (await options.nth(1).innerText()).replace(/\s·\sур\.\s\d+$/, "");
  expect(aGoalCompetencyId, "id компетенции первой строки найден в форме").not.toBe("");
  await addItem(page, A_SECOND, 1);
  await acceptItem(page, A_GOAL);

  await login(page, A);
  await openAchievements(page);
  await expect(page.getByTestId("achievements-empty")).toHaveCount(0);
  await expect(page.getByText("Первая принятая строка", { exact: true })).toBeVisible();
  await expect(page.getByText("Компетенция подтверждена", { exact: true })).toBeVisible();
  await expect(page.getByText(aOtherCompetency, { exact: true })).toHaveCount(0);
  await expect(page.getByText("Все компетенции пула подтверждены", { exact: true })).toHaveCount(0);
  await expect(page.getByText("ИПР выполнен", { exact: true })).toHaveCount(0);

  // Первая строка ведёт к той самой принятой строке плана и прокручивает к ней страницу.
  const firstRow = page.getByRole("link", { name: "Первая принятая строка" });
  await expect(firstRow).toHaveAttribute("href", new RegExp(`^${aPlanPath}#item-\\d+$`));
  await firstRow.click();
  await expect(page).toHaveURL(new RegExp(`${aPlanPath}#item-\\d+$`));
  const anchor = page.locator(new URL(page.url()).hash);
  await expect(anchor).toBeVisible();
  await expect(anchor).toBeInViewport();

  // Компетенция ведёт в карточку той компетенции, чью строку приняли: сверяем и адрес, и заголовок с ней,
  // а не с текстом самой ачивки — иначе подмена компетенции «и в тексте, и в href» прошла бы незамеченной.
  await openAchievements(page);
  const competencyRow = page
    .getByTestId("achievements-list")
    .getByRole("listitem")
    .filter({ hasText: "Компетенция подтверждена" });
  await expect(competencyRow).toHaveCount(1);
  await expect(competencyRow).toContainText(aGoalCompetency);
  const competencyLink = competencyRow.getByRole("link", { name: /^Компетенция подтверждена/ });
  await expect(competencyLink).toHaveAttribute("href", `/competencies/${aGoalCompetencyId}`);
  // Пиктограмма декоративная: доступное имя ссылки прежнее, из названия и компетенции, без значка.
  await expect(competencyLink).toHaveAccessibleName(`Компетенция подтверждена: ${aGoalCompetency}`);
  await expect(competencyRow.locator("svg")).toHaveCount(1);
  await expect(competencyRow.locator("svg")).toHaveAttribute("aria-hidden", "true");
  await expect(page.getByTestId("achievements-list").locator('[role="img"]')).toHaveCount(0);
  await competencyLink.click();
  await expect(page.getByRole("heading", { level: 1, name: aGoalCompetency })).toBeVisible();

  // В кабинете и в дереве списка нет — только ссылка со счётчиком.
  await page.goto("/me");
  await expectOnlyLink(page);
  await expect(page.getByRole("link", { name: "Достижения (2)" })).toBeVisible();
  await page.goto("/me/skills");
  await expectOnlyLink(page);
});

test("снятая приёмка убирает ачивки: пустое состояние и ссылка в кабинете без счёта", async ({ page }) => {
  await page.goto(aPlanPath);
  const row = page.getByRole("row", { name: new RegExp(A_GOAL) });
  await row.getByRole("button", { name: "Снять подтверждение" }).click();
  await expect(row.getByText("принято", { exact: true })).toHaveCount(0);

  await login(page, A);
  const response = await page.goto("/me/achievements");
  expect(response?.status(), "страница достижений без ачивок отвечает 200").toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "Достижения" })).toBeVisible();
  await expect(page.getByTestId("achievements-empty")).toBeVisible();
  await expect(page.getByText("Первая принятая строка")).toHaveCount(0);
  await expect(page.getByText("Компетенция подтверждена")).toHaveCount(0);
  // Пустое состояние без пиктограмм: ни в списке, ни рядом с ним значка нет.
  await expect(page.getByRole("article").locator("svg")).toHaveCount(0);
  // Ссылки на пропавшую компетенцию не остаётся — битых адресов нет.
  await expect(page.locator('a[href^="/competencies/"]')).toHaveCount(0);

  await page.goto("/me");
  await expect(page.getByRole("link", { name: "Достижения (0)" })).toBeVisible();
  await expect(page.getByText("Первая принятая строка")).toHaveCount(0);
});

test("все четыре ачивки: каждая строка ведёт к своему плану или компетенции", async ({ page }) => {
  await createStaff(page, C, "lead");
  cPlanPath = await createPlan(page, C, "programmer");
  await addItem(page, C_GOAL);
  await acceptItem(page, C_GOAL);

  await login(page, C);
  await page.goto(cPlanPath);
  await expect(page.getByText("выполнен", { exact: true })).toBeVisible();

  await openAchievements(page);
  const list = page.getByTestId("achievements-list");
  for (const title of [
    "Первая принятая строка",
    "Компетенция подтверждена",
    "Все компетенции пула подтверждены",
    "ИПР выполнен",
  ]) {
    // У ссылки на компетенцию доступное имя включает название: «Компетенция подтверждена: <название>».
    await expect(list.getByRole("link", { name: new RegExp(`^${title}`) })).toBeVisible();
  }

  // У каждого типа свой декоративный глиф: ровно одна svg перед названием.
  const rowGlyphs = [
    ["Первая принятая строка", "flag"],
    ["Компетенция подтверждена", "award"],
    ["Все компетенции пула подтверждены", "checklist"],
    ["ИПР выполнен", "target"],
  ] as const;
  for (const [title, icon] of rowGlyphs) {
    const row = list.getByRole("listitem").filter({ hasText: title });
    await expect(row, `строка «${title}» одна`).toHaveCount(1);
    await expect(row.locator("svg"), `в строке «${title}» ровно одна пиктограмма`).toHaveCount(1);
    await expect(row.locator("svg")).toHaveAttribute("data-icon", icon);
    await expect(row.locator("svg")).toHaveAttribute("aria-hidden", "true");
    await expect(row.locator("svg")).toHaveAttribute("focusable", "false");
    const beforeTitle = await row.evaluate((li) => {
      const svg = li.querySelector("svg");
      const titleNode = li.querySelector(".achievement-row__main > :not(svg)");
      return !!svg && !!titleNode && Boolean(svg.compareDocumentPosition(titleNode) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(beforeTitle, `в строке «${title}» пиктограмма стоит перед названием`).toBe(true);
  }
  // Пиктограмма не объявляется картинкой и не попадает в доступное имя ссылки.
  await expect(list.locator('[role="img"]')).toHaveCount(0);
  await expect(list.getByRole("link", { name: /^Компетенция подтверждена: .+/ })).toHaveCount(1);

  await expect(list.getByRole("link", { name: "Первая принятая строка" })).toHaveAttribute(
    "href",
    new RegExp(`^${cPlanPath}#item-\\d+$`),
  );
  await expect(list.getByRole("link", { name: "Все компетенции пула подтверждены" })).toHaveAttribute(
    "href",
    cPlanPath,
  );
  await expect(list.getByRole("link", { name: "ИПР выполнен" })).toHaveAttribute("href", cPlanPath);

  // Тёмная и светлая темы: штрих наследует цвет текста строки и читается не хуже текста.
  for (const theme of ["dark", "light"] as const) {
    if (theme === "light") {
      await page.addInitScript((value) => localStorage.setItem("pp-theme", value), theme);
      await page.reload();
      await expect(page.getByTestId("achievements-list")).toBeVisible();
    }
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const colors = await glyphColors(page);
    expect(colors, `в теме ${theme} у четырёх ачивок есть пиктограммы`).toHaveLength(4);
    for (const color of colors) {
      expect(color.stroke, `в теме ${theme} пиктограмма рисуется цветом текста строки`).toBe(color.rowColor);
      expect(color.iconRatio, `в теме ${theme} контраст штриха ниже 4.5:1`).toBeGreaterThanOrEqual(4.5);
      expect(color.iconRatio, `в теме ${theme} контраст штриха ниже контраста текста`).toBeGreaterThanOrEqual(
        color.titleRatio,
      );
    }
  }

  const competencyLink = list.getByRole("link", { name: /^Компетенция подтверждена/ });
  cCompetencyPath = (await competencyLink.getAttribute("href")) ?? "";
  expect(cCompetencyPath, "компетенция ведёт в свою карточку").toMatch(/^\/competencies\//);
  await competencyLink.click();
  await expect(page).toHaveURL(new RegExp(`${cCompetencyPath}$`));
  await expect(page.getByRole("heading", { level: 2, name: "Материалы" })).toBeVisible();

  await openAchievements(page);
  await list.getByRole("link", { name: "Все компетенции пула подтверждены" }).click();
  await expect(page).toHaveURL(new RegExp(`${cPlanPath}$`));
  await expect(page.getByRole("heading", { level: 1, name: /^ИПР:/ })).toBeVisible();
});

test("приёмки отменённого плана в ачивках не видны", async ({ page }) => {
  await createStaff(page, D, "junior");
  dPlanPath = await createPlan(page, D, "programmer");
  await addItem(page, D_FIRST);
  await addItem(page, D_SECOND);
  await acceptItem(page, D_FIRST);

  await login(page, D);
  await openAchievements(page);
  await expect(page.getByRole("link", { name: "Первая принятая строка" })).toBeVisible();

  // Отменяет план админ.
  await login(page);
  await page.goto(dPlanPath);
  await page.getByRole("button", { name: "Отменить" }).click();
  await expect(page.getByText("отменён", { exact: true })).toBeVisible();

  await login(page, D);
  await openAchievements(page);
  await expect(page.getByTestId("achievements-empty")).toBeVisible();
  await expect(page.getByText("Первая принятая строка")).toHaveCount(0);
});

test("страница только своя: чужой сотрудник и его id в адресе ачивок не дают", async ({ page }) => {
  await createStaff(page, B, "junior");

  // Ачивки есть у C. Его id берём из каталога, пока в контексте админ: сотруднику чужие карточки не ссылками.
  await page.goto("/people");
  const cHref = await page.getByRole("link", { name: C.name, exact: true }).getAttribute("href");
  const cEmployeeId = cHref?.split("/").pop() ?? "";
  expect(cEmployeeId, "id сотрудника C не найден в каталоге").not.toBe("");

  await login(page, B);
  await openAchievements(page);
  await expect(page.getByTestId("achievements-empty")).toBeVisible();
  await expect(page.getByText("Все компетенции пула подтверждены")).toHaveCount(0);

  // Чужой id в строке запроса страницу не переключает: она всегда своя.
  await page.goto(`/me/achievements?employeeId=${encodeURIComponent(cEmployeeId)}`);
  await expect(page.getByTestId("achievements-empty")).toBeVisible();
  await expect(page.getByText("Первая принятая строка")).toHaveCount(0);
});

test("план без компетенций в пуле ачивку пула не даёт", async ({ page }) => {
  await createStaff(page, E, "senior");
  // Профиль senior полностью покрывает профиль programmer: разрыв пуст, строк пула не появляется.
  await createPlan(page, E, "programmer", { emptyPool: true });

  await login(page, E);
  await openAchievements(page);
  await expect(page.getByTestId("achievements-empty")).toBeVisible();
  await expect(page.getByText("Все компетенции пула подтверждены")).toHaveCount(0);

  await page.goto("/me");
  await expect(page.getByRole("link", { name: "Достижения (0)" })).toBeVisible();
});

test("приёмка в первом плане видна, когда появился второй план", async ({ page }) => {
  await createStaff(page, F, "junior");
  await createPlan(page, F, "programmer");
  await addItem(page, F_GOAL);
  await acceptItem(page, F_GOAL);
  await expect(page.getByText("выполнен", { exact: true })).toBeVisible();

  await createPlan(page, F, "programmer", { rowText: "активен" });

  await login(page, F);
  await openAchievements(page);
  await expect(page.getByRole("link", { name: "Первая принятая строка" })).toBeVisible();

  await page.goto("/me");
  await expectOnlyLink(page);
  await expect(page.getByRole("link", { name: /^Достижения \(\d+\)$/ })).toBeVisible();
});

test.describe("гость", () => {
  // Гостевые проверки идут без cookie админа (см. e2e/fixtures.ts).
  test.use({ asAdmin: false });

  test("достижения и их цели закрыты для гостя", async ({ page }) => {
    await page.goto("/me/achievements");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Достижения" })).toHaveCount(0);
    // Ни названий ачивок, ни пиктограмм: страница закрыта целиком.
    await expect(page.getByText("Первая принятая строка")).toHaveCount(0);
    await expect(page.locator("[data-icon]")).toHaveCount(0);

    // Цели кросс-ссылок тоже закрыты: содержимое плана и карточки компетенции не показывается.
    await page.goto(cCompetencyPath);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { level: 2, name: "Материалы" })).toHaveCount(0);

    await page.goto(cPlanPath);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { level: 1, name: /^ИПР:/ })).toHaveCount(0);
  });
});
