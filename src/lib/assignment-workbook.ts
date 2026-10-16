export const ASSIGNMENT_IMPORT_COLUMNS = [
  "Компетенция",
  "Задание",
  "Узнать",
  "Проверить",
  "Вопрос",
  "Вариант",
  "Верный",
] as const;

export type ParsedAssignment = {
  competencyId: string;
  name: string;
  learnText: string;
  verifyText: string;
  /** Колонки «Уровень» в файле не было. */
  levelProvided: boolean;
  /** Пустая ячейка — уровень не задавать. 1, 2 или 3 — записать. */
  level: number | null;
  questions: { prompt: string; options: { text: string; correct: boolean }[] }[];
};

type SheetRow = {
  row: number;
  competencyId: string;
  name: string;
  learnText: string;
  verifyText: string;
  prompt: string;
  option: string;
  correct: string;
  levelProvided: boolean;
  level: number | null;
};

/** Разбор первой страницы. При ошибках действие не пишет, но список нужен, чтобы добавить ошибки справочника. */
export function parseAssignmentSheet(grid: string[][]): { errors: string[]; assignments: ParsedAssignment[] } {
  const header = grid[0] ?? [];
  const headerOk = ASSIGNMENT_IMPORT_COLUMNS.every((name, index) => (header[index] ?? "").trim() === name);
  const levelProvided = (header[7] ?? "").trim() === "Уровень";
  const stray = (header[7] ?? "").trim();
  if (!headerOk || (stray !== "" && !levelProvided)) {
    return {
      errors: [`В первой строке нужны колонки: ${ASSIGNMENT_IMPORT_COLUMNS.join(", ")}. Необязательная восьмая — Уровень.`],
      assignments: [],
    };
  }

  const errors: string[] = [];
  const rows: SheetRow[] = [];
  for (let index = 1; index < grid.length; index += 1) {
    const cells = ASSIGNMENT_IMPORT_COLUMNS.map((_, column) => (grid[index]?.[column] ?? "").trim());
    const levelCell = levelProvided ? (grid[index]?.[7] ?? "").trim() : "";
    if (cells.every((cell) => cell === "") && levelCell === "") continue;
    const level = levelCell === "" ? null : levelNumber(levelCell);
    if (levelProvided && levelCell !== "" && level == null) {
      errors.push(`Строка ${index + 1}: уровень — 1, 2, 3 или пусто`);
    }
    rows.push({
      row: index + 1,
      competencyId: cells[0] ?? "",
      name: cells[1] ?? "",
      learnText: cells[2] ?? "",
      verifyText: cells[3] ?? "",
      prompt: cells[4] ?? "",
      option: cells[5] ?? "",
      correct: cells[6] ?? "",
      levelProvided,
      level,
    });
  }
  if (rows.length === 0) return { errors: ["В файле нет строк"], assignments: [] };

  const groups = new Map<
    string,
    {
      competencyId: string;
      name: string;
      learnText: string;
      verifyText: string;
      levelProvided: boolean;
      level: number | null;
      questions: Map<string, { prompt: string; options: { text: string; correct: boolean }[] }>;
    }
  >();

  for (const row of rows) {
    if (!row.competencyId) errors.push(`Строка ${row.row}: неизвестная компетенция`);
    if (!row.name) errors.push(`Строка ${row.row}: пустое название`);
    if (!row.learnText || !row.verifyText) errors.push(`Строка ${row.row}: нужны «узнать» и «проверить»`);

    const asked = row.prompt !== "" || row.option !== "" || row.correct !== "";
    let correct: boolean | null = null;
    if (asked) {
      if (!row.prompt) errors.push(`Строка ${row.row}: вариант без вопроса`);
      if (!row.option) errors.push(`Строка ${row.row}: нужен текст варианта`);
      correct = correctFlag(row.correct);
      if (correct == null) errors.push(`Строка ${row.row}: признак «верный» — да или нет`);
    }

    if (!row.competencyId || !row.name) continue;
    const key = `${row.competencyId}\0${row.name.toLowerCase()}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        competencyId: row.competencyId,
        name: row.name,
        learnText: row.learnText,
        verifyText: row.verifyText,
        levelProvided: row.levelProvided,
        level: row.level,
        questions: new Map(),
      });
    } else {
      if (row.learnText && row.learnText !== existing.learnText) {
        errors.push(`Строка ${row.row}: у задания «${existing.name}» другой текст «узнать»`);
      }
      if (row.verifyText && row.verifyText !== existing.verifyText) {
        errors.push(`Строка ${row.row}: у задания «${existing.name}» другой текст «проверить»`);
      }
      if (row.levelProvided && row.level !== existing.level) {
        errors.push(`Строка ${row.row}: у задания «${existing.name}» другой уровень`);
      }
    }
    const group = groups.get(key);
    if (!group || !row.prompt || !row.option || correct == null) continue;
    const questionKey = row.prompt.toLowerCase();
    const question = group.questions.get(questionKey) ?? { prompt: row.prompt, options: [] };
    question.options.push({ text: row.option, correct });
    group.questions.set(questionKey, question);
  }

  const assignments: ParsedAssignment[] = [];
  for (const group of groups.values()) {
    const questions = [...group.questions.values()];
    for (const question of questions) {
      if (question.options.length < 2) {
        errors.push(`У вопроса «${question.prompt}» нужно хотя бы два варианта`);
        continue;
      }
      const correctCount = question.options.filter((option) => option.correct).length;
      if (correctCount !== 1) {
        errors.push(`У вопроса «${question.prompt}» должен быть ровно один верный вариант`);
      }
    }
    assignments.push({
      competencyId: group.competencyId,
      name: group.name,
      learnText: group.learnText,
      verifyText: group.verifyText,
      levelProvided: group.levelProvided,
      level: group.level,
      questions,
    });
  }
  return { errors, assignments };
}

/** Строки первой страницы: заголовок и по одной строке на вариант. Пустой тест — одна строка без вопроса. */
export function assignmentSheetRows(assignments: ParsedAssignment[]): string[][] {
  const withLevel = assignments.some((item) => item.levelProvided);
  const header = withLevel ? [...ASSIGNMENT_IMPORT_COLUMNS, "Уровень"] : [...ASSIGNMENT_IMPORT_COLUMNS];
  const rows: string[][] = [header];
  for (const assignment of assignments) {
    const head = [assignment.competencyId, assignment.name, assignment.learnText, assignment.verifyText];
    const tail = withLevel ? [assignment.level == null ? "" : String(assignment.level)] : [];
    if (assignment.questions.length === 0) {
      rows.push([...head, "", "", "", ...tail]);
      continue;
    }
    for (const question of assignment.questions) {
      for (const option of question.options) {
        rows.push([...head, question.prompt, option.text, option.correct ? "да" : "нет", ...tail]);
      }
    }
  }
  return rows;
}

function levelNumber(value: string): number | null {
  if (value === "1" || value === "2" || value === "3") return Number(value);
  return null;
}

function correctFlag(value: string): boolean | null {
  const flag = value.trim().toLowerCase();
  if (flag === "да" || flag === "1") return true;
  if (flag === "нет" || flag === "0") return false;
  return null;
}
