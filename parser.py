"""
Парсер расписания ГУУ из официальных .xlsx (https://guu.ru/student/schedule/).

Как устроен файл:
  - один лист = институт(ы) курса;
  - строки 4-7: институт / направление / программа / № группы (подписи в колонке A);
  - дальше блоки: колонка A — день, B — время пары, C — «НЕЧЁТ.» / «ЧЁТ.»;
  - на каждую пару две строки: нечётная и чётная неделя;
  - если ячейка объединена на обе строки — пара идёт и по чётным, и по нечётным;
  - в одной ячейке может быть несколько занятий через «/» со своими неделями.

Запуск:
  python parser.py data/raw/k1.xlsx              → schedule.json
  python parser.py data/raw/k1.xlsx 2026-10-19   → плюс печать пар на эту дату
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass, asdict, field
from datetime import date, timedelta
from pathlib import Path

import openpyxl

# ---------- настройки ----------

# Какие группы вытаскиваем: имя → (подстрока программы в строке «Образовательная программа», № группы)
GROUPS = {
    "МБ(МП) 1-1": ("Международный бизнес", 1),
    "МБ(МП) 1-2": ("Международный бизнес", 2),
}

# Понедельник недели, в которую попадает 1 сентября. 1 сентября 2026 — вторник → 31 августа.
SEMESTER_START = date(2026, 8, 31)
MAX_WEEK = 18  # для пар без указанных недель (физкультура, проектное обучение)

WEEKDAYS = ["ПОНЕДЕЛЬНИК", "ВТОРНИК", "СРЕДА", "ЧЕТВЕРГ", "ПЯТНИЦА", "СУББОТА"]
KIND_NAMES = {"Л": "Лекция", "ПЗ": "Практика", "ЛР": "Лабораторная"}

# ---------- регулярки ----------

PART_SPLIT = re.compile(r"\n\s*/\s*\n")                       # «...\n/\n...» — несколько занятий в ячейке
PAREN = re.compile(r"\(\s*(Л|ПЗ|ЛР)\s*([\d,\-–\s]*?)\s*н?\s*\)")  # (ПЗ 2-16 н), (Л 17н), (ПЗ)
TEACHER = re.compile(r"[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?\s+[А-ЯЁ]\.(?:\s?[А-ЯЁ]\.)?")
ROOM = re.compile(r"\b[А-ЯЁ]{1,3}-\d{2,3}(?:/\d{2,3})?|Спортивный комплекс|Актовый зал")


@dataclass
class Lesson:
    group: str
    weekday: int          # 0 = понедельник
    start: str            # "09:00"
    end: str              # "10:30"
    subject: str
    kind: str | None      # "Лекция" / "Практика" / None
    weeks: list[int]
    teacher: str | None
    room: str | None
    raw: str = field(repr=False)  # исходный текст ячейки — для отладки


def clean(s) -> str:
    return re.sub(r"[ \t\xa0]+", " ", str(s or "")).strip()


def parse_weeks(spec: str) -> list[int]:
    """'3-11,15' → [3..11, 15]"""
    weeks: set[int] = set()
    for chunk in re.split(r"[,\s]+", spec.replace("–", "-")):
        if not chunk:
            continue
        if "-" in chunk:
            a, b = chunk.split("-", 1)
            if a.isdigit() and b.isdigit():
                weeks.update(range(int(a), int(b) + 1))
        elif chunk.isdigit():
            weeks.add(int(chunk))
    return sorted(weeks)


def parse_time(s: str) -> tuple[str, str]:
    a, b = clean(s).replace(".", ":").split("-")
    return a.zfill(5), b.zfill(5)


def parse_part(text: str) -> list[dict]:
    """Одно занятие из ячейки → одна или несколько записей (если аудитория меняется по неделям)."""
    text = clean(text.replace("\n", " "))
    if not text:
        return []
    parens = list(PAREN.finditer(text))
    teacher_m = TEACHER.search(text)
    teacher = teacher_m.group(0) if teacher_m else None

    if not parens:  # «Проектное обучение»
        rooms = ROOM.findall(text)
        return [dict(subject=text, kind=None, weeks=None, explicit=[], teacher=teacher,
                     room=rooms[0] if rooms else None)]

    subject = clean(text[: parens[0].start()])
    out = []
    for i, m in enumerate(parens):
        # аудитория ищется в тексте после этой скобки и до следующей
        tail_end = parens[i + 1].start() if i + 1 < len(parens) else len(text)
        rooms = ROOM.findall(text[m.end():tail_end])
        if not rooms and len(parens) == 1:
            rooms = ROOM.findall(text)
        out.append(dict(
            subject=subject,
            kind=KIND_NAMES.get(m.group(1)),
            weeks=parse_weeks(m.group(2)) or None,
            explicit=[int(x) for x in re.split(r"[,\s]+", m.group(2)) if x.isdigit()],
            teacher=teacher,
            room=rooms[0] if rooms else None,
        ))
    return out


def find_label_row(ws, label: str) -> int:
    for r in range(1, 30):
        if label.lower() in clean(ws.cell(r, 1).value).lower():
            return r
    raise ValueError(f"не нашёл строку «{label}» на листе {ws.title}")


def find_group_columns(ws) -> dict[str, int]:
    prog_row = find_label_row(ws, "Образовательная программа")
    num_row = find_label_row(ws, "№ учебной группы")
    found = {}
    for col in range(4, ws.max_column + 1):
        prog = clean(ws.cell(prog_row, col).value)
        num = clean(ws.cell(num_row, col).value)
        for name, (prog_sub, n) in GROUPS.items():
            if prog_sub.lower() in prog.lower() and num == str(n):
                found[name] = col
    return found


def merged_lookup(ws):
    """(row, col) → (значение верхней левой ячейки, сколько строк занимает)"""
    m = {}
    for rng in ws.merged_cells.ranges:
        top = ws.cell(rng.min_row, rng.min_col).value
        height = rng.max_row - rng.min_row + 1
        for r in range(rng.min_row, rng.max_row + 1):
            for c in range(rng.min_col, rng.max_col + 1):
                m[(r, c)] = (top, height, r == rng.min_row)
    return m


def parse_workbook(path: str | Path) -> tuple[list[Lesson], list[str]]:
    wb = openpyxl.load_workbook(path)
    lessons: list[Lesson] = []
    warnings: list[str] = []

    for ws in wb.worksheets:
        try:
            cols = find_group_columns(ws)
        except ValueError:
            continue
        if not cols:
            continue
        merged = merged_lookup(ws)
        first_row = find_label_row(ws, "День") + 1

        for group, col in cols.items():
            day_idx, time_str = None, None
            for r in range(first_row, ws.max_row + 1):
                a, b, c = (clean(ws.cell(r, i).value) for i in (1, 2, 3))
                if a.upper() in WEEKDAYS:
                    day_idx = WEEKDAYS.index(a.upper())
                if b and re.match(r"\d{1,2}\.\d{2}-\d{1,2}\.\d{2}", b):
                    time_str = b
                if day_idx is None or time_str is None or c not in ("НЕЧЁТ.", "ЧЁТ."):
                    continue

                if (r, col) in merged:
                    value, height, is_top = merged[(r, col)]
                    if not is_top:
                        continue  # уже обработали на верхней строке
                    parity = None if height >= 2 else (1 if c == "НЕЧЁТ." else 0)
                else:
                    value = ws.cell(r, col).value
                    parity = 1 if c == "НЕЧЁТ." else 0

                raw = str(value or "")
                if not clean(raw):
                    continue
                start, end = parse_time(time_str)

                for part in PART_SPLIT.split(raw):
                    for item in parse_part(part):
                        weeks = item["weeks"] or list(range(1, MAX_WEEK + 1))
                        if parity is not None:
                            # диапазон «3-13» в нечётной строке = 3,5,...,13 — это норма.
                            # Предупреждаем, только если отброшена явно названная неделя («15,16»).
                            explicit = set(item.get("explicit") or [])
                            dropped = [w for w in weeks if w % 2 != parity and w in explicit]
                            weeks = [w for w in weeks if w % 2 == parity]
                            if dropped:
                                warnings.append(
                                    f"{group} {WEEKDAYS[day_idx].lower()} {start} «{item['subject']}»: "
                                    f"недели {dropped} не совпадают с чётностью строки ({c}) — отброшены"
                                )
                        if not weeks:
                            continue
                        item.pop("explicit", None)
                        lessons.append(Lesson(group=group, weekday=day_idx, start=start, end=end,
                                              raw=clean(part.replace("\n", " ")),
                                              **{**item, "weeks": weeks}))
    return lessons, warnings


def week_number(d: date) -> int:
    return (d - SEMESTER_START).days // 7 + 1


def lessons_on(lessons: list[Lesson], group: str, d: date) -> list[Lesson]:
    w = week_number(d)
    return sorted(
        (l for l in lessons if l.group == group and l.weekday == d.weekday() and w in l.weeks),
        key=lambda l: l.start,
    )


def check_conflicts(lessons: list[Lesson]) -> list[str]:
    seen, out = {}, []
    for l in lessons:
        for w in l.weeks:
            key = (l.group, w, l.weekday, l.start)
            if key in seen and seen[key] != l.subject:
                out.append(f"{l.group}, неделя {w}, {WEEKDAYS[l.weekday].lower()} {l.start}: "
                           f"«{seen[key]}» и «{l.subject}» в одно время")
            seen[key] = l.subject
    return out


if __name__ == "__main__":
    src = sys.argv[1] if len(sys.argv) > 1 else "data/raw/k1.xlsx"
    lessons, warnings = parse_workbook(src)
    conflicts = check_conflicts(lessons)

    Path("schedule.json").write_text(json.dumps({
        "semester_start": SEMESTER_START.isoformat(),
        "groups": list(GROUPS),
        "lessons": [{k: v for k, v in asdict(l).items() if k != "raw"} for l in lessons],
    }, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"Занятий: {len(lessons)} → schedule.json")
    for msg in warnings + conflicts:
        print("⚠", msg)

    if len(sys.argv) > 2:
        d = date.fromisoformat(sys.argv[2])
        w = week_number(d)
        print(f"\n{d:%d.%m.%Y}, {WEEKDAYS[d.weekday()].lower() if d.weekday() < 6 else 'воскресенье'}, "
              f"неделя {w} ({'чётная' if w % 2 == 0 else 'нечётная'})")
        for g in GROUPS:
            print(f"\n  {g}:")
            for l in lessons_on(lessons, g, d) or []:
                print(f"    {l.start}–{l.end}  {l.subject} ({l.kind or '—'})  {l.teacher or ''}  {l.room or ''}")
