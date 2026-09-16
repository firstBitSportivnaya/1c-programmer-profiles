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

LEVEL_BY_JOB = {"intern": 1, "junior": 1, "programmer": 2, "senior": 2, "lead": 3}

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
    default_level = LEVEL_BY_JOB[job_id]

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
        competencies.append(
            {
                "id": cid,
                "name": c["value"].replace("\n", " "),
                "description": None,
                "type": typ,
                "parentId": parent,
            }
        )
        level = None if typ == "duty" else default_level
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
        {"id": "architect", "name": "Системный архитектор", "rankOrder": 60, "lane": "other", "yearsRequired": None, "professionalStandard": None},
        {"id": "team-lead", "name": "Руководитель команды разработки", "rankOrder": 65, "lane": "manager", "yearsRequired": None, "professionalStandard": None},
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
        {"fromJobId": "lead", "toJobId": "team-lead", "kind": "linear"},
        {"fromJobId": "consultant", "toJobId": "team-lead", "kind": "level_change"},
        {"fromJobId": "team-lead", "toJobId": "pm", "kind": "linear"},
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

    data = {
        "jobs": jobs,
        "transitions": transitions,
        "competencies": list(catalog.values()),
        "profiles": profiles,
    }
    (OUT / "data.json").write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    junior_profile = next(p for p in profiles if p["jobId"] == "junior")
    junior_comp_ids = {s["competencyId"] for s in junior_profile["skills"]}
    junior = {
        "jobs": [j for j in jobs if j["id"] == "junior"],
        "transitions": [],
        "competencies": [c for c in data["competencies"] if c["id"] in junior_comp_ids or c["id"].startswith("group-")],
        "profiles": [junior_profile],
    }
    (OUT / "fixtures" / "junior.json").write_text(json.dumps(junior, ensure_ascii=False, indent=2), encoding="utf-8")
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
