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
          "level": 1,
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
- `level`: `1` | `2` | `3` или `null` (только `duty`)

## Правила

- `unique(jobs.id)`, `unique(jobs.name)`
- `unique(fromJobId, toJobId)`, `fromJobId != toJobId`
- `parentId` только корень (глубина ≤ 1), `unique(parentId, name)` среди компетенций
- `type` родителя и потомка совпадают
- Профиль только если в `profiles[]` есть объект с этим `jobId`
- Для `professional` / `universal` `level` обязателен; для `duty` — `null`
- Фикстура одного профиля: `seed/fixtures/junior.json` (подмножество `data.json`)
