# Карта узлов OKP2 (v1)

Источник схемы: mxfile `Схема развития разработчика 1С` (Confluence page 229980177, attachment 229980175, 2022-09-01).
Профили: mxfile на странице 229982858. Четыре грейда — отдельные файлы 2026; стажёр — сжатый mxfile `Профили должностей (разработчики 1С)` (229982860, 2022). PNG не использовались.

Названия должностей — как в mxfile (дефис, без «ё» в «стажер»). Звёздочки с схемы сняты, смысл сохранён в `notes`.

Линейные рёбра схемы: `kind = linear`. Пунктир: `kind = level_change`.

## Узлы в seed

| id | name | rank_order | lane | profile | mxfile / page |
| --- | --- | --- | --- | --- | --- |
| intern | Программист-стажер | 10 | executor | yes | Профили должностей (разработчики 1С) (229982860) |
| junior | Младший программист | 20 | executor | yes | Профиль должности. Младший программист (236884941) |
| programmer | Программист | 30 | executor | yes | Профиль должности. Программист (236885371) |
| senior | Старший программист | 40 | executor | yes | Профиль должности. Старший программист (236885882) |
| lead | Ведущий программист | 50 | executor | yes | Профиль должности. Ведущий программист (236887435) |
| consultant | Программист-консультант | 45 | executor | no | scheme; примечание \*\* = аналитик / ведущий аналитик |
| mentor | Наставник | 55 | executor | no | scheme |
| devops | DevOps инженер | 55 | executor | no | scheme |
| functional-expert | Функциональный эксперт | 55 | executor | no | scheme |
| architect | Системный архитектор | 60 | other | yes | scheme + профстандарт 06.003; колонка Исполнитель / ARCHITECT |
| team-lead | Руководитель команды разработки | 65 | manager | yes | scheme TEAM LEAD + профстандарт 06.017 |
| tech-pm | Технический руководитель проектов | 66 | other | no | scheme (как в плане: ветка «другое») |
| pm | Руководитель проектов | 67 | manager | no | scheme PROJECT MANAGER |
| dept-head | Руководитель отдела | 70 | manager | no | scheme; \*\*\* = группа / департамент |
| office-head | Руководитель офиса | 80 | manager | no | scheme; \*\*\*\* = макрорегион |

Не узлы (лейблы схемы, в seed нет): JUNIOR, MIDDLE, SENIOR, HEAD, ARCHITECT, TEAM LEAD, PROJECT MANAGER, «Хочет руководить», легенда, профстандарты-плашка.

## Рёбра (подтверждены source/target в mxfile)

| from | to | kind |
| --- | --- | --- |
| intern | junior | linear |
| junior | programmer | linear |
| programmer | senior | linear |
| programmer | consultant | linear |
| senior | lead | linear |
| senior | consultant | linear |
| lead | devops | linear |
| lead | mentor | linear |
| lead | functional-expert | linear |
| lead | architect | level_change |

Рёбра к пустым контейнерам менеджерской колонки (team-lead / PM / HEAD) в mxfile без подписи на самом ребре. В seed добавлены по геометрии контейнеров (реконструкция, не source/target mxCell):

| from | to | kind |
| --- | --- | --- |
| lead | team-lead | level_change |
| lead | tech-pm | level_change |
| consultant | team-lead | level_change |
| architect | team-lead | level_change |
| team-lead | pm | linear |
| tech-pm | pm | linear |
| team-lead | dept-head | linear |
| pm | dept-head | linear |
| dept-head | office-head | linear |

Техрук проектов в mxfile сидит в контейнере TEAM LEAD вместе с руководителем команды, отдельных рёбер на сам узел нет. В данных входящие «хочет руководить» и исходящее на PM берутся с геометрии этого контейнера.

## Реквизиты из шапок профилей

| id | years_required | professional_standard |
| --- | --- | --- |
| intern | 0 | 06.001 |
| junior | 1 | 06.001 |
| programmer | 2 | 06.001 |
| senior | 3 | 06.001 |
| lead | 4 | 06.001 |
| architect | 5 | 06.003 |
| team-lead | 5 | 06.017 |
| остальные | null | null |

Стажёр: в шапке «Опыт не требуется» и «Требуемый опыт от 3 месяцев» — `yearsRequired` = 0 (поле в годах).
Junior: в шапке «Опыт от 3 месяцев» и «Требуемый опыт от 1 года» — в поле `yearsRequired` кладём требуемый опыт в годах (1).

Профиль стажёра остаётся в seed: владелец подтвердил заполнение из Confluence (композитный mxfile 2022). Заполненных профилей в v1 семь: пять грейдов из mxfile плюс архитектор и руководитель команды из профстандартов. Начальный блок платформы у стажёра (средства разработки, инструменты ИИ) добавлен вручную — в mxfile 2022 его не было, хотя обязанности стажёра уже предполагают работу в 1С.

Уровни 1–3 из drawio не извлекаются (там только грейд в шапке) и задаются матрицей `LEVEL_MATRIX` в `scripts/extract_drawio.py`, а для профилей вне схем (`architect`, `team-lead`) — таблицей `PROFILE_LEVELS` там же: у `professional` / `universal` уровень заполнен для всех строк, у `duty` всегда `null`.
