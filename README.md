# Профили должностей

Локальный справочник должностей и профилей программистов 1С (лестница OKP2).

## Запуск

```
copy .env.example .env.local
npm install
npm run db:seed
npm run dev
```

Открыть http://127.0.0.1:3000 . Пароль админа — `ADMIN_PASSWORD` в `.env.local`.

SQLite: `data/profiles.sqlite`. Перед повторным `db:seed` файл копируется в `*.bak`.

## Стек

Next.js (App Router, только `localhost`) + Drizzle + SQLite через `node:sqlite` (Node 24). `better-sqlite3` на этой машине не собрался: нет Visual Studio C++, install-скрипты npm были пропущены. WAL и одно соединение сохранены.

## Данные

Карта узлов: `docs/node-map.md`. Контракт seed: `docs/seed-contract.md`. JSON: `seed/data.json`.
