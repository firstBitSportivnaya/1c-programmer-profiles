# Профили должностей

Локальный справочник должностей и профилей программистов 1С (лестница OKP2).

## Запуск

```
copy .env.example .env.local
```

В `.env.local` задайте `ADMIN_PASSWORD` и длинный случайный `SESSION_SECRET`. Пустые значения и плейсхолдеры `change-me` / `dev-only-change-me` код отклоняет: без секрета сессия администратора не выдаётся.

```
npm install
npm run db:seed
npm run dev
```

Открыть http://127.0.0.1:3000 .

SQLite: `data/profiles.sqlite`. Перед повторным `db:seed` файл копируется в `*.bak`.

## Стек

Next.js (App Router, только `localhost`) + Drizzle + SQLite через `node:sqlite` (Node 24). WAL и одно соединение; вложенные транзакции — через SAVEPOINT. Пакет `better-sqlite3` в зависимостях — локальная заглушка: drizzle-адаптер импортирует это имя, нативный модуль не ставится.

## Данные

Карта узлов: `docs/node-map.md`. Контракт seed: `docs/seed-contract.md`. JSON: `seed/data.json`.

Правила наполнения профилей — шкала уровней, стиль критериев, работа со справочником, порядок правок и порядок заполнения новой роли — в `docs/content-decisions.md`. Привязка профилей к профстандартам 06.001, 06.003 и 06.017 — в `docs/profstandards.md`. Перед правкой контента читать оба.

Словарь предметной области — `CONTEXT.md`. Решения, которые иначе придётся угадывать, — `docs/adr/`. Инженерные решения (стек, sqlite-заглушка, админка, граф, генератор, как работать с агентом) — в `docs/engineering-decisions.md`. Для Cursor те же ограничения лежат в `.cursor/rules/`.

Профиль стажёра входит в seed (mxfile 2022, страница 229982860). Уровни 1–3 у `professional` / `universal` задаёт матрица `LEVEL_MATRIX` в `scripts/extract_drawio.py` (пять грейдов) и таблица `PROFILE_LEVELS` (архитектор, руководитель команды); из drawio они не извлекаются. После изменения `seed/data.json` нужен повторный `npm run db:seed`.
