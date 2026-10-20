"""
Следит за расписанием всего ГУУ на guu.ru и пересобирает данные сайта (public/data/).

Запуск:
  python update.py           → скачать все файлы; если хоть один изменился (SHA-256) — пересобрать
  python update.py --force   → пересобрать, даже если файлы те же
  python update.py --local DIR → не ходить на guu.ru, взять файлы из папки (для проверки)

Откуда: https://guu.ru/student/schedule/ (бакалавриат ОФО 1–4, ОЗФО 1–5, магистратура, аспирантура,
.doc УМБ) и https://guu.ru/student/session/ (сессия). Разбор — guu_parser.py, логика ячеек — parser.py.
.doc переводим в .docx через LibreOffice headless (soffice); результат кэшируется в data/doc-cache/
по SHA-256 исходника, так что LibreOffice нужен, только когда сам .doc поменялся.

Что пишет (всё, что в public/, Vite кладёт на сайт как есть):
  public/data/groups.json               — все группы: id, имя, уровень, форма, курс, институт, программа
  public/data/schedule/<id>.json        — пары группы + сетка времени по дням
  public/data/teachers.json             — преподаватели: дисциплины, группы
  public/data/teachers/<id>.json        — пары преподавателя (с группами)
  public/data/rooms.json                — аудитория → когда занята
  public/data/session/<id>.json         — сессия группы (только текущего учебного года)
  public/data/parse_report.json         — что разобрано по каждому файлу и листу, где парсер не уверен
  public/data/alerts.json               — тревоги для владельца (бот присылает их в личку)
  schedule.json                         — как раньше: только МБ(МП) 1-1 и 1-2 (для старых версий приложения)
  data/state.json, data/group_ids.json  — SHA файлов, число групп; реестр id групп (id не меняются)

Защита: если в файле групп стало на 10% меньше, чем в прошлый раз, или у МБ(МП) 1-1/1-2 меньше
MIN_LESSONS пар — файл не публикуем (остаются прошлые данные его групп), владельцу — тревога.

Ручные правки сюда не попадают: overrides.json и замены дней (overrides/thursday*.json) накладываются
поверх при показе (shared/schedule-core.ts), автообновление их не стирает.

Код выхода: 0 — всё в порядке (обновилось или нет), 1 — сайт ГУУ недоступен или ссылок нет вовсе.
В GitHub Actions пишет changed=true|false, message=..., need_soffice=true|false в $GITHUB_OUTPUT.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import re
import shutil
import ssl
import subprocess
import sys
import tempfile
import time
import zlib
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, unquote, urljoin
from urllib.request import Request, urlopen

import guu_parser as gp
from parser import SEMESTER_START, WEEKDAYS, parse_weeks

ROOT = Path(__file__).resolve().parent
PAGES = {"schedule": "https://guu.ru/student/schedule/", "session": "https://guu.ru/student/session/"}
FILE_TYPES = (".xlsx", ".doc", ".docx")

OUT = ROOT / "public" / "data"
STATE_FILE = ROOT / "data" / "state.json"
IDS_FILE = ROOT / "data" / "group_ids.json"
DOC_CACHE = ROOT / "data" / "doc-cache"
LEGACY_FILE = ROOT / "schedule.json"
OVERRIDES_FILE = ROOT / "overrides.json"

# МБ(МП) 1-1 и 1-2 — с них всё начиналось: их id и имена не меняем, в schedule.json — только они
LEGACY_GROUPS = {"МБ(МП) 1-1": "b1-mb-mp-1", "МБ(МП) 1-2": "b1-mb-mp-2"}
MIN_LESSONS = 30  # у каждой из них меньше — структура файла поменялась, его не публикуем
MAX_DROP = 0.10  # групп в файле стало меньше больше чем на 10% — не публикуем

# без слова «bot»: guu.ru отвечает 403 на такие User-Agent
USER_AGENT = "guu-schedule-updater/2.0 (+https://github.com)"
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


# ---------- ссылки на странице ----------

def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().lower()


SECTIONS = ("бакалавриат", "магистратура", "аспирантура")


class LinkCollector(HTMLParser):
    """Ссылки на файлы вместе с разделом страницы («Бакалавриат», «Магистратура», «Аспирантура»)."""

    def __init__(self) -> None:
        super().__init__()
        self.links: list[tuple[str, str, str | None]] = []  # (текст, href, раздел)
        self._href: str | None = None
        self._text: list[str] = []
        self._section: str | None = None

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self._href = dict(attrs).get("href")
            self._text = []

    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)
        elif normalize(data) in SECTIONS:
            self._section = normalize(data)

    def handle_endtag(self, tag):
        if tag == "a" and self._href is not None:
            self.links.append((normalize("".join(self._text)), self._href, self._section))
            self._href = None


@dataclass
class Source:
    kind: str  # schedule / session
    url: str
    name: str  # имя файла ГУУ
    text: str  # текст ссылки (бывает пустым)
    section: str | None

    @property
    def key(self) -> str:
        """Ключ источника между версиями: имя файла меняется («…-141.xlsx» → «…-142.xlsx»), текст ссылки — нет."""
        base = self.text or re.sub(r"(-\d+)?\.(xlsx|docx?|pdf)$", "", self.name.lower())
        return f"{self.kind}:{normalize(base)}"

    @property
    def meta(self) -> gp.FileMeta:
        return gp.FileMeta(name=self.name, text=self.text, section=self.section)


def find_sources() -> list[Source]:
    sources, seen = [], set()
    for kind, page in PAGES.items():
        _, html = fetch(page)
        collector = LinkCollector()
        collector.feed(html.decode("utf-8", errors="replace"))
        for text, href, section in collector.links:
            if not href or not href.lower().endswith(FILE_TYPES):
                continue
            url = urljoin(page, href)
            if url in seen:
                continue  # одна ссылка дважды (картинка + текст)
            seen.add(url)
            # у дубля ссылки текст бывает пустым — берём непустой
            text = text or next((t for t, h, _ in collector.links if urljoin(page, h or "") == url and t), "")
            sources.append(Source(kind, url, unquote(url.rsplit("/", 1)[-1]), text, section))
    if not any(s.kind == "schedule" for s in sources):
        raise UpdateError(f"на {PAGES['schedule']} нет ни одной ссылки на файл расписания")
    return sources


def local_sources(folder: Path) -> list[Source]:
    """--local: файлы из папки, текст ссылки и раздел — по имени файла."""
    out = []
    for p in sorted(folder.iterdir()):
        if p.suffix.lower() not in FILE_TYPES:
            continue
        low = p.name.lower()
        kind = "session" if ("сесси" in low) else "schedule"
        section = "аспирантура" if low.startswith("расписание") else ("магистратура" if "магистр" in low else "бакалавриат")
        text = re.sub(r"[-_]", " ", re.sub(r"(-\d+)?\.(xlsx|docx?)$", "", p.name, flags=re.I))
        out.append(Source(kind, p.as_uri(), p.name, normalize(text), section))
    return out


# ---------- файлы ----------

def load_json(path: Path, default=None):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def dump(data) -> bytes:
    return (json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


def dump_pretty(data) -> bytes:
    return (json.dumps(data, ensure_ascii=False, indent=1) + "\n").encode("utf-8")


class Writer:
    """Пишет файл, только если содержимое поменялось (меньше шума в git); считает изменения."""

    def __init__(self) -> None:
        self.changed: list[Path] = []
        self.kept: set[Path] = set()

    def write(self, path: Path, content: bytes) -> None:
        self.kept.add(path)
        if path.exists() and path.read_bytes() == content:
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(path.name + ".tmp")
        tmp.write_bytes(content)
        os.replace(tmp, path)  # оборванная запись не оставит битый файл
        self.changed.append(path)

    def prune(self, folder: Path) -> None:
        """Удаляет из папки файлы, которые в этот раз не записывались (группы больше нет)."""
        if not folder.exists():
            return
        for p in folder.glob("*.json"):
            if p not in self.kept:
                p.unlink()
                self.changed.append(p)


def github_output(**values: str) -> None:
    path = os.environ.get("GITHUB_OUTPUT")
    if path:
        with open(path, "a", encoding="utf-8") as f:
            for key, value in values.items():
                # значение приходит в том числе из имени файла на guu.ru: перевод строки
                # позволил бы дописать в $GITHUB_OUTPUT свои ключи
                safe = re.sub(r"[\r\n]+", " ", value)[:200]
                f.write(f"{key}={safe}\n")


# ---------- .doc → .docx ----------

def find_soffice() -> str | None:
    for candidate in (os.environ.get("SOFFICE"), shutil.which("soffice"), shutil.which("libreoffice"),
                      "/Applications/LibreOffice.app/Contents/MacOS/soffice"):
        if candidate and Path(candidate).exists():
            return candidate
    return None


def doc_to_docx(content: bytes, sha: str) -> Path | None:
    """Кэш по SHA-256: LibreOffice нужен, только если этот .doc ещё не переводили."""
    cached = DOC_CACHE / f"{sha}.docx"
    if cached.exists():
        return cached
    soffice = find_soffice()
    if not soffice:
        return None
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "source.doc"
        src.write_bytes(content)
        proc = subprocess.run(
            [soffice, "--headless", "--norestore", f"-env:UserInstallation=file://{tmp}/profile",
             "--convert-to", "docx", "--outdir", tmp, str(src)],
            capture_output=True, text=True, timeout=180,
        )
        out = Path(tmp) / "source.docx"
        if proc.returncode != 0 or not out.exists():
            raise UpdateError(f"LibreOffice не перевёл .doc в .docx: {proc.stderr.strip()[:300]}")
        DOC_CACHE.mkdir(parents=True, exist_ok=True)
        shutil.copy(out, cached)
    return cached


# ---------- id и имена групп ----------

TRANSLIT = dict(zip("абвгдеёжзийклмнопрстуфхцчшщъыьэюя",
                    ["a", "b", "v", "g", "d", "e", "e", "zh", "z", "i", "y", "k", "l", "m", "n", "o", "p", "r", "s",
                     "t", "u", "f", "h", "c", "ch", "sh", "sch", "", "y", "", "e", "yu", "ya"]))


def slug(text: str) -> str:
    out = "".join(TRANSLIT.get(ch, ch) for ch in text.lower())
    return re.sub(r"[^a-z0-9]+", "-", out).strip("-")


STOP = {"и", "в", "во", "с", "со", "на", "по", "для", "к", "о", "об", "от", "из", "при", "а", "или"}
QUALIFIERS = {"международная программа": "МП", "с применением дот": "ДОТ", "с дот": "ДОТ",
              "на английском языке": "англ.", "г. иваново": "Иваново", "сетевая программа": "СП"}


def acronym(program: str, long: bool = False) -> str:
    """«Международный бизнес (международная программа)» → «МБ(МП)», «Экономика» → «Экономика».
    long — с союзами и предлогами строчными, как в «ИУПСиБК»: чтобы различить «СиПУ» и «СПвУ»."""
    text = program.replace("ё", "е").replace("Ё", "Е")
    quals = re.findall(r"\(([^)]*)\)", text)
    main = re.sub(r"\([^)]*\)", " ", text)
    parts = re.split(r"\s+[-–—]\s+", main)
    main, quals = parts[0], [p for p in parts[1:]] + quals
    all_words = re.findall(r"[A-Za-zА-Яа-я]+(?:-[A-Za-zА-Яа-я]+)*\.?", main)
    words = [w for w in all_words if w.lower() not in STOP]
    if len(words) == 1 and "-" not in words[0]:
        acr = words[0][:1].upper() + words[0][1:]
    else:
        letters = []
        for w in (all_words if long else words):
            if w.lower() in STOP:
                letters.append(w[0].lower())
                continue
            for piece in w.rstrip(".").split("-"):
                letters.append(piece if piece.isupper() and len(piece) <= 3 else piece[:1].upper())
        acr = "".join(letters)[: 8 if long else 6]
    for q in quals:
        qn = normalize(q)
        short = QUALIFIERS.get(qn)
        if not short:
            qw = [w for w in re.findall(r"[А-Яа-яA-Za-z]+", q) if w.lower() not in STOP]
            short = "".join(w[0].upper() for w in qw)[:4] if len(qw) > 1 else (qw[0] if qw else "")
        if short:
            acr += f"({short})"
    return acr


def program_key(program: str) -> str:
    return re.sub(r"[^a-zа-я0-9]", "", program.lower().replace("ё", "е"))


def group_key(info: gp.GroupInfo) -> str:
    return "|".join([info.level, info.form, str(info.course), info.institute, program_key(info.program), info.number])


def base_name(info: gp.GroupInfo, long: bool = False) -> str:
    if info.level == "postgrad":
        code = info.direction.split()[0]
        sub = f" {acronym(info.program, long)}" if info.program != info.direction else ""
        return f"{code}{sub} · асп. {info.course} к."
    name = f"{acronym(info.program, long)} {info.course}-{info.number}"
    if info.level == "master":
        name += " маг."
    elif info.form == "ozfo":
        name += " ОЗФО"
    return name


def assign_ids(infos: list[gp.GroupInfo], registry: dict[str, str]) -> dict[str, str]:
    """key → id. Однажды выданный id не меняется (реестр data/group_ids.json)."""
    taken = set(registry.values())
    for info in infos:
        key = group_key(info)
        if key in registry:
            continue
        name = base_name(info)
        legacy = LEGACY_GROUPS.get(name) if info.level == "bachelor" and info.form == "ofo" else None
        prefix = {"bachelor": "z" if info.form == "ozfo" else "b", "master": "m", "postgrad": "a"}[info.level]
        if info.level == "postgrad":
            base = f"a{info.course}-{slug(info.direction.split()[0])}"
            if info.program != info.direction:
                base += f"-{slug(acronym(info.program))}"
        else:
            base = f"{prefix}{info.course}-{slug(acronym(info.program))}-{info.number}"
        candidate = legacy or base
        if candidate in taken and info.level != "postgrad":
            candidate = f"{prefix}{info.course}-{slug(acronym(info.program, long=True))}-{info.number}"
        if candidate in taken:
            candidate = f"{base}-{slug(info.institute)}"
        if candidate in taken:
            candidate = f"{base}-{hashlib.sha1(key.encode()).hexdigest()[:4]}"
        registry[key] = candidate
        taken.add(candidate)
    return registry


def entry_info(e: dict) -> gp.GroupInfo:
    return gp.GroupInfo(e["level"], e["form"], e["course"], e["institute"], "", e["direction"], e["program"],
                        e["number"], "")


def unique_names(entries: list[dict]) -> None:
    """Одинаковые имена (у разных программ одна аббревиатура): сначала аббревиатура с союзами
    («СиПУ» / «СПвУ»), потом — с институтом, а дальше — с номером."""
    by_name = defaultdict(list)
    for e in entries:
        by_name[e["name"]].append(e)
    for name, same in by_name.items():
        if len(same) < 2:
            continue
        longer = [base_name(entry_info(e), long=True) for e in same]
        if len(set(longer)) == len(same):
            for e, n in zip(same, longer):
                e["name"] = n
        elif len({e["institute"] for e in same}) == len(same):
            for e in same:
                e["name"] = f"{name} · {e['institute']}"
        else:
            for i, e in enumerate(sorted(same, key=lambda e: e["program"]), 1):
                e["name"] = f"{name} ({i})"


# ---------- преподаватели и аудитории ----------

def teacher_id(name: str) -> str:
    return slug(name)


def weeks_mask(weeks: list[int]) -> int:
    mask = 0
    for w in weeks:
        if 1 <= w <= 52:
            mask |= 1 << w
    return mask


ROOM_PREFIX = re.compile(r"^([А-ЯЁ]{1,3})-")


# ---------- главное ----------

def academic_year_now() -> str:
    y = SEMESTER_START.year if SEMESTER_START.month >= 8 else SEMESTER_START.year - 1
    return f"{y}/{y + 1}"


def build(sources: list[Source], contents: dict[str, bytes], state: dict, force: bool) -> tuple[bool, str, bool]:
    """Возвращает (что-то поменялось, сообщение для коммита, нужен LibreOffice)."""
    now = datetime.now(MSK).isoformat(timespec="seconds")
    registry = load_json(IDS_FILE, {})
    prev_groups = {g["id"]: g for g in (load_json(OUT / "groups.json", {}) or {}).get("groups", [])}
    report = {"generated_at": now, "files": [], "sheets": [], "unrecognized": [], "warnings": [], "duplicates": []}
    alerts: list[dict] = []
    need_soffice = False

    def alert(text: str, source: Source | None = None) -> None:
        aid = hashlib.sha1(f"{source.key if source else ''}|{text}".encode()).hexdigest()[:12]
        alerts.append({"id": aid, "at": now, "text": text})
        warn(text)

    # 1. разбор каждого файла
    parsed: dict[str, list[gp.ParsedGroup]] = {}
    sessions: dict[str, list[gp.SessionGroup]] = {}
    file_modified: dict[str, str] = {}
    new_state = {"files": {}}
    for src in sources:
        content = contents.get(src.url)
        prev = state.get("files", {}).get(src.key, {})
        entry = {"key": src.key, "kind": src.kind, "name": src.name, "text": src.text, "section": src.section,
                 "url": src.url, "sha256": None, "status": "ok", "groups": 0, "lessons": 0,
                 "prev_groups": prev.get("groups")}
        report["files"].append(entry)
        if content is None:
            entry["status"] = "error"
            entry["note"] = "не скачался"
            alert(f"Файл ГУУ не скачался: {src.name}", src)
            new_state["files"][src.key] = prev
            continue
        sha = hashlib.sha256(content).hexdigest()
        entry["sha256"] = sha
        rep = gp.Report()
        try:
            with tempfile.TemporaryDirectory() as tmp:
                suffix = Path(src.name).suffix.lower()
                path = Path(tmp) / f"source{suffix}"
                path.write_bytes(content)
                if suffix == ".doc":
                    if not content.startswith(b"\xd0\xcf\x11\xe0"):
                        raise UpdateError("по ссылке не .doc")
                    converted = doc_to_docx(content, sha)
                    if not converted:
                        need_soffice = True
                        entry["status"] = "kept"
                        entry["note"] = "нужен LibreOffice для .doc — оставлены прошлые данные"
                        warn(f"{src.name}: {entry['note']}")
                        new_state["files"][src.key] = prev
                        continue
                    path = converted
                elif not content.startswith(b"PK"):
                    raise UpdateError(f"по ссылке не {suffix} ({len(content)} байт)")
                else:
                    try:
                        import openpyxl
                        if suffix == ".xlsx":
                            props = openpyxl.load_workbook(path, read_only=True).properties
                            if props.modified:
                                file_modified[src.key] = props.modified.isoformat()
                    except Exception:  # noqa: BLE001 — дата изменения только для выбора из дублей
                        pass
                if src.kind == "schedule":
                    groups = gp.parse_schedule_file(path, src.meta, rep)
                    parsed[src.key] = groups
                    entry["groups"] = len(groups)
                    entry["lessons"] = sum(len(g.lessons) for g in groups)
                else:
                    sgs = gp.parse_session_file(path, src.meta, rep)
                    sessions[src.key] = sgs
                    entry["groups"] = len(sgs)
                    entry["lessons"] = sum(len(g.items) for g in sgs)
        except Exception as e:  # noqa: BLE001 — один битый файл не должен ронять остальные
            entry["status"] = "error"
            entry["note"] = f"{type(e).__name__}: {e}"
            alert(f"Не разобрал файл ГУУ {src.name}: {e}", src)
            new_state["files"][src.key] = prev
            continue
        report["sheets"] += rep.sheets
        report["unrecognized"] += rep.unrecognized
        report["warnings"] += rep.warnings
        new_state["files"][src.key] = {"name": src.name, "sha256": sha, "groups": entry["groups"],
                                       "lessons": entry["lessons"], "parsed_at": now}

        # 2. защита от поломки: групп стало заметно меньше
        prev_count = prev.get("groups")
        if src.kind == "schedule" and prev_count and entry["groups"] < prev_count * (1 - MAX_DROP):
            entry["status"] = "rejected"
            entry["note"] = f"групп {entry['groups']} вместо {prev_count} — файл не опубликован"
            alert(f"⚠️ {src.name}: групп стало {entry['groups']} вместо {prev_count} (−"
                  f"{round(100 - 100 * entry['groups'] / prev_count)}%). Файл не опубликован, "
                  f"показываем прошлое расписание этих групп. Проверьте файл на guu.ru.", src)
            parsed.pop(src.key, None)
            new_state["files"][src.key] = prev

    # 3. группы: ключ, дубли (одна группа в двух файлах — берём более свежий файл)
    def source_rank(key: str) -> tuple:
        src = next(s for s in sources if s.key == key)
        return (bool(src.text), file_modified.get(key, ""))

    chosen: dict[str, tuple[str, gp.ParsedGroup]] = {}
    for key in sorted(parsed, key=source_rank, reverse=True):
        for g in parsed[key]:
            k = group_key(g.info)
            if k in chosen:
                report["duplicates"].append({"group": k, "kept": chosen[k][1].info.where, "dropped": g.info.where})
                continue
            chosen[k] = (key, g)

    # МБ(МП) 1-1/1-2 — без пар не публикуем их файл
    for name, legacy_id in LEGACY_GROUPS.items():
        found = [(k, sk, g) for k, (sk, g) in chosen.items() if base_name(g.info) == name and g.info.institute == "ИУПСиБК"]
        if not found or len(found[0][2].lessons) < MIN_LESSONS:
            src_key = found[0][1] if found else next((s.key for s in sources if s.kind == "schedule" and s.meta.course == 1
                                                       and s.meta.level == "bachelor" and s.meta.form == "ofo"), None)
            count = len(found[0][2].lessons) if found else 0
            alert(f"⚠️ У {name} в новом файле {count} пар (нужно ≥ {MIN_LESSONS}) — похоже, поменялась структура "
                  f"таблицы. Файл 1 курса не опубликован, показываем прошлое расписание.")
            if src_key in parsed:
                for k in [k for k, (sk, _) in chosen.items() if sk == src_key]:
                    chosen.pop(k)
                parsed.pop(src_key)
                for f in report["files"]:
                    if f["key"] == src_key:
                        f["status"] = "rejected"
                        f["note"] = f"у {name} {count} пар — файл не опубликован"
                new_state["files"][src_key] = state.get("files", {}).get(src_key, {})

    assign_ids([g.info for _, g in chosen.values()], registry)

    # 4. записи групп; у отклонённых файлов — прошлые группы как были
    writer = Writer()
    entries: list[dict] = []
    group_lessons: dict[str, list[dict]] = {}
    group_grid: dict[str, dict] = {}
    rejected_keys = {f["key"] for f in report["files"] if f["status"] in ("rejected", "error", "kept") and f["kind"] == "schedule"}
    for k, (src_key, g) in chosen.items():
        gid = registry[k]
        src = next(s for s in sources if s.key == src_key)
        info = g.info
        entries.append({"id": gid, "name": base_name(info), "level": info.level, "form": info.form,
                        "course": info.course, "institute": info.institute, "direction": info.direction,
                        "program": info.program, "number": info.number, "source": src_key,
                        "source_file": src.name, "lessons": len(g.lessons)})
        group_lessons[gid] = sorted(g.lessons, key=lambda l: (l["weekday"], l["start"], l["subject"]))
        group_grid[gid] = {str(wd): slots for wd, slots in sorted(g.grid.items())}
    for gid, prev in prev_groups.items():
        if prev.get("source") in rejected_keys and gid not in group_lessons:
            old = load_json(OUT / "schedule" / f"{gid}.json")
            if old:
                entries.append({k: v for k, v in prev.items() if k not in ("name", "session")})
                group_lessons[gid] = old["lessons"]
                group_grid[gid] = old.get("grid", {})
    for e in entries:
        e["name"] = base_name(entry_info(e))
    unique_names(entries)
    # имена МБ(МП) 1-1/1-2 закреплены — у них всё как раньше
    for e in entries:
        for name, legacy_id in LEGACY_GROUPS.items():
            if e["id"] == legacy_id:
                e["name"] = name
    entries.sort(key=lambda e: (e["level"] != "bachelor", e["level"], e["form"], e["course"], e["institute"], e["name"]))
    names = {e["id"]: e["name"] for e in entries}

    # 5. сессия — только текущего учебного года (прошлогодняя относится к другому потоку)
    current_year = academic_year_now()
    by_key = {group_key(entry_info(e)): e["id"] for e in entries}
    session_out: dict[str, dict] = {}
    session_skipped = Counter()
    for src_key, sgs in sessions.items():
        for sg in sgs:
            if sg.academic_year != current_year:
                session_skipped[sg.academic_year] += 1
                continue
            gid = by_key.get(group_key(sg.info))
            if not gid:
                report["warnings"].append(f"сессия: нет такой группы в расписании — {sg.info.where}")
                continue
            current = session_out.setdefault(gid, {"id": gid, "name": names[gid], "title": sg.title, "items": []})
            current["items"] += sg.items
    if session_skipped:
        report["warnings"].append(
            "сессия прошлого учебного года не опубликована (её группы уже на следующем курсе): "
            + ", ".join(f"{y} — {n} групп" for y, n in sorted(session_skipped.items())))
    for e in entries:
        e["session"] = e["id"] in session_out

    # 6. файлы групп: updated_at меняется, только если пары группы поменялись
    changed_groups = []
    for e in entries:
        gid = e["id"]
        path = OUT / "schedule" / f"{gid}.json"
        old = load_json(path)
        lessons = group_lessons[gid]
        same = old and old.get("lessons") == lessons and old.get("grid") == group_grid[gid]
        if not same:
            changed_groups.append(gid)
        body = {"id": gid, "name": e["name"], "updated_at": old["updated_at"] if same else now,
                "semester_start": SEMESTER_START.isoformat(), "source_file": e.get("source_file"),
                "grid": group_grid[gid], "lessons": lessons}
        e["updated_at"] = body["updated_at"]
        writer.write(path, dump(body))
    writer.prune(OUT / "schedule")
    for gid, body in session_out.items():
        body["items"].sort(key=lambda i: (i["date"], i["start"] or ""))
        writer.write(OUT / "session" / f"{gid}.json", dump(body))
    writer.prune(OUT / "session")

    # 7. преподаватели и аудитории
    teachers: dict[str, dict] = {}
    rooms: dict[str, list] = defaultdict(list)
    for e in entries:
        gid = e["id"]
        for l in group_lessons[gid]:
            for t in l.get("teachers") or ([l["teacher"]] if l.get("teacher") else []):
                tid = teacher_id(t)
                rec = teachers.setdefault(tid, {"id": tid, "name": t, "subjects": set(), "groups": set(), "lessons": []})
                rec["subjects"].add(l["subject"])
                rec["groups"].add(gid)
                rec["lessons"].append({**{k: v for k, v in l.items() if k != "teachers"}, "group": gid,
                                       "group_name": e["name"]})
            if l.get("room"):
                rooms[l["room"]].append((l["weekday"], l["start"], l["end"], weeks_mask(l["weeks"])))
    index = []
    for tid, rec in sorted(teachers.items(), key=lambda kv: kv[1]["name"]):
        # одна и та же пара у потока из нескольких групп — одной строкой со списком групп
        merged: dict[tuple, dict] = {}
        for l in rec["lessons"]:
            key = (l["weekday"], l["start"], l["end"], l["subject"], l["kind"], tuple(l["weeks"]), l.get("room"))
            if key in merged:
                merged[key]["groups"].append(l["group"])
                merged[key]["group_names"].append(l["group_name"])
            else:
                merged[key] = {k: v for k, v in l.items() if k not in ("group", "group_name", "teacher")}
                merged[key]["groups"] = [l["group"]]
                merged[key]["group_names"] = [l["group_name"]]
        lessons = sorted(merged.values(), key=lambda l: (l["weekday"], l["start"]))
        writer.write(OUT / "teachers" / f"{tid}.json",
                     dump({"id": tid, "name": rec["name"], "semester_start": SEMESTER_START.isoformat(), "lessons": lessons}))
        index.append({"id": tid, "name": rec["name"], "subjects": sorted(rec["subjects"]),
                      "groups": sorted(rec["groups"]), "lessons": len(lessons)})
    writer.prune(OUT / "teachers")
    writer.write(OUT / "teachers.json", dump({"updated_at": now, "teachers": index}))

    room_out = {}
    for room, busy in sorted(rooms.items()):
        slots: dict[tuple, int] = defaultdict(int)
        for wd, s, e2, mask in busy:
            slots[(wd, s, e2)] |= mask
        prefix = ROOM_PREFIX.match(room)
        room_out[room] = {"building": prefix.group(1) if prefix else room,
                          "busy": [[wd, s, e2, mask] for (wd, s, e2), mask in sorted(slots.items())]}
    writer.write(OUT / "rooms.json", dump({"updated_at": now, "semester_start": SEMESTER_START.isoformat(),
                                           "note": "weeks — битовая маска: бит N = N-я неделя", "rooms": room_out}))

    # 8. groups.json, отчёт, тревоги
    institutes = {short: full for short, full, _ in gp.INSTITUTES}
    institutes["Аспирантура"] = "Аспирантура"
    groups_json = {"updated_at": now, "semester_start": SEMESTER_START.isoformat(),
                   "institutes": institutes,
                   "groups": entries}
    # updated_at в groups.json меняется только вместе с данными — иначе коммит каждый час
    old_groups_json = load_json(OUT / "groups.json")
    if old_groups_json and {**old_groups_json, "updated_at": None} == {**groups_json, "updated_at": None}:
        groups_json["updated_at"] = old_groups_json["updated_at"]
    writer.write(OUT / "groups.json", dump(groups_json))

    summary = Counter((e["level"], e["form"], e["course"]) for e in entries)
    level_names = {"bachelor": "бакалавриат", "master": "магистратура", "postgrad": "аспирантура"}
    report["summary"] = {
        "groups": len(entries),
        "teachers": len(index),
        "rooms": len(room_out),
        "sessions": len(session_out),
        "by_level": [{"level": level_names[l], "form": "ОЗФО" if f == "ozfo" else "ОФО", "course": c, "groups": n}
                     for (l, f, c), n in sorted(summary.items())],
    }
    data_changed = bool(writer.changed)
    if data_changed or not (OUT / "parse_report.json").exists():
        writer.write(OUT / "parse_report.json", dump_pretty(report))
    old_alerts = (load_json(OUT / "alerts.json", {}) or {}).get("alerts", [])
    keep = {a["id"]: a for a in old_alerts}
    alerts_now = [keep.get(a["id"], a) for a in alerts]  # та же тревога — то же время, бот не повторит
    writer.write(OUT / "alerts.json", dump({"alerts": alerts_now}))

    # 9. schedule.json для старых версий приложения: МБ(МП) 1-1 и 1-2 в прежнем формате
    legacy_lessons = []
    for name, gid in LEGACY_GROUPS.items():
        for l in group_lessons.get(gid, []):
            legacy_lessons.append({"group": name, "weekday": l["weekday"], "start": l["start"], "end": l["end"],
                                   "subject": l["subject"], "kind": l["kind"], "weeks": l["weeks"],
                                   "teacher": l["teacher"], "room": l["room"]})
    def legacy_order(l: dict) -> tuple:
        return (l["group"], l["weekday"], l["start"], l["subject"], l["kind"] or "", tuple(l["weeks"]),
                l["teacher"] or "", l["room"] or "")

    legacy_lessons.sort(key=legacy_order)
    current_legacy = load_json(LEGACY_FILE)
    if legacy_lessons and (not current_legacy or sorted(current_legacy["lessons"], key=legacy_order) != legacy_lessons):
        first_course = next((f for f in report["files"] if f["kind"] == "schedule" and f["status"] == "ok"
                             and any(e["id"] in LEGACY_GROUPS.values() and e.get("source") == f["key"] for e in entries)), None)
        writer.write(LEGACY_FILE, dump_pretty({
            "updated_at": now,
            "source_file": first_course["name"] if first_course else (current_legacy or {}).get("source_file"),
            "source_sha256": first_course["sha256"] if first_course else (current_legacy or {}).get("source_sha256"),
            "semester_start": SEMESTER_START.isoformat(),
            "groups": list(LEGACY_GROUPS),
            "lessons": legacy_lessons,
        }))
        check_overrides(legacy_lessons)

    # служебное: реестр id, SHA файлов, кэш .docx только для текущих .doc
    IDS_FILE.parent.mkdir(parents=True, exist_ok=True)
    writer.write(IDS_FILE, dump_pretty(dict(sorted(registry.items()))))
    writer.write(STATE_FILE, dump_pretty(new_state))
    live = {f["sha256"] for f in report["files"] if f.get("sha256")}
    if DOC_CACHE.exists():
        for p in DOC_CACHE.glob("*.docx"):
            if p.stem not in live:
                p.unlink()
                writer.changed.append(p)

    print_summary(report, changed_groups)
    changed = any(p.parent != ROOT / "data" for p in writer.changed if p.name not in ("alerts.json",)) or bool(changed_groups)
    message = (f"Расписание ГУУ: изменились пары у {len(changed_groups)} групп" if changed_groups
               else "Расписание ГУУ: служебные данные")
    return bool(writer.changed), message, need_soffice


def print_summary(report: dict, changed_groups: list[str]) -> None:
    s = report["summary"]
    print(f"\nГрупп: {s['groups']}, преподавателей: {s['teachers']}, аудиторий: {s['rooms']}, сессий: {s['sessions']}")
    for row in s["by_level"]:
        print(f"  {row['level']} {row['form']} {row['course']} курс — {row['groups']}")
    print(f"Изменились пары у групп: {len(changed_groups)}")
    for f in report["files"]:
        mark = {"ok": "✓", "rejected": "✖", "error": "✖", "kept": "…"}[f["status"]]
        print(f"  {mark} {f['name']}: групп {f['groups']}{(' — ' + f['note']) if f.get('note') else ''}")
    if report["unrecognized"]:
        print(f"Нераспознанных ячеек: {len(report['unrecognized'])} (см. parse_report.json)")
    if report["warnings"]:
        print(f"Где парсер не уверен: {len(report['warnings'])} (см. parse_report.json)")


def override_weeks(spec) -> set[int]:
    return set(spec) if isinstance(spec, list) else set(parse_weeks(str(spec)))


def check_overrides(lessons: list[dict]) -> None:
    """Ручные правки МБ привязаны к файлу ГУУ: если файл поменялся, они могут устареть."""
    if not OVERRIDES_FILE.exists():
        return
    overrides = json.loads(OVERRIDES_FILE.read_text(encoding="utf-8"))

    def hits(rule: dict, lesson: dict) -> bool:
        return (lesson["group"] == rule["group"] and lesson["weekday"] == rule["weekday"]
                and lesson["start"] == rule["start"]
                and (not rule.get("subject") or lesson["subject"] == rule["subject"]))

    for rule in overrides.get("remove", []):
        if not any(hits(rule, lesson) for lesson in lessons):
            warn(f"overrides.json: remove «{rule.get('subject', '')}» {rule['group']}, "
                 f"{WEEKDAYS[rule['weekday']].lower()} {rule['start']} — такой пары в файле ГУУ больше нет")
    for rule in overrides.get("add", []):
        weeks = override_weeks(rule["weeks"])
        for lesson in lessons:
            if hits({**rule, "subject": None}, lesson) and weeks & set(lesson["weeks"]):
                warn(f"overrides.json: add «{rule['subject']}» {rule['group']}, "
                     f"{WEEKDAYS[rule['weekday']].lower()} {rule['start']} пересекается с «{lesson['subject']}» "
                     f"из файла ГУУ — возможно, правка уже не нужна")
                break


def update(force: bool, local: Path | None) -> tuple[bool, str, bool]:
    state = load_json(STATE_FILE, {"files": {}})
    sources = local_sources(local) if local else find_sources()
    contents: dict[str, bytes] = {}
    for src in sources:
        try:
            contents[src.url] = Path(unquote(src.url[7:])).read_bytes() if local else fetch(src.url)[1]
        except UpdateError as e:
            warn(str(e))
    print(f"Файлов: {len(sources)} (скачано {len(contents)})")
    shas = {s.key: hashlib.sha256(contents[s.url]).hexdigest() for s in sources if s.url in contents}
    old = {k: v.get("sha256") for k, v in state.get("files", {}).items()}
    if not force and shas == {k: old.get(k) for k in shas} and set(old) == set(shas) and (OUT / "groups.json").exists():
        print("Ни один файл не изменился — расписание то же.")
        return False, "", False
    for key, sha in shas.items():
        if old.get(key) != sha:
            print(f"  изменился: {key}")
    return build(sources, contents, state, force)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--force", action="store_true", help="пересобрать, даже если файлы не изменились")
    ap.add_argument("--local", type=Path, help="взять файлы из папки, а не с guu.ru")
    args = ap.parse_args()
    try:
        changed, message, need_soffice = update(args.force, args.local)
    except UpdateError as e:
        print(f"✖ {e}", file=sys.stderr)
        annotate("error", str(e))
        github_output(changed="false", need_soffice="false")
        return 1
    github_output(changed=str(changed).lower(), message=message or "Расписание ГУУ",
                  need_soffice=str(need_soffice).lower())
    return 0


if __name__ == "__main__":
    sys.exit(main())
