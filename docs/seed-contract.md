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
      "id": "comp-platform-basics",
      "name": "Базовое владение средствами разработки и администрирования Платформы 1С 8.3",
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
          "competencyId": "comp-platform-basics",
          "level": null,
          "criteria": "Для чего нужны программы 1С; …",
          "sortOrder": 0
        }
      ]
    }
  ]
}
```

## Перечисления

- `lane`: `executor` | `manager` | `other`
- `kind`: `linear` | `level_change`
- `type`: `professional` | `universal` | `duty`
- `level`: `1` | `2` | `3` или `null`. Для `duty` всегда `null`. Для `professional` / `universal` в текущем seed `null`: drawio хранит грейд должности, не уровень навыка.

## Правила

- `unique(jobs.id)`, `unique(jobs.name)`
- `unique(fromJobId, toJobId)`, `fromJobId != toJobId`
- `parentId` только корень (глубина ≤ 1), `unique(parentId, name)` среди компетенций
- `type` родителя и потомка совпадают
- Профиль только если в `profiles[]` есть объект с этим `jobId`
- Для `duty` `level` всегда `null`. Для `professional` / `universal` `level` необязателен (`1`/`2`/`3` или `null`)
- Фикстура одного профиля: `seed/fixtures/junior.json` (подмножество `data.json`)
- `extract_drawio.py` не перезаписывает `jobs` и `transitions`, если `seed/data.json` уже есть; граф карьеры правится в JSON, не в генераторе
