export const EMPLOYEE_IMPORT_COLUMNS = ["Логин", "Имя", "Пароль", "Должность", "Руководитель", "Админ"] as const;

export type EmployeeImportRow = {
  row: number;
  login: string;
  name: string;
  password: string;
  job: string;
  manager: string;
  admin: string;
};

/** Первая страница книги сотрудников. Пароль остаётся в строке разбора и в отчёт не попадает. */
export function parseEmployeeSheet(grid: string[][]): { errors: string[]; rows: EmployeeImportRow[] } {
  const header = grid[0] ?? [];
  const headerOk = EMPLOYEE_IMPORT_COLUMNS.every((name, index) => (header[index] ?? "").trim() === name);
  if (!headerOk || (header[6] ?? "").trim() !== "") {
    return {
      errors: [`В первой строке нужны колонки: ${EMPLOYEE_IMPORT_COLUMNS.join(", ")}.`],
      rows: [],
    };
  }

  const rows: EmployeeImportRow[] = [];
  for (let index = 1; index < grid.length; index += 1) {
    const cells = EMPLOYEE_IMPORT_COLUMNS.map((_, column) => grid[index]?.[column] ?? "");
    const login = (cells[0] ?? "").trim();
    const name = (cells[1] ?? "").trim();
    const password = cells[2] ?? "";
    const job = (cells[3] ?? "").trim();
    const manager = (cells[4] ?? "").trim();
    const admin = (cells[5] ?? "").trim();
    if ([login, name, password.trim(), job, manager, admin].every((cell) => cell === "")) continue;
    rows.push({ row: index + 1, login, name, password, job, manager, admin });
  }
  if (rows.length === 0) return { errors: ["В файле нет строк"], rows: [] };
  return { errors: [], rows };
}
