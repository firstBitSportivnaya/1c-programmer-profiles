# #133 — дерево навыков сотрудника для руководителя: план блоков

Основание — issue #133 и ADR 0011. Ветка `issue-133-employee-skill-tree` от `origin/main` (`26e37f7`).

Маршрут `/people/{employeeId}/skills`: тот же снимок дерева, что на `/me/skills`, но в режиме
просмотра чужого сотрудника — личные пометки не передаются и не рендерятся (ADR 0007),
в панели узла появляется подтверждение и отзыв.

| # | Блок | Исполнитель | Проверка |
|---|---|---|---|
| 1 | Разведка: сборка снимка `/me/skills`, пропсы `SkillTree` и `SkillNodePanel`, карточка `/people/{id}`, `canViewEmployee`/`canManageEmployee`, `revalidatePeople`, e2e-фикстуры | dsh `headless` | отчёт `путь:строка` по 8 вопросам |
| 2 | Вынос сборки снимка в `src/lib/` и новый маршрут `/people/{employeeId}/skills` с правами карточки | родитель | `npx tsc --noEmit` |
| 3 | Режим `review` в `SkillTree`/`SkillNodePanel`: без пометок и счётчика «Освоено», подпись о приватности, блок «Подтверждение» с формой и снятием | родитель | `npm run build`, сверка с ADR 0011 |
| 4 | e2e `e2e/staff-skill-tree-review.spec.ts` на критерии 1–5, включая негативные (пометка в review-режиме, чужая учётка, пустые основание и причина) | dsh `dev` | спек зелёный |
| 5 | `CONTEXT.md`, ADR 0011 и ссылка в ADR 0007: дерево больше не только личное | родитель | сверка с ADR 0001, 0006, 0007 |
| 6 | Полный `npm run verify` | dsh `dev` | все ступени `ok` |
| 7 | Ревью диффа перед pull request | dsh `headless` | замечания разобраны |

Порядок: 1 → 2 → 3 → 5 → 4 → 6 → 7. Этап 4 после 3: спек опирается на готовый режим.

Что не меняем: `src/lib/gap.ts` и ADR 0002, `src/lib/achievement-rules.ts`, `collectConfirmed`,
`canViewEmployee`/`canManageEmployee`, схему и миграции (таблица из #125 есть).
