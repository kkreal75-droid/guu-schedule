"""Схема кампуса ГУУ для «Другое → Корпуса ГУУ» (этап 7.7): здания, дорожки, поля и дороги из OpenStreetMap
→ public/data/campus.json (SVG-пути в метрах). Приложение рисует схему само, в цветах темы, без чужих
тайлов и запросов. Данные OSM — © участники OpenStreetMap, ODbL: подпись выводится на карте.

Запускать вручную, когда в OSM поправят здания (раз в год хватит):
    .venv/bin/python scripts/campus_map.py              # скачать из Overpass
    .venv/bin/python scripts/campus_map.py --from FILE  # из сохранённого ответа Overpass (out geom)
"""
import argparse
import json
import math
import ssl
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

import certifi

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "data" / "campus.json"

# окно схемы: кампус (Рязанский пр., 99) с запасом ~60 м
SOUTH, WEST, NORTH, EAST = 55.7116, 37.8092, 55.7172, 37.8196
LAT0, LON0 = 55.7145, 37.8145  # начало координат схемы
MY = 111_132.0  # метров в градусе широты
MX = 111_320.0 * math.cos(math.radians(LAT0))  # метров в градусе долготы

QUERY = f"""[out:json][timeout:60];
(
 way["building"]({SOUTH},{WEST},{NORTH},{EAST});
 way["leisure"~"pitch|stadium|track|sports_centre|park"]({SOUTH},{WEST},{NORTH},{EAST});
 relation["amenity"="university"]({SOUTH},{WEST},{NORTH},{EAST});
 way["highway"~"footway|pedestrian|service|primary|secondary|tertiary|residential|unclassified|path"]({SOUTH},{WEST},{NORTH},{EAST});
 way["railway"~"rail|subway"]({SOUTH},{WEST},{NORTH},{EAST});
);
out geom;"""

# здание OSM → место из public/data/places.json (подпись и подсветка на схеме)
PLACE_OF_WAY = {
    708579301: "u",  # Главный учебный корпус, 99 с8
    708579302: "lk",  # Лабораторный корпус, 99 с4
    170022088: "pa",  # Корпус поточных аудиторий, 99 к5
    170022122: "a",  # Административный корпус, 99 к1
    49365890: "bc",  # Бизнес-центр, 99 с16
    49365892: "cuvp",  # 99 с2 (ЦУВП)
    29386079: "sk",  # Спорткомплекс, 99 к7
    170365079: "pool",  # Бассейн, 99 к3 (в OSM — sports_centre)
    49365893: "dorm-2",
    49365896: "dorm-6",
    170022120: "kpp",
    170365080: "kpp",
}


def fetch() -> dict:
    ctx = ssl.create_default_context(cafile=certifi.where())
    body = urllib.parse.urlencode({"data": QUERY}).encode()
    for attempt in range(4):
        try:
            req = urllib.request.Request(
                "https://overpass-api.de/api/interpreter",
                data=body,
                headers={"User-Agent": "guu-schedule campus map (github.com/kkreal75-droid/guu-schedule)"},
            )
            with urllib.request.urlopen(req, context=ctx, timeout=120) as r:
                return json.load(r)
        except Exception as err:  # Overpass часто отвечает 502/504 — подождать и повторить
            print(f"Overpass: {err}, ещё раз…", file=sys.stderr)
            time.sleep(10 * (attempt + 1))
    raise SystemExit("Overpass недоступен")


def xy(p: dict) -> tuple[float, float]:
    return (p["lon"] - LON0) * MX, -(p["lat"] - LAT0) * MY


def simplify(pts: list, tol: float) -> list:
    """Дуглас — Пекер: убирает точки, которые на схеме не видны."""
    if len(pts) < 3:
        return pts
    (x1, y1), (x2, y2) = pts[0], pts[-1]
    dx, dy = x2 - x1, y2 - y1
    norm = math.hypot(dx, dy) or 1e-9
    best, idx = 0.0, 0
    for i in range(1, len(pts) - 1):
        x0, y0 = pts[i]
        d = abs(dy * x0 - dx * y0 + x2 * y1 - y2 * x1) / norm if norm > 1e-9 else math.hypot(x0 - x1, y0 - y1)
        if d > best:
            best, idx = d, i
    if best <= tol:
        return [pts[0], pts[-1]]
    return simplify(pts[: idx + 1], tol)[:-1] + simplify(pts[idx:], tol)


def num(v: float, digits: int) -> str:
    s = f"{v:.{digits}f}"
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def path(pts: list, closed: bool, tol: float = 0.6, digits: int = 1) -> str:
    pts = simplify(pts, tol)
    if closed and len(pts) > 2 and pts[0] == pts[-1]:
        pts = pts[:-1]
    d = "M" + " ".join(f"{num(x, digits)} {num(y, digits)}" for x, y in pts)
    return d + ("Z" if closed else "")


def inside(pts: list) -> bool:
    x0, y0 = xy({"lat": SOUTH, "lon": WEST})
    x1, y1 = xy({"lat": NORTH, "lon": EAST})
    return any(x0 - 50 <= x <= x1 + 50 and y1 - 50 <= y <= y0 + 50 for x, y in pts)


def rings(members: list) -> list[list]:
    """Склеивает внешние линии отношения в замкнутые контуры."""
    parts = [[xy(p) for p in m["geometry"]] for m in members if m.get("role") == "outer" and m.get("geometry")]
    out = []
    while parts:
        ring = parts.pop(0)
        changed = True
        while ring[0] != ring[-1] and changed:
            changed = False
            for i, part in enumerate(parts):
                if part[0] == ring[-1]:
                    ring += part[1:]
                elif part[-1] == ring[-1]:
                    ring += part[::-1][1:]
                elif part[-1] == ring[0]:
                    ring = part[:-1] + ring
                elif part[0] == ring[0]:
                    ring = part[::-1][:-1] + ring
                else:
                    continue
                parts.pop(i)
                changed = True
                break
        out.append(ring)
    return out


def build(data: dict) -> dict:
    campus, buildings, green, roads, paths, rail = [], [], [], [], [], []
    for e in data["elements"]:
        t = e.get("tags", {})
        if e["type"] == "relation":
            campus += [path(r, True) for r in rings(e["members"])]
            continue
        pts = [xy(p) for p in e.get("geometry", [])]
        if len(pts) < 2 or not inside(pts):
            continue
        place = PLACE_OF_WAY.get(e["id"])
        if "building" in t or place:
            item = {"d": path(pts, True)}
            if place:
                item["place"] = place
            elif t.get("building") == "university" or e["id"] in (132214553,):
                item["uni"] = 1  # корпус ГУУ без места в списке — тоже цветом кампуса
            buildings.append(item)
        elif t.get("leisure") in ("pitch", "stadium", "track", "park"):
            green.append(path(pts, True))
        elif t.get("railway"):
            rail.append(path(pts, False, tol=2, digits=0))
        elif t.get("highway") in ("primary", "secondary", "tertiary"):
            roads.append({"d": path(pts, False, tol=1.5, digits=0), "w": {"primary": 3, "secondary": 2}.get(t["highway"], 1)})
        elif t.get("highway") in ("residential", "unclassified", "service"):
            roads.append({"d": path(pts, False, tol=1.5, digits=0), "w": 0})
        elif t.get("highway") in ("footway", "pedestrian", "path"):
            paths.append(path(pts, False, tol=1, digits=0))
    # здания с местом — поверх остальных (подписи не прячутся под соседями)
    buildings.sort(key=lambda b: ("place" in b, "uni" in b))
    x0, y0 = xy({"lat": NORTH, "lon": WEST})
    x1, y1 = xy({"lat": SOUTH, "lon": EAST})
    return {
        "source": "© участники OpenStreetMap (ODbL)",
        "updated_at": time.strftime("%Y-%m-%d"),
        # x = (lon − lon0) · mx, y = −(lat − lat0) · my — метры от начала координат схемы
        "origin": {"lat": LAT0, "lon": LON0, "mx": round(MX, 3), "my": MY},
        "bounds": [round(x0), round(y0), round(x1), round(y1)],
        "campus": campus,
        "green": green,
        "roads": roads,
        "paths": paths,
        "rail": rail,
        "buildings": buildings,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="src", help="сохранённый ответ Overpass (out geom)")
    args = ap.parse_args()
    data = json.loads(Path(args.src).read_text()) if args.src else fetch()
    result = build(data)
    OUT.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"{OUT.relative_to(ROOT)}: зданий {len(result['buildings'])}, дорожек {len(result['paths'])}, "
          f"{OUT.stat().st_size // 1024} КБ")


if __name__ == "__main__":
    main()
