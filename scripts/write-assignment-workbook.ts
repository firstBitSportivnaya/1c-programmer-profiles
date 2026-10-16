/**
 * Книга для загрузки заданий на /assignments.
 * Описание для агента: docs/assignment-import.md.
 * Файл книги в git не класть.
 */
import fs from "node:fs";
import path from "node:path";
import { assignmentSheetRows, parseAssignmentSheet, type ParsedAssignment } from "../src/lib/assignment-workbook";
import { writeXlsxSheet } from "../src/lib/xlsx-sheet";

type Competency = { id: string; name: string; type: string };

const usage = `npm run assignments:xlsx -- --catalog
npm run assignments:xlsx -- <задания.json> <книга.xlsx>`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") fail(label);
  return value.trim();
}

function readAssignment(value: unknown, index: number): ParsedAssignment {
  if (!isRecord(value)) fail(`Задание ${index + 1}: нужен объект`);
  const questionsRaw = value.questions ?? [];
  if (!Array.isArray(questionsRaw)) fail(`Задание ${index + 1}: questions — массив`);
  const questions = questionsRaw.map((question, questionIndex) => {
    if (!isRecord(question)) fail(`Задание ${index + 1}, вопрос ${questionIndex + 1}: нужен объект`);
    const prompt = readText(question.prompt, `Задание ${index + 1}, вопрос ${questionIndex + 1}: нужен текст`);
    if (!Array.isArray(question.options)) {
      fail(`Задание ${index + 1}, вопрос «${prompt}»: options — массив`);
    }
    const options = question.options.map((option, optionIndex) => {
      if (!isRecord(option)) fail(`Вопрос «${prompt}», вариант ${optionIndex + 1}: нужен объект`);
      if (typeof option.correct !== "boolean") {
        fail(`Вопрос «${prompt}»: у варианта correct — true или false`);
      }
      return {
        text: readText(option.text, `Вопрос «${prompt}», вариант ${optionIndex + 1}: нужен текст`),
        correct: option.correct,
      };
    });
    return { prompt, options };
  });
  const levelProvided = Object.prototype.hasOwnProperty.call(value, "level");
  let level: number | null = null;
  if (levelProvided) {
    if (value.level == null || value.level === "") level = null;
    else if (value.level === 1 || value.level === 2 || value.level === 3) level = value.level;
    else fail(`Задание ${index + 1}: уровень — 1, 2, 3 или null`);
  }
  return {
    competencyId: readText(value.competencyId, `Задание ${index + 1}: нужен competencyId`),
    name: readText(value.name, `Задание ${index + 1}: нужно название`),
    learnText: readText(value.learnText, `Задание ${index + 1}: нужен текст «узнать»`),
    verifyText: readText(value.verifyText, `Задание ${index + 1}: нужен текст «проверить»`),
    levelProvided,
    level,
    questions,
  };
}

function readJson(file: string): unknown {
  const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    fail(`Не разобрать JSON: ${file}`);
  }
}

function readAssignments(file: string): ParsedAssignment[] {
  const raw = readJson(file);
  const list = Array.isArray(raw) ? raw : isRecord(raw) && Array.isArray(raw.assignments) ? raw.assignments : null;
  if (!list) fail("Нужен JSON-массив или объект с полем assignments");
  if (list.length === 0) fail("В файле нет заданий");
  return list.map((item, index) => readAssignment(item, index));
}

function printCatalog() {
  const seedPath = path.join(process.cwd(), "seed", "data.json");
  const seed = readJson(seedPath) as { competencies?: Competency[] };
  const rows = (seed.competencies ?? []).filter((item) => item.type !== "duty");
  for (const item of rows) console.log(`${item.id}\t${item.type}\t${item.name}`);
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--catalog") {
    printCatalog();
    return;
  }
  if (args.length !== 2 || args[0] === "--help") fail(usage);
  const [input, output] = args;
  if (!input || !output) fail(usage);
  const assignments = readAssignments(path.resolve(input));
  const rows = assignmentSheetRows(assignments);
  const parsed = parseAssignmentSheet(rows);
  if (parsed.errors.length > 0) fail(parsed.errors.join("\n"));
  const target = path.resolve(output);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, writeXlsxSheet(rows));
  const optionRows = rows.length - 1;
  console.log(`Записано заданий: ${parsed.assignments.length}. Строк вариантов: ${optionRows}. ${target}`);
}

main();
