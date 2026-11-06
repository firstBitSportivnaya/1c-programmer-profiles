# #125 — таблица ручных подтверждений: план блоков

Основание — ADR 0011 (`docs/adr/0011-manual-competency-confirmation.md`), этап 1 из #114.
Таблица ведётся по `AGENTS.md → шаг 2` и `~/.cursor/rules/dsh-subagent.mdc → Квота и чекпоинт`.

| # | Блок | Исполнитель | Проверка | Статус |
|---|------|-------------|----------|--------|
| 1 | Разведка: `migrate.ts` (DDL, `ensure*`, `tableExists`), `scripts/upgrade-base.ts`, `check:upgrade`, `assertCompetencyDeletable`, образцы e2e с прямым чтением базы | dsh `headless` | отчёт с адресами `путь:строка` | в работе |
| 2 | Схема: таблица `employee_competency_confirmations`, индекс по `competency_id` | родитель | `npx tsc --noEmit` | — |
| 3 | Миграция: DDL и `migrate()`, без пересоздания таблиц и `ALLOWED_LOSS` | родитель | `npm run db:seed` на временной базе | — |
| 4 | Заполнение `scripts/upgrade-base.ts` | родитель | `check:upgrade` (CI на базе из `main`) | — |
| 5 | Запрет удаления компетенции с подтверждениями в `assertCompetencyDeletable` | родитель | `npx tsc --noEmit` | — |
| 6 | Локальная проверка обновления: база, собранная кодом `main` (worktree в `tmp/`), открывается кодом ветки | родитель | `npm run check:upgrade -- <снимок>` | — |
| 7 | Полный `npm run verify` | dsh `dev` | все ступени `ok` | — |
| 8 | Ревью диффа перед pull request | dsh `headless` | замечания разобраны | — |

Блоки 1, 7, 8 — dsh (3 из 8); схема и правила домена остаются у родителя.
e2e в этом issue нет: по условию #125 критерий 2 проверяет следующий issue, критерий 1 — CI-джоба `upgrade`.
