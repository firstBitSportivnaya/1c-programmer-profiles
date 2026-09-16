# -*- coding: utf-8 -*-
"""Parse OKP2 profile drawio files into seed/data.json."""
from __future__ import annotations

import base64
import html
import json
import re
import urllib.parse
import xml.etree.ElementTree as ET
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DRAWIO = ROOT / "tmp" / "confluence"
OUT = ROOT / "seed"

SECTION_TITLES = {
    "Требуемые технические навыки": "professional",
    "Требуемые личные навыки": "universal",
    "Функциональные обязанности": "duty",
}

# Drawio хранит только грейд в шапке должности. Уровни 1–3 ставит
# LEVEL_MATRIX / PROFILE_LEVELS после разбора; пустой уровень в seed запрещён.

# Drawio называет одну и ту же компетенцию по-разному на разных грейдах
# («Базовое знание языка запросов 1С» против «Знание языка запросов 1С»).
# Уровень должен жить в ProfileSkill.level, а не в имени, поэтому такие записи
# сводятся к одной канонической компетенции.
CANONICAL_COMPETENCIES = {
    "comp-bazovoe-vladenie-sredstvami-razrabotki-i-administrirovaniya-platformy-1s-8-3": {
        "id": "comp-vladenie-sredstvami-razrabotki-i-administrirovaniya-platformy-1s-8-3",
        "name": "Владение средствами разработки и администрирования Платформы 1С 8.3",
        "parentId": "group-platform",
    },
    "comp-vladenie-sredstvami-razrabotki-i-administrirovaniya-platformy-1s-8-3": {
        "id": "comp-vladenie-sredstvami-razrabotki-i-administrirovaniya-platformy-1s-8-3",
        "name": "Владение средствами разработки и администрирования Платформы 1С 8.3",
        "parentId": "group-platform",
    },
    "comp-bazovye-navyki-programmirovaniya-na-yazyke-1s": {
        "id": "comp-navyki-programmirovaniya-na-yazyke-1s",
        "name": "Навыки программирования на языке 1С",
        "parentId": "group-platform",
    },
    "comp-navyki-programmirovaniya-na-yazyke-1s": {
        "id": "comp-navyki-programmirovaniya-na-yazyke-1s",
        "name": "Навыки программирования на языке 1С",
        "parentId": "group-platform",
    },
    "comp-bazovoe-znanie-yazyka-zaprosov-1s": {
        "id": "comp-znanie-yazyka-zaprosov-1s",
        "name": "Знание языка запросов 1С",
        "parentId": "group-db",
    },
    "comp-znanie-yazyka-zaprosov-1s": {
        "id": "comp-znanie-yazyka-zaprosov-1s",
        "name": "Знание языка запросов 1С",
        "parentId": "group-db",
    },
    "comp-bazovoe-znanie-hotya-by-odnoi-tipovoi-konfiguracii": {
        "id": "comp-znanie-tipovyh-konfiguracii",
        "name": "Знание типовых конфигураций",
        "parentId": "group-platform",
    },
    "comp-znanie-neskolkih-tipovyh-konfiguracii": {
        "id": "comp-znanie-tipovyh-konfiguracii",
        "name": "Знание типовых конфигураций",
        "parentId": "group-platform",
    },
    "comp-opyt-vypolneniya-zadach-po-razrabotke-pechatnyh-form-i-ili-otchetov-na-skd": {
        "id": "comp-pechatnye-formy-i-otchety-na-skd",
        "name": "Печатные формы и отчёты на СКД",
        "parentId": "group-platform",
    },
    "comp-opyt-vypolneniya-zadach-po-razrabotke-pechatnyh-form-i-otchetov-na-skd": {
        "id": "comp-pechatnye-formy-i-otchety-na-skd",
        "name": "Печатные формы и отчёты на СКД",
        "parentId": "group-platform",
    },
    "comp-opyt-vypolneniya-zadach-po-razrabotke-slozhnyh-pechatnyh-form-i-otchetov-na-skd": {
        "id": "comp-pechatnye-formy-i-otchety-na-skd",
        "name": "Печатные формы и отчёты на СКД",
        "parentId": "group-platform",
    },
    "comp-rabota-s-sistemami-kontrolya-versii-osnovy": {
        "id": "comp-sistemy-kontrolya-versii",
        "name": "Системы контроля версий (хранилище 1С, Git)",
        "parentId": "group-devops",
    },
    "comp-rabota-s-git-osnovy": {
        "id": "comp-sistemy-kontrolya-versii",
        "name": "Системы контроля версий (хранилище 1С, Git)",
        "parentId": "group-devops",
    },
    "comp-bazovoe-znanie-oop-i-algoritmov": {
        "id": "comp-oop-i-algoritmy",
        "name": "ООП и алгоритмы",
        "parentId": None,
    },
    "comp-bazovye-znaniya-vysokourovnevogo-yazyka-programmirovaniya": {
        "id": "comp-vysokourovnevyi-yazyk-programmirovaniya",
        "name": "Высокоуровневый язык программирования (кроме 1С)",
        "parentId": None,
    },
    "comp-bazovye-znaniya-yazyka-sql": {
        "id": "comp-yazyk-sql",
        "name": "Язык SQL",
        "parentId": "group-db",
    },
}

INFOSTART_GROUPS = [
    ("group-platform", "Платформа 1С", "professional", ("платформ", "конфигурац", "метаданн", "управляем", "скд", "печатн")),
    ("group-db", "СУБД", "professional", ("запрос", "sql", "индекс", "субд", "баз данных", "блокиров")),
    ("group-integrations", "Интеграции", "professional", ("обмен", "http", "rest", "интеграц", "json", "xml")),
    ("group-devops", "DevOps", "professional", ("git", "ci/cd", "docker", "devops", "хран", "контрол верс")),
    ("group-testing", "Тестирование", "professional", ("тест", "vanessa", "отладк")),
    ("group-security", "Безопасность", "professional", ("безопасн", "rls", "прав доступа", "ролей")),
    ("group-communication", "Коммуникация", "universal", ("реч", "переписк", "этик", "взаимодейств")),
    ("group-mentoring", "Менторинг", "universal", ("наставн", "ментор", "обучен")),
    ("group-leadership", "Лидерство", "universal", ("лидер", "самостоятельн", "управлен")),
]


# Ручная разметка уровней 1–3 по грейдам: колонки — стажёр, младший,
# программист, старший, ведущий; None — компетенции нет в профиле.
# Шкала: 1 базовый (делает по образцу, работу проверяют),
# 2 уверенный (самостоятельно на боевых задачах обычной сложности),
# 3 эксперт (нестандартные случаи, задаёт стандарт, проверяет других).
# Обязанностям уровень не ставится — запрещено инвариантом.
GRADE_ORDER = ("intern", "junior", "programmer", "senior", "lead")
LEVEL_MATRIX = {
    "comp-oop-i-algoritmy": (1, None, None, None, None),
    "comp-vysokourovnevyi-yazyk-programmirovaniya": (1, None, None, None, None),
    "comp-yazyk-sql": (1, None, None, None, None),
    "comp-vladenie-sredstvami-razrabotki-i-administrirovaniya-platformy-1s-8-3": (1, 2, 2, 3, 3),
    "comp-navyki-programmirovaniya-na-yazyke-1s": (None, 1, 2, 3, 3),
    "comp-znanie-yazyka-zaprosov-1s": (None, 1, 2, 3, 3),
    "comp-opyt-raboty-s-interfeisami-v-upravlyaemom-prilozhenii": (None, 1, 2, 3, 3),
    "comp-pechatnye-formy-i-otchety-na-skd": (None, 1, 2, 3, 3),
    "comp-znanie-tipovyh-konfiguracii": (None, 1, 2, 2, 3),
    "comp-znanie-reglamenta-i-standartov-razrabotki": (None, 1, 2, 2, 3),
    "comp-instrumenty-ii": (1, 1, 2, 2, 3),
    "comp-sistemy-kontrolya-versii": (None, 1, 2, 2, 3),
    "comp-rabota-s-pravami-dostupa-i-rls": (None, None, 1, 2, 3),
    "comp-avtomatizirovannoe-testirovanie": (None, None, 1, 2, 3),
    "comp-rest-odata-http-servisy": (None, None, 1, 2, 3),
    "comp-sonarqube-staticheskii-analiz-koda": (None, None, 1, 2, 3),
    "comp-integracionnye-mehanizmy": (None, None, None, 2, 3),
    "comp-linux-krossplatformennost": (None, None, None, 1, 2),
    "comp-rabota-s-brokerami-soobschenii": (None, None, None, 1, 2),
    "comp-proektirovanie-dorabotok-konfiguracii": (None, None, None, 2, 3),
    "comp-dokumentirovanie-arhitektury": (None, None, None, None, 2),
    # темы, которых не было в схемах 2022–2026: добавлены вручную
    "comp-proizvoditelnost-zaprosov": (None, None, 1, 2, 3),
    "comp-blokirovki-i-tranzakcii": (None, None, 1, 2, 3),
    "comp-tehnologicheskii-zhurnal-i-monitoring": (None, None, 1, 2, 3),
    "comp-ci-cd-sborka-i-postavka-resheniya": (None, None, 1, 2, 3),
    "comp-personalnye-dannye-i-trebovaniya-bezopasnosti": (None, None, 1, 2, 3),
    "comp-edt-i-rabota-s-ishodnikami": (None, None, None, 1, 2),
    "comp-integracionnye-platformy-i-esb": (None, None, None, 1, 2),
    "comp-obuchaemost": (2, 2, 2, 2, 2),
    "comp-gramotnaya-pismennaya-rech": (1, 1, 2, 2, 3),
    "comp-navyki-delovoi-perepiski-i-soblyudenie-korporativnoi-etiki": (1, 1, 2, 2, 3),
    "comp-samostoyatelnost": (1, 1, 2, 3, 3),
    "comp-umenie-iskat-informaciyu-iz-tematicheskih-istochnikov": (None, 2, 2, 3, 3),
    "comp-effektivnoe-vzaimodeistvie-v-komande": (None, 1, 2, 2, 3),
    "comp-upravlenie-vremenem": (None, None, 1, 2, 3),
    "comp-kommunikabelnost": (None, None, None, 2, 3),
    "comp-upravlenie-komandoi": (None, None, None, None, 1),
    "comp-nastavnichestvo-i-peredacha-znanii": (None, None, None, 1, 2),
}

# Профили, которых в drawio нет вообще: собраны из профстандартов.
# Здесь уровень задаётся плоско, без лестницы грейдов.
PROFILE_LEVELS: dict[str, dict[str, int]] = {
    "architect": {
        "comp-vladenie-sredstvami-razrabotki-i-administrirovaniya-platformy-1s-8-3": 3,
        "comp-navyki-programmirovaniya-na-yazyke-1s": 3,
        "comp-znanie-yazyka-zaprosov-1s": 3,
        "comp-znanie-tipovyh-konfiguracii": 3,
        "comp-znanie-reglamenta-i-standartov-razrabotki": 3,
        "comp-proizvoditelnost-zaprosov": 3,
        "comp-blokirovki-i-tranzakcii": 3,
        "comp-integracionnye-mehanizmy": 3,
        "comp-rest-odata-http-servisy": 3,
        "comp-rabota-s-brokerami-soobschenii": 3,
        "comp-integracionnye-platformy-i-esb": 3,
        "comp-rabota-s-pravami-dostupa-i-rls": 3,
        "comp-personalnye-dannye-i-trebovaniya-bezopasnosti": 3,
        "comp-proektirovanie-dorabotok-konfiguracii": 3,
        "comp-dokumentirovanie-arhitektury": 3,
        "comp-sistemy-kontrolya-versii": 3,
        "comp-arhitektura-resheniya-granicy-sistem-i-konturov": 3,
        "comp-nefunkcionalnye-trebovaniya-i-sravnenie-reshenii": 3,
        "comp-model-dannyh-i-proektirovanie-registrov": 3,
        "comp-tehnologicheskii-zhurnal-i-monitoring": 2,
        "comp-linux-krossplatformennost": 2,
        "comp-edt-i-rabota-s-ishodnikami": 2,
        "comp-ci-cd-sborka-i-postavka-resheniya": 2,
        "comp-avtomatizirovannoe-testirovanie": 2,
        "comp-instrumenty-ii": 2,
        "comp-opyt-raboty-s-interfeisami-v-upravlyaemom-prilozhenii": 2,
        "comp-gramotnaya-pismennaya-rech": 3,
        "comp-navyki-delovoi-perepiski-i-soblyudenie-korporativnoi-etiki": 3,
        "comp-samostoyatelnost": 3,
        "comp-obuchaemost": 2,
        "comp-umenie-iskat-informaciyu-iz-tematicheskih-istochnikov": 3,
        "comp-effektivnoe-vzaimodeistvie-v-komande": 3,
        "comp-kommunikabelnost": 3,
        "comp-upravlenie-vremenem": 2,
        "comp-nastavnichestvo-i-peredacha-znanii": 2,
    },
    "team-lead": {
        "comp-znanie-reglamenta-i-standartov-razrabotki": 3,
        "comp-sistemy-kontrolya-versii": 3,
        "comp-ci-cd-sborka-i-postavka-resheniya": 3,
        "comp-avtomatizirovannoe-testirovanie": 3,
        "comp-personalnye-dannye-i-trebovaniya-bezopasnosti": 3,
        "comp-instrumenty-ii": 3,
        "comp-infrastruktura-kollektivnoi-razrabotki": 3,
        "comp-upravlenie-vypuskami-i-konfiguraciyami": 3,
        "comp-vladenie-sredstvami-razrabotki-i-administrirovaniya-platformy-1s-8-3": 2,
        "comp-navyki-programmirovaniya-na-yazyke-1s": 2,
        "comp-znanie-yazyka-zaprosov-1s": 2,
        "comp-znanie-tipovyh-konfiguracii": 2,
        "comp-proektirovanie-dorabotok-konfiguracii": 2,
        "comp-proizvoditelnost-zaprosov": 2,
        "comp-blokirovki-i-tranzakcii": 2,
        "comp-tehnologicheskii-zhurnal-i-monitoring": 2,
        "comp-rabota-s-pravami-dostupa-i-rls": 2,
        "comp-integracionnye-mehanizmy": 2,
        "comp-dokumentirovanie-arhitektury": 2,
        "comp-edt-i-rabota-s-ishodnikami": 2,
        "comp-upravlenie-komandoi": 3,
        "comp-nastavnichestvo-i-peredacha-znanii": 3,
        "comp-ocenka-trudoemkosti-i-planirovanie-rabot": 3,
        "comp-postanovka-zadach-i-kontrol-ispolneniya": 3,
        "comp-gramotnaya-pismennaya-rech": 3,
        "comp-navyki-delovoi-perepiski-i-soblyudenie-korporativnoi-etiki": 3,
        "comp-samostoyatelnost": 3,
        "comp-effektivnoe-vzaimodeistvie-v-komande": 3,
        "comp-kommunikabelnost": 3,
        "comp-upravlenie-vremenem": 3,
        "comp-obuchaemost": 2,
        "comp-umenie-iskat-informaciyu-iz-tematicheskih-istochnikov": 2,
    },
}


# В схемах коды трудовых функций записаны кириллицей и с лишним нулём
# («А/01.03»), в приказе Минтруда — «A/01.3». По этим кодам сверяют профиль
# с профстандартом, поэтому приводим к виду стандарта.
CYRILLIC_TO_LATIN = {"А": "A", "В": "B", "С": "C", "Е": "E", "Д": "D"}
TF_CODE_RE = re.compile(r"\(([АВСЕДABCDE])/(\d{1,2})\.0?(\d)\)")


def normalize_tf_code(name: str) -> str:
    def fix(m: re.Match[str]) -> str:
        letter = CYRILLIC_TO_LATIN.get(m.group(1), m.group(1))
        return f"({letter}/{int(m.group(2)):02d}.{m.group(3)})"

    return TF_CODE_RE.sub(fix, name)


def matrix_level(job_id: str, competency_id: str) -> int | None:
    if job_id in PROFILE_LEVELS:
        return PROFILE_LEVELS[job_id].get(competency_id)
    row = LEVEL_MATRIX.get(competency_id)
    if row is None or job_id not in GRADE_ORDER:
        return None
    return row[GRADE_ORDER.index(job_id)]


def assert_profile_levels(profiles: list[dict], catalog: dict[str, dict]) -> None:
    errors: list[str] = []
    for profile in profiles:
        job_id = profile["jobId"]
        for skill in profile["skills"]:
            cid = skill["competencyId"]
            comp = catalog.get(cid)
            if comp is None:
                errors.append(f"{job_id}/{cid}: нет в каталоге компетенций")
                continue
            typ = comp["type"]
            level = skill["level"]
            if typ == "duty":
                if level is not None:
                    errors.append(f"{job_id}/{cid}: у duty level должен быть null")
                continue
            if typ not in ("professional", "universal"):
                errors.append(f"{job_id}/{cid}: неизвестный type {typ}")
                continue
            if level not in (1, 2, 3):
                errors.append(f"{job_id}/{cid}: у {typ} level должен быть 1–3, сейчас {level}")
            expected = matrix_level(job_id, cid)
            if expected is None:
                errors.append(f"{job_id}/{cid}: нет в LEVEL_MATRIX/PROFILE_LEVELS для этого грейда")
            elif expected != level:
                errors.append(f"{job_id}/{cid}: level {level}, в таблице {expected}")
    if errors:
        raise SystemExit("сверка уровней не прошла:\n" + "\n".join(errors))


def slug(text: str) -> str:
    translit = {
        "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e",
        "ж": "zh", "з": "z", "и": "i", "й": "i", "к": "k", "л": "l", "м": "m",
        "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "t": "t", "у": "u",
        "ф": "f", "х": "h", "ц": "c", "ч": "ch", "ш": "sh", "щ": "sch",
        "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
        "т": "t",
    }
    s = text.lower().replace("ё", "е")
    out = []
    for ch in s:
        if ch in translit:
            out.append(translit[ch])
        elif ch.isalnum():
            out.append(ch)
        else:
            out.append("-")
    slug_s = re.sub(r"-+", "-", "".join(out)).strip("-")
    return slug_s[:80]


def clean_text(raw: str | None) -> str:
    if not raw:
        return ""
    t = html.unescape(raw)
    t = t.replace("&#xa;", "\n").replace("<br>", "\n").replace("<br/>", "\n")
    t = re.sub(r"<[^>]+>", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def mxfile_xml(path: Path) -> str:
    """Inflate draw.io diagrams that store mxGraphModel as deflate+base64."""
    text = path.read_text(encoding="utf-8")

    def restore(match: re.Match[str]) -> str:
        attrs, payload = match.group(1), match.group(2).strip()
        if payload.startswith("<"):
            return match.group(0)
        xml = urllib.parse.unquote(
            zlib.decompress(base64.b64decode(payload), -15).decode("utf-8")
        )
        return f"<diagram{attrs}>{xml}</diagram>"

    return re.sub(r"<diagram([^>]*)>(.*?)</diagram>", restore, text, flags=re.S)


def parse_cells(path: Path) -> list[dict]:
    tree = ET.fromstring(mxfile_xml(path))
    cells = []
    for el in tree.iter("mxCell"):
        cells.append(
            {
                "id": el.get("id"),
                "parent": el.get("parent"),
                "value": clean_text(el.get("value")),
                "style": el.get("style") or "",
                "vertex": el.get("vertex") == "1",
            }
        )
    return cells


def infostart_parent(name: str, typ: str) -> str | None:
    low = name.lower()
    for gid, _title, gtype, keys in INFOSTART_GROUPS:
        if gtype != typ:
            continue
        if any(k in low for k in keys):
            return gid
    return None


def extract_profile(path: Path, job_id: str) -> tuple[list[dict], list[dict]]:
    cells = parse_cells(path)
    by_id = {c["id"]: c for c in cells}
    children: dict[str, list[dict]] = {}
    for c in cells:
        children.setdefault(c["parent"], []).append(c)

    section_ids: dict[str, str] = {}
    for c in cells:
        if c["value"] in SECTION_TITLES and c["parent"] == "1":
            section_ids[c["id"]] = SECTION_TITLES[c["value"]]

    def section_of(cell_id: str | None) -> str | None:
        seen = set()
        while cell_id and cell_id not in seen:
            seen.add(cell_id)
            if cell_id in section_ids:
                return section_ids[cell_id]
            parent = by_id.get(cell_id, {}).get("parent")
            cell_id = parent
        return None

    competencies: list[dict] = []
    skills: list[dict] = []
    sort_i = 0

    for c in cells:
        if not c["vertex"] or not c["value"]:
            continue
        if c["value"] in SECTION_TITLES:
            continue
        if "childLayout=stackLayout" not in c["style"]:
            continue
        typ = section_of(c["id"])
        if typ is None:
            if "strokeColor=#6c8ebf" in c["style"] or "fillColor=#EFF4FC" in c["style"]:
                typ = "professional"
            elif "strokeColor=#82b366" in c["style"]:
                typ = "universal"
            else:
                continue
        kids = [
            k["value"]
            for k in children.get(c["id"], [])
            if k["value"] and "childLayout=stackLayout" not in k["style"]
        ]
        criteria = "\n".join(kids) if kids else None
        cid = "comp-" + slug(c["value"])
        parent = infostart_parent(c["value"], typ)
        name = normalize_tf_code(c["value"].replace("\n", " "))
        canon = CANONICAL_COMPETENCIES.get(cid)
        if canon:
            cid, name, parent = canon["id"], canon["name"], canon["parentId"]
        competencies.append(
            {
                "id": cid,
                "name": name,
                "description": None,
                "type": typ,
                "parentId": parent,
            }
        )
        level = None
        skills.append(
            {
                "competencyId": cid,
                "level": level,
                "criteria": criteria,
                "sortOrder": sort_i,
            }
        )
        sort_i += 1
    return competencies, skills


def main() -> None:
    OUT.mkdir(exist_ok=True)
    (OUT / "fixtures").mkdir(exist_ok=True)

    jobs = [
        {"id": "intern", "name": "Программист-стажер", "rankOrder": 10, "lane": "executor", "yearsRequired": 0, "professionalStandard": "06.001"},
        {"id": "junior", "name": "Младший программист", "rankOrder": 20, "lane": "executor", "yearsRequired": 1, "professionalStandard": "06.001"},
        {"id": "programmer", "name": "Программист", "rankOrder": 30, "lane": "executor", "yearsRequired": 2, "professionalStandard": "06.001"},
        {"id": "senior", "name": "Старший программист", "rankOrder": 40, "lane": "executor", "yearsRequired": 3, "professionalStandard": "06.001"},
        {"id": "consultant", "name": "Программист-консультант", "rankOrder": 45, "lane": "executor", "yearsRequired": None, "professionalStandard": None},
        {"id": "lead", "name": "Ведущий программист", "rankOrder": 50, "lane": "executor", "yearsRequired": 4, "professionalStandard": "06.001"},
        {"id": "mentor", "name": "Наставник", "rankOrder": 55, "lane": "executor", "yearsRequired": None, "professionalStandard": None},
        {"id": "devops", "name": "DevOps инженер", "rankOrder": 55, "lane": "executor", "yearsRequired": None, "professionalStandard": None},
        {"id": "functional-expert", "name": "Функциональный эксперт", "rankOrder": 55, "lane": "executor", "yearsRequired": None, "professionalStandard": None},
        {"id": "architect", "name": "Системный архитектор", "rankOrder": 60, "lane": "other", "yearsRequired": 5, "professionalStandard": "06.003"},
        {"id": "team-lead", "name": "Руководитель команды разработки", "rankOrder": 65, "lane": "manager", "yearsRequired": 5, "professionalStandard": "06.017"},
        {"id": "tech-pm", "name": "Технический руководитель проектов", "rankOrder": 66, "lane": "other", "yearsRequired": None, "professionalStandard": None},
        {"id": "pm", "name": "Руководитель проектов", "rankOrder": 67, "lane": "manager", "yearsRequired": None, "professionalStandard": None},
        {"id": "dept-head", "name": "Руководитель отдела", "rankOrder": 70, "lane": "manager", "yearsRequired": None, "professionalStandard": None},
        {"id": "office-head", "name": "Руководитель офиса", "rankOrder": 80, "lane": "manager", "yearsRequired": None, "professionalStandard": None},
    ]
    transitions = [
        {"fromJobId": "intern", "toJobId": "junior", "kind": "linear"},
        {"fromJobId": "junior", "toJobId": "programmer", "kind": "linear"},
        {"fromJobId": "programmer", "toJobId": "senior", "kind": "linear"},
        {"fromJobId": "programmer", "toJobId": "consultant", "kind": "linear"},
        {"fromJobId": "senior", "toJobId": "lead", "kind": "linear"},
        {"fromJobId": "senior", "toJobId": "consultant", "kind": "linear"},
        {"fromJobId": "lead", "toJobId": "devops", "kind": "linear"},
        {"fromJobId": "lead", "toJobId": "mentor", "kind": "linear"},
        {"fromJobId": "lead", "toJobId": "functional-expert", "kind": "linear"},
        {"fromJobId": "lead", "toJobId": "architect", "kind": "level_change"},
        {"fromJobId": "lead", "toJobId": "team-lead", "kind": "level_change"},
        {"fromJobId": "lead", "toJobId": "tech-pm", "kind": "level_change"},
        {"fromJobId": "consultant", "toJobId": "team-lead", "kind": "level_change"},
        {"fromJobId": "architect", "toJobId": "team-lead", "kind": "level_change"},
        {"fromJobId": "team-lead", "toJobId": "pm", "kind": "linear"},
        {"fromJobId": "tech-pm", "toJobId": "pm", "kind": "linear"},
        {"fromJobId": "team-lead", "toJobId": "dept-head", "kind": "linear"},
        {"fromJobId": "pm", "toJobId": "dept-head", "kind": "linear"},
        {"fromJobId": "dept-head", "toJobId": "office-head", "kind": "linear"},
    ]

    groups = [
        {"id": gid, "name": title, "description": None, "type": gtype, "parentId": None}
        for gid, title, gtype, _ in INFOSTART_GROUPS
    ]

    files = {
        "intern": DRAWIO / "intern.drawio",
        "junior": DRAWIO / "junior.drawio",
        "programmer": DRAWIO / "programmer.drawio",
        "senior": DRAWIO / "senior.drawio",
        "lead": DRAWIO / "lead.drawio",
    }

    catalog: dict[str, dict] = {g["id"]: g for g in groups}
    profiles = []
    for job_id, path in files.items():
        comps, skills = extract_profile(path, job_id)
        for s in skills:
            s["level"] = matrix_level(job_id, s["competencyId"])
        for s, c in zip(skills, comps):
            cid = c["id"]
            if cid in catalog and catalog[cid]["type"] != c["type"]:
                cid = cid + "-" + c["type"]
                c["id"] = cid
                s["competencyId"] = cid
            if cid not in catalog:
                catalog[cid] = c
            elif catalog[cid]["parentId"] is None and c["parentId"]:
                catalog[cid]["parentId"] = c["parentId"]
        profiles.append({"jobId": job_id, "skills": skills})

    existing_path = OUT / "data.json"
    if existing_path.exists():
        existing = json.loads(existing_path.read_text(encoding="utf-8"))
        jobs = existing.get("jobs") or jobs
        transitions = existing.get("transitions") or transitions
        # Тексты ожиданий переписаны вручную под грейды и в drawio не возвращались:
        # повторный разбор схем не должен их затирать.
        manual_criteria = {
            (p["jobId"], s["competencyId"]): s.get("criteria")
            for p in existing.get("profiles", [])
            for s in p["skills"]
        }
        for p in profiles:
            for s in p["skills"]:
                key = (p["jobId"], s["competencyId"])
                if key in manual_criteria:
                    s["criteria"] = manual_criteria[key]

        # Часть компетенций и целые профили добавлены вручную (темы и должности,
        # которых в схемах не было). Разбор drawio их не создаёт — переносим
        # из существующего файла: генератор уточняет схемы и не удаляет остальное.
        existing_rows = {
            p["jobId"]: {s["competencyId"]: s for s in p["skills"]}
            for p in existing.get("profiles", [])
        }
        generated_job_ids = {p["jobId"] for p in profiles}
        for p in profiles:
            generated = {s["competencyId"] for s in p["skills"]}
            for cid, row in existing_rows.get(p["jobId"], {}).items():
                if cid in generated:
                    continue
                p["skills"].append(
                    {
                        "competencyId": cid,
                        "level": matrix_level(p["jobId"], cid),
                        "criteria": row.get("criteria"),
                        "sortOrder": row.get("sortOrder", 999),
                    }
                )
            p["skills"].sort(key=lambda s: s["sortOrder"])
        for p in existing.get("profiles", []):
            if p["jobId"] in generated_job_ids:
                continue
            skills = [
                {
                    "competencyId": row["competencyId"],
                    "level": matrix_level(p["jobId"], row["competencyId"]),
                    "criteria": row.get("criteria"),
                    "sortOrder": row.get("sortOrder", 999),
                }
                for row in p["skills"]
            ]
            skills.sort(key=lambda s: s["sortOrder"])
            profiles.append({"jobId": p["jobId"], "skills": skills})
        for c in existing.get("competencies", []):
            catalog.setdefault(c["id"], c)

    data = {
        "jobs": jobs,
        "transitions": transitions,
        "competencies": list(catalog.values()),
        "profiles": profiles,
    }
    assert_profile_levels(profiles, catalog)
    existing_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    junior_profile = next(p for p in profiles if p["jobId"] == "junior")
    junior_comp_ids = {s["competencyId"] for s in junior_profile["skills"]}
    junior = {
        "jobs": [j for j in jobs if j["id"] == "junior"],
        "transitions": [],
        "competencies": [c for c in data["competencies"] if c["id"] in junior_comp_ids or c["id"].startswith("group-")],
        "profiles": [junior_profile],
    }
    (OUT / "fixtures" / "junior.json").write_text(
        json.dumps(junior, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(
        "jobs",
        len(jobs),
        "comps",
        len(catalog),
        "profiles",
        len(profiles),
        "intern skills",
        len(next(p for p in profiles if p["jobId"] == "intern")["skills"]),
        "junior skills",
        len(junior_profile["skills"]),
    )


if __name__ == "__main__":
    main()
