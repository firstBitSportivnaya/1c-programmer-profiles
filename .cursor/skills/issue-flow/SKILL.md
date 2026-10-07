---
name: issue-flow
description: Ведёт доработку этого репозитория по GitHub issue — ветка от main, код, e2e-тесты, проверки, коммит, push и pull request, затем стоп. Use when the user gives an issue number or link, says «сделай issue», «возьми issue», «проверь реализацию issue» или просит разобрать замечания к pull request.
---

# Доработка по issue

Порядок действий — `AGENTS.md` в корне, процесс и проверки — `docs/workflow.md`. Этот skill только добавляет то, что относится к Cursor.

## GitHub в Cursor

Через MCP `user-GitKraken`: provider `github`, организация `firstBitSportivnaya`, репозиторий `1c-programmer-profiles`. Перед первым вызовом инструмента — `GetDynamicTools` для него. `gh` не вызывать.

| Шаг `AGENTS.md` | Инструмент |
|---|---|
| Прочитать issue | `issues_get_detail` |
| Создать pull request | `pull_request_create` |
| Статус и замечания ревью | `pull_request_get_detail`, `pull_request_get_comments` |
| Комментарий в issue | `issues_add_comment` |

Коммит, push и ветки — `git` в shell.

## Вопросы человеку

Через `AskQuestion`, только в случаях из шага 1 `AGENTS.md`.

## Проверка чужой реализации

Если просят проверить готовый pull request или ветку: прочитать issue и diff (`git fetch`, `git diff origin/main...<ветка>`). Сопоставить каждый критерий приёмки с тестом в `e2e/`, прогнать проверки из шага 5 `AGENTS.md` без правок кода. Отчёт — по критериям: покрыт тестом и проходит / не покрыт / падает, с выводом команды.
