---
name: app-stack
description: Applies this repo's Next.js 15 App Router, React 19, Drizzle, and node:sqlite constraints, adapted from Vercel agent skills and Next.js 15 cursor rules. Use when editing src/app, src/components, src/db, server actions, forms, or SQLite access.
---

# Стек приложения

Next.js 15 App Router, React 19, Tailwind 4 только для раскладки, Drizzle, `node:sqlite`. Приложение локальное: `127.0.0.1:3000`.

## Что читать

- Формы, страницы, server actions: `.cursor/rules/next-app.mdc`
- Схема, миграции, запросы: `.cursor/rules/drizzle-sqlite.mdc`
- Уже пойманные сбои: `.cursor/rules/learned-cases.mdc`
- Продукт и вид: `CONTEXT.md`, `.cursor/rules/ui-stack.mdc`

## Откуда взяты правила

- Производительность и server actions: [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices) (`async-parallel`, `server-auth-actions`, `server-cache-react`, `server-no-shared-module-state`, `bundle-dynamic-imports`). Полный текст правила читать по пути `rules/<id>.md` только когда задача про скорость или лишний бандл.
- App Router и React 19: [nextjs15-react19](https://github.com/PatrickJS/awesome-cursorrules/blob/main/rules/nextjs15-react19-vercelai-tailwind-cursorrules-prompt-file.mdc) — серверные компоненты по умолчанию, `useActionState`, `await` у `cookies` и `params`.
- Drizzle в Next.js: одно соединение на `globalThis` на время HMR, запросы только на сервере.

Не переносить из этих источников: Vercel AI SDK, shadcn, Radix, nuqs, SWR, `next/image`, `next/link`, Postgres, Neon, деплой на Vercel.

## Новый кейс

Если сбой повторяемый и его нет в `learned-cases.mdc`, дописать один пункт: симптом, причина, что делать. Хук `stop` сам пришлёт список упавших инструментов из `.cursor/case-inbox.jsonl`, когда он не пуст.
