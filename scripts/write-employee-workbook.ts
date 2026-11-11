/**
 * Шаблон книги для загрузки сотрудников на /people.
 * Файл книги в git не класть.
 */
import fs from "node:fs";
import path from "node:path";
import { EMPLOYEE_IMPORT_COLUMNS } from "../src/lib/employee-workbook";
import { writeXlsxSheet } from "../src/lib/xlsx-sheet";

const usage = "npm run employees:xlsx -- <книга.xlsx>";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0] === "--help" || !args[0]) fail(usage);
  const target = path.resolve(args[0]);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, writeXlsxSheet([[...EMPLOYEE_IMPORT_COLUMNS]]));
  console.log(target);
}

main();
