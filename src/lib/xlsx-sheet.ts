import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

/** Первая страница книги .xlsx: строка — массив ячеек. Пустые ячейки — пустая строка. */
export function readXlsxSheet(buffer: Buffer): string[][] {
  const files = unzip(buffer);
  const sheetPath = firstSheetPath(files);
  const sheet = files.get(sheetPath);
  if (!sheet) throw new Error("Это не файл Excel");
  const shared = readSharedStrings(files.get("xl/sharedStrings.xml"));
  return readSheet(sheet.toString("utf8"), shared);
}

/** Книга из одной страницы со строками текста. Для проверки загрузки, не для выдачи админу. */
export function writeXlsxSheet(rows: string[][]): Buffer {
  const sheet = sheetXml(rows);
  return zip([
    { name: "[Content_Types].xml", data: contentTypesXml() },
    { name: "_rels/.rels", data: rootRelsXml() },
    { name: "xl/workbook.xml", data: workbookXml() },
    { name: "xl/_rels/workbook.xml.rels", data: workbookRelsXml() },
    { name: "xl/worksheets/sheet1.xml", data: sheet },
  ]);
}

function unzip(buffer: Buffer): Map<string, Buffer> {
  const eocd = findEocd(buffer);
  const count = buffer.readUInt16LE(eocd + 8);
  let ptr = buffer.readUInt32LE(eocd + 16);
  const files = new Map<string, Buffer>();
  for (let index = 0; index < count; index += 1) {
    if (ptr + 46 > buffer.length || buffer.readUInt32LE(ptr) !== 0x02014b50) {
      throw new Error("Это не файл Excel");
    }
    const method = buffer.readUInt16LE(ptr + 10);
    const compressedSize = buffer.readUInt32LE(ptr + 20);
    const nameLength = buffer.readUInt16LE(ptr + 28);
    const extraLength = buffer.readUInt16LE(ptr + 30);
    const commentLength = buffer.readUInt16LE(ptr + 32);
    const localOffset = buffer.readUInt32LE(ptr + 42);
    const name = buffer.subarray(ptr + 46, ptr + 46 + nameLength).toString("utf8").replace(/\\/g, "/");
    ptr += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/")) continue;
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
    if (method === 0) files.set(name, Buffer.from(compressed));
    else if (method === 8) files.set(name, inflateRawSync(compressed));
    else throw new Error("Это не файл Excel");
  }
  return files;
}

function findEocd(buffer: Buffer): number {
  const start = Math.max(0, buffer.length - 22 - 65535);
  for (let offset = buffer.length - 22; offset >= start; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("Это не файл Excel");
}

function firstSheetPath(files: Map<string, Buffer>): string {
  const rels = files.get("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "";
  const target = /Type="[^"]*\/worksheet"[^>]*Target="([^"]+)"/.exec(rels)?.[1]
    ?? /Target="([^"]+)"[^>]*Type="[^"]*\/worksheet"/.exec(rels)?.[1];
  if (target) {
    const path = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\//, "")}`;
    if (files.has(path)) return path;
  }
  const fallback = [...files.keys()].find((name) => /xl\/worksheets\/sheet\d+\.xml$/.test(name));
  if (!fallback) throw new Error("Это не файл Excel");
  return fallback;
}

function readSharedStrings(file: Buffer | undefined): string[] {
  if (!file) return [];
  const xml = file.toString("utf8");
  const items: string[] = [];
  for (const match of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    const parts = [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((part) => decodeXml(part[1]));
    items.push(parts.join(""));
  }
  return items;
}

function readSheet(xml: string, shared: string[]): string[][] {
  const cells = new Map<number, Map<number, string>>();
  let maxRow = 0;
  let maxCol = 0;
  for (const match of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attrs = match[1] ?? "";
    const body = match[2] ?? "";
    const ref = /r="([A-Z]+\d+)"/i.exec(attrs)?.[1];
    if (!ref) continue;
    const row = Number(/(\d+)$/.exec(ref)?.[1] ?? "0") - 1;
    const col = columnIndex(/^([A-Z]+)/i.exec(ref)?.[1] ?? "");
    if (row < 0 || col < 0) continue;
    const kind = /t="([^"]+)"/.exec(attrs)?.[1] ?? "";
    const value = cellText(kind, body, shared);
    const rowCells = cells.get(row) ?? new Map<number, string>();
    rowCells.set(col, value);
    cells.set(row, rowCells);
    maxRow = Math.max(maxRow, row);
    maxCol = Math.max(maxCol, col);
  }
  const grid: string[][] = [];
  for (let row = 0; row <= maxRow; row += 1) {
    const rowCells = cells.get(row);
    const line: string[] = [];
    for (let col = 0; col <= maxCol; col += 1) line.push(rowCells?.get(col) ?? "");
    grid.push(line);
  }
  return grid;
}

function cellText(kind: string, body: string, shared: string[]): string {
  if (kind === "inlineStr") {
    return [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((part) => decodeXml(part[1])).join("");
  }
  const raw = decodeXml(/<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "");
  if (kind === "s") return shared[Number(raw)] ?? "";
  return raw;
}

function columnIndex(letters: string): number {
  let index = 0;
  for (const char of letters.toUpperCase()) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

function columnName(index: number): string {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function decodeXml(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, value: string) => String.fromCodePoint(Number(value)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, value: string) => String.fromCodePoint(Number.parseInt(value, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function xmlText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sheetXml(rows: string[][]): Buffer {
  const body = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((value, colIndex) => {
          const ref = `${columnName(colIndex)}${rowIndex + 1}`;
          return `<c r="${ref}" t="inlineStr"><is><t>${xmlText(value)}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`,
    "utf8",
  );
}

function contentTypesXml(): Buffer {
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      `</Types>`,
    "utf8",
  );
}

function rootRelsXml(): Buffer {
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
      `</Relationships>`,
    "utf8",
  );
}

function workbookXml(): Buffer {
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<sheets><sheet name="Задания" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "utf8",
  );
}

function workbookRelsXml(): Buffer {
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
      `</Relationships>`,
    "utf8",
  );
}

function zip(files: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const compressed = deflateRawSync(file.data);
    const checksum = crc32(file.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const chunk = Buffer.concat([local, name, compressed]);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(chunk);
    centrals.push(Buffer.concat([central, name]));
    offset += chunk.length;
  }
  const directory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, eocd]);
}
