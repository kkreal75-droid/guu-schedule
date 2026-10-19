"""
Следит за расписанием 1 курса на guu.ru и пересобирает schedule.json через parser.py.

Запуск:
  python update.py           → скачать файл; если его содержимое изменилось — пересобрать
  python update.py --force   → пересобрать, даже если SHA-256 файла тот же

Как работает:
  1. открывает https://guu.ru/student/schedule/ и ищет ссылку «1 курс бакалавриат ОФО»;
  2. скачивает файл и сравнивает его SHA-256 с source_sha256 из schedule.json — так видно
     и новую ссылку («...-142.xlsx»), и замену файла под тем же именем;
  3. если файл другой — запускает parser.py во временной папке и проверяет результат:
     у каждой группы (МБ(МП) 1-1 и 1-2) не меньше MIN_LESSONS занятий. Если нет — ошибка,
     schedule.json не трогаем (в GitHub Actions это красный запуск и письмо);
  4. записывает schedule.json и data/raw/k1.xlsx, только если пары реально изменились.
     В schedule.json кроме данных parser.py кладёт:
       updated_at    — время проверки, которая нашла изменение (по Москве),
       source_file   — имя файла ГУУ,
       source_sha256 — его SHA-256, с ним сравниваем при следующем запуске;
  5. проверяет, что ручные правки из overrides.json всё ещё к чему-то относятся.

Код выхода: 0 — всё в порядке (обновилось или нет), 1 — ошибка: сайт недоступен, ссылка
не найдена, вместо xlsx пришло что-то другое, парсер не справился или занятий слишком мало.
В GitHub Actions пишет changed=true|false и message=... в $GITHUB_OUTPUT.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import re
import ssl
import subprocess
import sys
import tempfile
import time
import zlib
from collections import Counter
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, unquote, urljoin
from urllib.request import Request, urlopen

from parser import GROUPS, WEEKDAYS, parse_weeks

ROOT = Path(__file__).resolve().parent
PAGE_URL = "https://guu.ru/student/schedule/"
LINK_TEXT = "1 курс бакалавриат ОФО"

RAW_FILE = ROOT / "data" / "raw" / "k1.xlsx"
SCHEDULE_FILE = ROOT / "schedule.json"
OVERRIDES_FILE = ROOT / "overrides.json"

# защита от поломки: меньше — значит, структура таблицы поменялась и парсер не нашёл пары
MIN_LESSONS = 30
DATA_KEYS = ("semester_start", "groups", "lessons")  # то, что пишет parser.py

# без слова «bot»: guu.ru отвечает 403 на такие User-Agent
USER_AGENT = "guu-schedule-updater/1.0 (+https://github.com)"
MSK = timezone(timedelta(hours=3))


class UpdateError(Exception):
    pass


def annotate(level: str, message: str) -> None:
    """В GitHub Actions — ещё и аннотация: видна в сводке запуска, а не только в логе."""
    if os.environ.get("GITHUB_ACTIONS"):
        escaped = message.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
        print(f"::{level} title=update.py::{escaped}")


def warn(message: str) -> None:
    print(f"⚠ {message}")
    annotate("warning", message)


# ---------- сеть ----------

def ssl_context() -> ssl.SSLContext:
    # Python с python.org на macOS не видит системные сертификаты — берём certifi, если он есть
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


SSL_CONTEXT = ssl_context()


def to_ascii_url(url: str) -> str:
    """Ссылки на guu.ru бывают с кириллицей — urllib нужен percent-encoding."""
    return quote(url, safe=":/?#[]@!$&'()*+,;=%")


def decompress(body: bytes, encoding: str | None) -> bytes:
    # guu.ru присылает gzip, даже если клиент об этом не просил, а urllib сам не распаковывает
    if encoding == "gzip":
        return gzip.decompress(body)
    if encoding == "deflate":
        return zlib.decompress(body)
    return body


def fetch(url: str, method: str = "GET", attempts: int = 3) -> tuple[dict[str, str], bytes]:
    for attempt in range(1, attempts + 1):
        try:
            req = Request(to_ascii_url(url), method=method,
                          headers={"User-Agent": USER_AGENT, "Accept-Encoding": "gzip, deflate"})
            with urlopen(req, timeout=60, context=SSL_CONTEXT) as resp:
                headers = {k.lower(): v for k, v in resp.headers.items()}
                if method != "GET":
                    return headers, b""
                return headers, decompress(resp.read(), headers.get("content-encoding"))
        except HTTPError as e:
            if e.code < 500 or attempt == attempts:
                raise UpdateError(f"{method} {unquote(url)}: HTTP {e.code}") from e
        except (URLError, TimeoutError, ConnectionError) as e:
            if attempt == attempts:
                raise UpdateError(f"{method} {unquote(url)}: {e}") from e
        time.sleep(5 * attempt)
    raise AssertionError("unreachable")


# ---------- поиск ссылки ----------

def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().lower()


class LinkCollector(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[tuple[str, str]] = []  # (текст, href)
        self._href: str | None = None
        self._text: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self._href = dict(attrs).get("href")
            self._text = []

    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag == "a" and self._href is not None:
            self.links.append((normalize("".join(self._text)), self._href))
            self._href = None


def find_schedule_link(html: str) -> str:
    collector = LinkCollector()
    collector.feed(html)
    matches = [href for text, href in collector.links if text == normalize(LINK_TEXT)]
    if not matches:
        similar = sorted({text for text, _ in collector.links if "курс" in text})
        raise UpdateError(
            f"на {PAGE_URL} нет ссылки «{LINK_TEXT}». Похожие: {similar or 'нет'}"
        )
    if len(set(matches)) > 1:
        warn(f"ссылок «{LINK_TEXT}» несколько, беру первую: {[unquote(m) for m in matches]}")
    return urljoin(PAGE_URL, matches[0])


# ---------- разбор и проверка ----------

def run_parser(xlsx: Path) -> dict:
    """parser.py пишет schedule.json в текущую папку — запускаем его во временной."""
    with tempfile.TemporaryDirectory() as tmp:
        proc = subprocess.run(
            [sys.executable, str(ROOT / "parser.py"), str(xlsx)],
            cwd=tmp, capture_output=True, text=True,
        )
        if proc.stdout.strip():
            print(proc.stdout.rstrip())
        if proc.returncode != 0:
            raise UpdateError(f"parser.py упал:\n{proc.stderr.strip()}")
        return json.loads((Path(tmp) / "schedule.json").read_text(encoding="utf-8"))


def validate(data: dict) -> None:
    """Обе группы на месте и у каждой достаточно занятий — иначе старое расписание не трогаем."""
    counts = Counter(lesson["group"] for lesson in data["lessons"])
    print("Занятий по группам: " + ", ".join(f"{g} — {counts[g]}" for g in GROUPS))
    short = [f"{g}: {counts[g]}" for g in GROUPS if counts[g] < MIN_LESSONS]
    if short:
        raise UpdateError(
            f"в новом файле слишком мало занятий ({'; '.join(short)}; нужно не меньше {MIN_LESSONS}) — "
            "похоже, поменялась структура таблицы. schedule.json не перезаписан"
        )


def lesson_key(lesson: dict) -> tuple:
    return (lesson["group"], lesson["weekday"], lesson["start"], lesson["subject"],
            lesson["kind"], lesson["teacher"], lesson["room"], tuple(lesson["weeks"]))


def format_weeks(weeks: list[int]) -> str:
    parts, i = [], 0
    while i < len(weeks):
        j = i
        while j + 1 < len(weeks) and weeks[j + 1] == weeks[j] + 1:
            j += 1
        parts.append(str(weeks[i]) if i == j else f"{weeks[i]}-{weeks[j]}")
        i = j + 1
    return ",".join(parts)


def format_lesson(key: tuple) -> str:
    group, weekday, start, subject, kind, teacher, room, weeks = key
    extra = " ".join(x for x in (kind, teacher, room) if x)
    return f"{group}, {WEEKDAYS[weekday].lower()} {start} {subject} ({extra}) нед. {format_weeks(list(weeks))}"


def describe_changes(old: dict | None, new: dict) -> tuple[int, int]:
    old_keys = Counter(map(lesson_key, old["lessons"])) if old else Counter()
    new_keys = Counter(map(lesson_key, new["lessons"]))
    added, removed = new_keys - old_keys, old_keys - new_keys
    for key in list(removed.elements())[:15]:
        print("  −", format_lesson(key))
    for key in list(added.elements())[:15]:
        print("  +", format_lesson(key))
    return sum(added.values()), sum(removed.values())


def override_weeks(spec) -> set[int]:
    return set(spec) if isinstance(spec, list) else set(parse_weeks(str(spec)))


def check_overrides(data: dict) -> None:
    """Ручные правки привязаны к файлу ГУУ: если файл поменялся, они могут устареть."""
    if not OVERRIDES_FILE.exists():
        return
    overrides = json.loads(OVERRIDES_FILE.read_text(encoding="utf-8"))
    lessons = [dict(lesson) for lesson in data["lessons"]]

    def hits(rule: dict, lesson: dict) -> bool:
        return (lesson["group"] == rule["group"] and lesson["weekday"] == rule["weekday"]
                and lesson["start"] == rule["start"]
                and (not rule.get("subject") or lesson["subject"] == rule["subject"]))

    for rule in overrides.get("remove", []):
        if not any(hits(rule, lesson) for lesson in lessons):
            warn(f"overrides.json: remove «{rule.get('subject', '')}» {rule['group']}, "
                 f"{WEEKDAYS[rule['weekday']].lower()} {rule['start']} — такой пары в файле ГУУ больше нет")
        drop = override_weeks(rule["weeks"]) if "weeks" in rule else None
        for lesson in lessons:
            if hits(rule, lesson):
                lesson["weeks"] = [w for w in lesson["weeks"] if drop is not None and w not in drop]

    for rule in overrides.get("add", []):
        weeks = override_weeks(rule["weeks"])
        for lesson in lessons:
            if hits({**rule, "subject": None}, lesson) and weeks & set(lesson["weeks"]):
                warn(f"overrides.json: add «{rule['subject']}» {rule['group']}, "
                     f"{WEEKDAYS[rule['weekday']].lower()} {rule['start']} пересекается с «{lesson['subject']}» "
                     f"из файла ГУУ — возможно, правка уже не нужна")
                break


# ---------- файлы ----------

def load_json(path: Path) -> dict | None:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def write_atomic(path: Path, content: bytes) -> None:
    """Сначала во временный файл, потом подмена: оборванная запись не оставит битый файл."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_bytes(content)
    os.replace(tmp, path)


def lessons_data(schedule: dict | None) -> dict | None:
    return {key: schedule.get(key) for key in DATA_KEYS} if schedule else None


def github_output(**values: str) -> None:
    path = os.environ.get("GITHUB_OUTPUT")
    if path:
        with open(path, "a", encoding="utf-8") as f:
            for key, value in values.items():
                # значение приходит в том числе из имени файла на guu.ru: перевод строки
                # позволил бы дописать в $GITHUB_OUTPUT свои ключи
                safe = re.sub(r"[\r\n]+", " ", value)[:200]
                f.write(f"{key}={safe}\n")


# ---------- главное ----------

def update(force: bool) -> tuple[bool, str]:
    """Возвращает (изменился ли schedule.json, имя файла ГУУ)."""
    current = load_json(SCHEDULE_FILE)

    _, page = fetch(PAGE_URL)
    url = find_schedule_link(page.decode("utf-8", errors="replace"))
    source_file = unquote(url.rsplit("/", 1)[-1])
    print(f"Ссылка «{LINK_TEXT}»: {unquote(url)}")

    headers, content = fetch(url)
    if not content.startswith(b"PK"):  # xlsx — это zip
        raise UpdateError(f"по ссылке пришёл не xlsx ({headers.get('content-type')}, {len(content)} байт)")
    sha = hashlib.sha256(content).hexdigest()
    old_sha = (current or {}).get("source_sha256")
    print(f"SHA-256 файла: {sha[:16]}…  в schedule.json: {old_sha[:16] + '…' if old_sha else 'нет'}")

    if sha == old_sha and not force:
        print("Содержимое файла не изменилось — расписание то же.")
        return False, source_file

    with tempfile.TemporaryDirectory() as tmp:
        xlsx = Path(tmp) / "k1.xlsx"
        xlsx.write_bytes(content)
        data = run_parser(xlsx)
    validate(data)
    check_overrides(data)

    if old_sha and lessons_data(current) == lessons_data(data):
        # пары наших групп те же (поменялось что-то у других направлений) — не коммитим зря;
        # в следующий час файл просто разберём заново, это пара секунд
        reason = "Пересобрал по --force" if sha == old_sha else "Файл ГУУ изменился"
        print(f"{reason}, но пары МБ(МП) те же — schedule.json не трогаю.")
        return False, source_file

    added, removed = describe_changes(current, data)
    schedule = {
        "updated_at": datetime.now(MSK).isoformat(timespec="seconds"),
        "source_file": source_file,
        "source_sha256": sha,
        **lessons_data(data),
    }
    write_atomic(SCHEDULE_FILE, (json.dumps(schedule, ensure_ascii=False, indent=1) + "\n").encode("utf-8"))
    write_atomic(RAW_FILE, content)
    print(f"schedule.json обновлён: +{added} / −{removed} записей, всего {len(data['lessons'])}.")
    return True, source_file


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--force", action="store_true", help="пересобрать, даже если SHA-256 файла не изменился")
    args = ap.parse_args()
    try:
        changed, source_file = update(args.force)
    except UpdateError as e:
        print(f"✖ {e}", file=sys.stderr)
        annotate("error", str(e))
        github_output(changed="false")
        return 1
    github_output(changed=str(changed).lower(), message=f"Расписание: {source_file}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
