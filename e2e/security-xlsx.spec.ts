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

/** Несколько записей STORED ссылаются на один кусок и заявляют нулевой размер распаковки. */
function storedOverlapBomb() {
  const payload = Buffer.alloc(4 * 1024 * 1024, 0x61);
  const name = Buffer.from("xl/worksheets/sheet1.xml");
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(payload.length, 18);
  local.writeUInt16LE(name.length, 26);
  const localChunk = Buffer.concat([local, name, payload]);
  const copies = 20;
  const centrals: Buffer[] = [];
  for (let index = 0; index < copies; index += 1) {
    const entryName = Buffer.from(`xl/worksheets/sheet${index}.xml`);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt16LE(entryName.length, 28);
    centrals.push(Buffer.concat([central, entryName]));
  }
  const directory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(copies, 8);
  eocd.writeUInt16LE(copies, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(localChunk.length, 16);
  return Buffer.concat([localChunk, directory, eocd]);
}

test("zip-бомба не кладёт процесс", async ({ page }) => {
  const before = await names(page);
  await upload(page, declareHugeInflate(writeXlsxSheet([["a"]])), "bomb.xlsx");
  await expect(uploadForm(page).locator(".form-error")).toHaveText("Файл Excel слишком большой");
  await page.goto("/assignments");
  await expect(page.getByRole("heading", { level: 1, name: "Задания ИПР" })).toBeVisible();
  expect(await names(page)).toBe(before);
});

test("повторы STORED не раздувают память", async ({ page }) => {
  const before = await names(page);
  await upload(page, storedOverlapBomb(), "stored.xlsx");
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
