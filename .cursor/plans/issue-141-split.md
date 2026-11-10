# issue 141 — даты ДД.ММ.ГГГГ

Ветка `issue-141-dotted-dates` от `origin/main`.

| # | Блок | Исполнитель | Проверка |
|---|---|---|---|
| 1 | `src/lib/dates.ts` и замена трёх `dottedDate`, срок и период на экранах | родитель | критерии 1–5, ISO только в `input type="date"` |
| 2 | Правка e2e локаторов и проверка, что в тексте панели нет ISO | родитель | `staff-idp-table`, `staff-idp-edit`, `staff-idp-calendar`, `staff-skill-tree`, `staff-competency-confirmed-calc` |
| 3 | `npm run verify` | родитель | таблица PR |
| 4 | Ревью диффа перед PR | родитель | карта приёмки |

Оркестрация: dsh 0 из 4. Причина: один рабочий каталог и общая `.next`; правки экранов и полный verify нельзя отдать второму процессу параллельно.
