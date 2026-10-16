---
name: assignment-import
description: Собирает Excel для загрузки заданий и тестов ИПР на /assignments. Use when the user asks to generate, fill, or prepare the assignment workbook, xlsx, or Excel file for the IDP catalog import.
---

# Книга заданий

Читать `docs/assignment-import.md` и следовать ему. Книгу не собирать вручную и не другим генератором.

- Идентификаторы компетенций — `npm run assignments:xlsx -- --catalog` или адрес `/admin/competencies/{id}`. Название вместо идентификатора не писать. Обязанность в файл не ставить.
- JSON по образцу из документа. `correct` только `true` или `false`.
- Книга: `npm run assignments:xlsx -- <задания.json> <книга.xlsx>`. Команда сама проверяет разбор. Если она пишет ошибки, файл не создан: править JSON, не таблицу.
- Уровень писать полем `level`: 1, 2 или 3. Обязанность в задания не ставить. Скрытое задание файл не обновит. Строки открытого ИПР загрузка не меняет.
- Готовый xlsx в git не класть. Отдать путь к файлу.
