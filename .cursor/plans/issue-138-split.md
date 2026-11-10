#138 Схема на старте сервера

| # | Блок | Исполнитель | Проверка |
|---|---|---|---|
| 1 | Разведка: `migrate`, `ensureSchema`, seed, e2e-цепочка | родитель | граф вызовов уже снят по `src/lib/queries.ts`, `src/db/migrate.ts`, `scripts/seed.ts`, `src/lib/auth.ts`, `playwright.config.ts`; dsh не отделялся |
| 2 | `applySchema` и `instrumentation.ts`, снять `SCHEMA_TICK` | родитель | `npx tsx scripts/check-startup-schema.ts` |
| 3 | Спека старта и пункт в `learned-cases.mdc` | родитель | `npm run check:fast -- e2e/schema-startup.spec.ts` |
| 4 | Полный `npm run verify` | родитель | вывод в pull request; гейт один и занимает сборку, dsh параллельно не запускать |
| 5 | Ревью диффа перед pull request | родитель | сверка с критериями #138 |

Оркестрация: dsh 0 из 5. Причина: узкая правка старта схемы, разведка уже есть, полный прогон нельзя совмещать со вторым агентом на той же сборке.
