# issue 146 — импорт сотрудников

| # | Блок | Исполнитель | Проверка |
|---|---|---|---|
| 1 | Разбор листа и действие `importEmployeesAction` | родитель | отчёт по строкам, одна транзакция |
| 2 | Форма на `/people` и шаблон `employees:xlsx` | родитель | форма только у админа |
| 3 | `e2e/staff-employee-import.spec.ts` | dsh | `npm run check:fast -- e2e/staff-employee-import.spec.ts` |
| 4 | Полный прогон | dsh | `npm run verify` |
| 5 | Коммит, push, pull request | родитель | ссылка на PR |
