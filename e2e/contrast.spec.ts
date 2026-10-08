import { expect, test, type Page } from "@playwright/test";

type Theme = "dark" | "light";

const THEMES: Theme[] = ["dark", "light"];
const TEXT_MIN = 4.5;
const BORDER_MIN = 3;

type TextColor = { text: string; ratio: number; color: string; background: string };
type RowColor = { onPage: string; onGrid: string; border: number };

async function openInTheme(page: Page, path: string, theme: Theme) {
  await page.addInitScript((value) => localStorage.setItem("pp-theme", value), theme);
  await page.goto(path);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

/**
 * Вычисленные цвета внутри `selector` по WCAG.
 * Фон элемента — наложение полупрозрачных фонов предков на фон страницы и на линию клетки.
 * `texts` — каждый видимый текст с худшим из двух контрастов, `rows` — первые четыре строки таблицы сравнения.
 */
async function measureColors(page: Page, selector: string): Promise<{ texts: TextColor[]; rows: RowColor[] }> {
  return page.evaluate((selector) => {
    type Rgba = [number, number, number, number];
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

    function parse(value: string): Rgba {
      const rgb = value.match(/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/);
      if (rgb) return [+rgb[1], +rgb[2], +rgb[3], rgb[4] === undefined ? 1 : +rgb[4]];
      const srgb = value.match(/^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.]+))?\)$/);
      if (srgb) return [+srgb[1] * 255, +srgb[2] * 255, +srgb[3] * 255, srgb[4] === undefined ? 1 : +srgb[4]];
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
      return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
    }

    function background(element: Element, base: Rgba): Rgba {
      const chain: Element[] = [];
      for (let node: Element | null = element; node && node !== document.body; node = node.parentElement) {
        chain.unshift(node);
      }
      return chain.reduce((acc, node) => over(parse(getComputedStyle(node).backgroundColor), acc), base);
    }

    function css([r, g, b]: Rgba) {
      return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
    }

    const body = getComputedStyle(document.body);
    const pageBg = parse(body.backgroundColor);
    const gridBg = over(parse(body.getPropertyValue("--grid").trim()), pageBg);

    const texts: TextColor[] = [];
    for (const root of document.querySelectorAll(selector)) {
      for (const element of [root, ...root.querySelectorAll("*")]) {
        const ownText = [...element.childNodes]
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent ?? "")
          .join("")
          .trim();
        if (!ownText || !element.checkVisibility()) continue;
        const color = getComputedStyle(element).color;
        const worst = [pageBg, gridBg]
          .map((base) => {
            const bg = background(element, base);
            return { bg, ratio: ratio(over(parse(color), bg), bg) };
          })
          .sort((x, y) => x.ratio - y.ratio)[0];
        texts.push({ text: ownText.slice(0, 60), ratio: worst.ratio, color, background: css(worst.bg) });
      }
    }

    const rows = [...document.querySelectorAll("table.compare-table tr[data-change] td:first-child")]
      .slice(0, 4)
      .map((cell) => {
        const onPage = background(cell, pageBg);
        return {
          onPage: css(onPage),
          onGrid: css(background(cell, gridBg)),
          border: ratio(over(parse(getComputedStyle(cell).borderBottomColor), onPage), onPage),
        };
      });

    return { texts, rows };
  }, selector);
}

function lowContrast(texts: TextColor[]) {
  return texts.filter((t) => t.ratio < TEXT_MIN);
}

for (const theme of THEMES) {
  test(`сравнение (${theme}): фон строк чередуется, клетка не просвечивает, границы видны`, async ({ page }) => {
    await openInTheme(page, "/compare?a=junior&b=programmer", theme);
    const { rows } = await measureColors(page, "table.compare-table");
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.onGrid, "клетка просвечивает через строку").toBe(row.onPage);
      expect(row.border, "контраст границы строки").toBeGreaterThanOrEqual(BORDER_MIN);
    }
    expect(rows[0].onPage).not.toBe(rows[1].onPage);
    expect(rows[2].onPage).toBe(rows[0].onPage);
    expect(rows[3].onPage).toBe(rows[1].onPage);
  });

  test(`сравнение (${theme}): контраст текста не ниже ${TEXT_MIN}:1`, async ({ page }, testInfo) => {
    // Вторая пара — сравнение с самой собой: только строки «без изменений».
    for (const path of ["/compare?a=junior&b=programmer", "/compare?a=junior&b=junior"]) {
      await openInTheme(page, path, theme);
      const { texts } = await measureColors(page, "table.compare-table");
      expect(texts.length).toBeGreaterThan(0);
      expect(lowContrast(texts), path).toEqual([]);
    }
    await page.goto("/compare?a=junior&b=programmer");
    const screenshot = testInfo.outputPath(`compare-${theme}.png`);
    await page.locator("table.compare-table").screenshot({ path: screenshot });
    await testInfo.attach(`compare-${theme}`, { path: screenshot, contentType: "image/png" });
  });

  test(`профиль (${theme}): контраст текста в трёх блоках не ниже ${TEXT_MIN}:1`, async ({ page }, testInfo) => {
    await openInTheme(page, "/jobs/junior/profile", theme);
    await page
      .locator("details")
      .evaluateAll((all) => all.forEach((details) => ((details as HTMLDetailsElement).open = true)));
    const { texts } = await measureColors(page, ".lane-tech, .lane-soft, .lane-duty");
    expect(texts.length).toBeGreaterThan(0);
    expect(lowContrast(texts)).toEqual([]);
    const screenshot = testInfo.outputPath(`profile-${theme}.png`);
    await page.locator(".lane-tech").locator("xpath=..").screenshot({ path: screenshot });
    await testInfo.attach(`profile-${theme}`, { path: screenshot, contentType: "image/png" });
  });
}
