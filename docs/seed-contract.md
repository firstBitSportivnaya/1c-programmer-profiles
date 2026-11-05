# Контракт seed JSON

Файл: `seed/data.json`. Идентификаторы стабильные (slug), не автоинкремент.

```json
{
  "jobs": [
    {
      "id": "junior",
      "name": "Младший программист",
      "rankOrder": 20,
      "lane": "executor",
      "yearsRequired": 1,
      "professionalStandard": "06.001"
    }
  ],
  "transitions": [
    { "fromJobId": "intern", "toJobId": "junior", "kind": "linear" }
  ],
  "competencies": [
    {
      "id": "comp-vladenie-sredstvami-razrabotki-i-administrirovaniya-platformy-1s-8-3",
      "name": "Владение средствами разработки и администрирования Платформы 1С 8.3",
      "description": null,
      "type": "professional",
      "parentId": "group-platform"
    }
  ],
  "profiles": [
    {
      "jobId": "junior",
      "skills": [
        {
          "competencyId": "comp-vladenie-sredstvami-razrabotki-i-administrirovaniya-platformy-1s-8-3",
          "level": 1,
          "criteria": "Для чего нужны программы 1С; …",
          "sortOrder": 0
        }
      ]
    }
  ]
}
```

Каталог достижений лежит отдельно: `seed/achievements.json` (ADR 0010).

```json
{
  "achievements": [
    {
      "id": "idp-first-step",
      "title": "Первый шаг",
      "description": "Первая строка ИПР принята руководителем.",
      "category": "idp",
      "rule": "idp.first-accepted-item",
      "ruleParam": null,
      "icon": "flag"
    }
  ]
}
```

## Перечисления

- `lane`: `executor` | `manager` | `other`
- `kind`: `linear` | `level_change`
- `type`: `professional` | `universal` | `duty`
- `category` достижения: `idp` | `competency` | `career` | `mentoring` | `contribution`
- `rule` достижения: `manual` или ключ автоматического правила из `src/lib/achievement-catalog.ts`
- `level`: `1` | `2` | `3` или `null`. Шкала: 1 базовый — делает по образцу на типовых задачах, работу проверяют; 2 уверенный — самостоятельно на боевых задачах обычной сложности; 3 эксперт — нестандартные случаи, задаёт стандарт отдела, проверяет других.

## Правила

- `unique(jobs.id)`, `unique(jobs.name)`
- `unique(fromJobId, toJobId)`, `fromJobId != toJobId`
- `parentId` только корень (глубина ≤ 1), `unique(parentId, name)` среди компетенций
- `type` родителя и потомка совпадают
- Профиль только если в `profiles[]` есть объект с этим `jobId`
- Для `duty` `level` всегда `null`. Для `professional` / `universal` в seed всегда `1`/`2`/`3`. Админка может сохранить `null` у ещё не размеченной строки; генератор такие строки в seed не пишет
- Каталог достижений: ровно 30 записей, `unique(id)`, `unique(title)`, непустые `title` и `description`
- `ruleParam` заполнен только у `job.assigned` и ссылается на `id` должности из `data.json`; у остальных правил `null`
- `icon` — имя глифа из общего набора `src/components/skill-icons.tsx`; список допустимых — в `src/lib/achievement-catalog.ts`
- Правка каталога админом seed не перезаписывает: seed только добавляет недостающие ключи
- Фикстура одного профиля: `seed/fixtures/junior.json` (подмножество `data.json`)
- `extract_drawio.py` не перезаписывает `jobs` и `transitions`, если `seed/data.json` уже есть; профили, которых нет в drawio (сейчас `architect`, `team-lead`), переносит из существующего JSON. Граф карьеры правится в JSON, не в генераторе
- Одна компетенция на все грейды: различие грейдов живёт в `level` и `criteria`, а не в названии. Разные названия одной сущности на схемах сведены картой `CANONICAL_COMPETENCIES` в `extract_drawio.py`
- Уровни заданы матрицей `LEVEL_MATRIX` в `extract_drawio.py` (компетенция × пять грейдов). Матрица — единственный источник уровней для лестницы: значение `None` означает, что компетенции нет в профиле этого грейда. Для профилей вне drawio (`architect`, `team-lead`) уровни лежат в `PROFILE_LEVELS` того же файла. После сборки генератор сверяет строки профилей с этими таблицами и падает при расхождении
- Исходные `.drawio` в репозитории не хранятся (`tmp/` в gitignore), поэтому источник правды по содержимому профилей — `seed/data.json`. Генератор актуален лишь как воспроизводимая запись разбора: при повторном запуске ему нужны исходные `.drawio` в `tmp/drawio/`
- После смены id компетенций или состава профилей локально обязателен `npm run db:seed`. Живая база сервера JSON сама не читает. Чтобы перезаписать на ней компетенции и профили, не стирая сотрудников и планы, — `npm run db:sync-catalog -- <файл базы>` или обновление с ключом `-SyncCatalog`
