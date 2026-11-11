import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { writeXlsxSheet, writeXlsxWithSheetXml } from "../src/lib/xlsx-sheet";

test.use({ asAdmin: true });

function uploadForm(page: Page) {
  return page.getByRole("form", { name: "Загрузка" });
}

async function names(page: Page) {
  await page.goto("/assignments");
  return page.locator("main").innerText();
}

async function upload(page: Page, buffer: Buffer, fileName: string) {
  await page.goto("/assignments");
  await uploadForm(page).getByLabel("Файл", { exact: true }).setInputFiles({
    name: fileName,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
  });
  const done = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().includes("/assignments"),
  );
  await uploadForm(page).getByRole("button", { name: "Загрузить" }).click();
  await done;
}

/** В каталоге zip заявленный размер распаковки больше предела, сам файл маленький. */
function declareHugeInflate(buffer: Buffer) {
  const copy = Buffer.from(buffer);
  let eocd = -1;
  for (let offset = copy.length - 22; offset >= Math.max(0, copy.length - 22 - 65535); offset -= 1) {
    if (copy.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error("нет конца zip");
  const count = copy.readUInt16LE(eocd + 8);
  let ptr = copy.readUInt32LE(eocd + 16);
  const huge = 60 * 1024 * 1024;
  for (let index = 0; index < count; index += 1) {
    copy.writeUInt32LE(huge, ptr + 24);
    const nameLength = copy.readUInt16LE(ptr + 28);
    const extraLength = copy.readUInt16LE(ptr + 30);
    const commentLength = copy.readUInt16LE(ptr + 32);
    ptr += 46 + nameLength + extraLength + commentLength;
  }
  return copy;
}

test("ячейка XFD1048576 не раздувает лист", async ({ page }) => {
  const before = await names(page);
  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetData><row r="1048576"><c r="XFD1048576" t="inlineStr"><is><t>boom</t></is></c></row></sheetData>` +
    `</worksheet>`;
  await upload(page, writeXlsxWithSheetXml(xml), "wide.xlsx");
  await expect(uploadForm(page).locator(".form-error")).toHaveText("Лист больше 10 000 строк или 100 колонок");
  await page.goto("/assignments");
  await expect(page.getByRole("heading", { level: 1, name: "Задания ИПР" })).toBeVisible();
  expect(await names(page)).toBe(before);
});

test("zip-бомба не кладёт процесс", async ({ page }) => {
  const before = await names(page);
  await upload(page, declareHugeInflate(writeXlsxSheet([["a"]])), "bomb.xlsx");
  await expect(uploadForm(page).locator(".form-error")).toHaveText("Файл Excel слишком большой");
  await page.goto("/assignments");
  await expect(page.getByRole("heading", { level: 1, name: "Задания ИПР" })).toBeVisible();
  expect(await names(page)).toBe(before);
});

test("файл больше 5 МБ не читается", async ({ page }) => {
  const before = await names(page);
  await upload(page, Buffer.alloc(5 * 1024 * 1024 + 1), "big.xlsx");
  await expect(uploadForm(page).locator(".form-error")).toHaveText("Файл больше 5 МБ");
  await page.goto("/assignments");
  await expect(page.getByRole("heading", { level: 1, name: "Задания ИПР" })).toBeVisible();
  expect(await names(page)).toBe(before);
});
