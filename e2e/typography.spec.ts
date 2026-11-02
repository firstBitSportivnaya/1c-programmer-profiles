import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * Единая типографика: шкала из трёх размеров (`--fs-sm`, `--fs-md`, `--fs-lg` в `src/app/globals.css`).
 * На экране не должно быть ни одного размера вне шкалы: иначе иерархия текста расползается,
 * а разницу между подписью и основным текстом перестаёт быть видно.
 *
 * Размеры считаются по видимому тексту: берём каждый текстовый узел, его родителя и вычисленный `font-size`.
 * Свёрнутое (`details`), скрытое (`visibility`, нулевой прямоугольник) и содержимое `script`/`style` не считаем.
 */
test.use({ asAdmin: true });

const PAGES = [
  ["/", "главная: схема и список должностей"],
  ["/jobs/junior/profile", "профиль должности"],
  ["/compare", "сравнение профилей"],
  ["/idps", "список ИПР"],
  ["/me/marks", "мои пометки"],
  ["/me/skills", "дерево навыков"],
] as const;

type Typography = {
  /** Вычисленные размеры видимого текста, по возрастанию. */
  sizes: string[];
  /** Первая гарнитура из `font-family` у видимого текста. */
  families: string[];
  /** Шкала в пикселях: значения `--fs-*` с корневого элемента. */
  scale: string[];
  /** Размеры вне шкалы: значение и место, где оно встретилось. */
  unexpected: string[];
  /** Сколько текстовых узлов попало в подсчёт: защита от «пустой» проверки. */
  measured: number;
};

async function typography(page: Page): Promise<Typography> {
  return page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const rootSize = Number.parseFloat(root.fontSize);
    const scale = ["--fs-sm", "--fs-md", "--fs-lg"].map((name) => {
      const value = root.getPropertyValue(name).trim();
      if (value.endsWith("rem")) return `${Number.parseFloat(value) * rootSize}px`;
      return value;
    });

    const sizes = new Set<string>();
    const families = new Set<string>();
    const unexpected = new Set<string>();
    let measured = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) continue;
      const element = node.parentElement;
      if (!element || element.closest("script, style, noscript")) continue;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0 || style.visibility === "hidden") continue;
      measured += 1;
      sizes.add(style.fontSize);
      families.add(style.fontFamily.split(",")[0].trim().replace(/^['"]|['"]$/g, ""));
      if (!scale.includes(style.fontSize)) {
        const where = typeof element.className === "string" && element.className ? element.className : element.tagName;
        unexpected.add(`${style.fontSize} (${where})`);
      }
    }
    return {
      sizes: [...sizes].sort((a, b) => Number.parseFloat(a) - Number.parseFloat(b)),
      families: [...families],
      scale,
      unexpected: [...unexpected],
      measured,
    };
  });
}

for (const [path, label] of PAGES) {
  test(`${label}: размеры текста только из шкалы, не больше трёх`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const { sizes, scale, unexpected, measured } = await typography(page);
    expect(measured, `на ${path} не найдено видимого текста`).toBeGreaterThan(10);
    expect(unexpected, `на ${path} размер вне шкалы ${scale.join(" / ")}`).toEqual([]);
    expect(sizes.length, `на ${path} размеры: ${sizes.join(", ")}`).toBeLessThanOrEqual(3);
  });
}

test("подпись под названием мельче названия: шаг шкалы, а не один размер", async ({ page }) => {
  await page.goto("/");
  const row = page.locator("li.list-row").first();
  const name = row.getByRole("link").first();
  const caption = row.locator(".caption").first();
  await expect(caption).toBeVisible();

  const [nameSize, captionSize] = await Promise.all(
    [name, caption].map((locator) => locator.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))),
  );
  expect(captionSize, `подпись ${captionSize}px не мельче названия ${nameSize}px`).toBeLessThan(nameSize);
});

test("проверка замечает размер вне шкалы", async ({ page }) => {
  await page.goto("/");
  // Проба с размером, которого нет в шкале: 0.7rem — 11.2px, не 12px из --fs-sm.
  await page.evaluate(() => {
    const probe = document.createElement("p");
    probe.textContent = "проба вне шкалы";
    probe.style.fontSize = "0.7rem";
    document.body.append(probe);
  });

  const { sizes, unexpected } = await typography(page);
  expect(unexpected.join(" ")).toContain("11.2px");
  expect(sizes.length).toBeGreaterThan(3);
});

test("текст на экранах набран одной гарнитурой JetBrains Mono из файлов приложения", async ({ page }) => {
  // Отсутствие запросов к Google Fonts проверяет `catalog.spec.ts`; здесь — что вторых гарнитур нет.
  for (const path of ["/", "/jobs/junior/profile", "/me/skills"]) {
    await page.goto(path);
    await page.evaluate(() => document.fonts.ready);

    const { families } = await typography(page);
    expect(families, `на ${path} несколько гарнитур`).toHaveLength(1);
    const family = families[0];
    expect(family, `на ${path} подставлен запасной шрифт`).not.toMatch(/Fallback/);

    // Загружено ли начертание этой гарнитуры из файлов приложения, а не подставлено браузером.
    const loaded = await page.evaluate((name) => {
      const unquote = (value: string) => value.trim().replace(/^['"]|['"]$/g, "");
      return [...document.fonts].filter((face) => face.status === "loaded" && unquote(face.family) === name).length;
    }, family);
    expect(loaded, `на ${path} не загружено ни одного начертания ${family}`).toBeGreaterThan(0);
  }
});
