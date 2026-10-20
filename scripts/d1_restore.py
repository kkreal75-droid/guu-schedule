"""Восстановление D1 из бэкапа бота (guu-bot-ГГГГ-ММ-ДД.json.gz — бот присылает его владельцу каждую ночь
и по команде /backup) → SQL-файл для `wrangler d1 execute`.

    python3 scripts/d1_restore.py guu-bot-2026-10-21.json.gz > restore.sql
    python3 scripts/d1_restore.py guu-bot-2026-10-21.json.gz --tables users,teacher_reviews > part.sql

Порядок восстановления — docs/backup.md. Скрипт только читает бэкап и печатает SQL; базу не трогает.
"""
import argparse
import gzip
import json
import re
import sys

BATCH = 200  # строк в одном INSERT — D1 не любит слишком длинные запросы


def literal(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        return repr(value)
    return "'" + str(value).replace("'", "''") + "'"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("backup", help="guu-bot-….json.gz (или .json)")
    ap.add_argument("--tables", help="только эти таблицы, через запятую")
    ap.add_argument("--replace", action="store_true", help="INSERT OR REPLACE (поверх существующих строк)")
    args = ap.parse_args()

    opener = gzip.open if args.backup.endswith(".gz") else open
    with opener(args.backup, "rt", encoding="utf-8") as f:
        dump = json.load(f)
    if dump.get("format") != "guu-bot-d1-backup":
        print("Это не бэкап guu-bot", file=sys.stderr)
        return 1
    only = set(args.tables.split(",")) if args.tables else None
    verb = "INSERT OR REPLACE" if args.replace else "INSERT OR IGNORE"
    print(f"-- восстановление из бэкапа от {dump['at']}")
    total = 0
    for table, rows in dump["tables"].items():
        if only and table not in only or not rows:
            continue
        if not re.fullmatch(r"[a-z0-9_]+", table, re.I):
            continue
        columns = list(rows[0].keys())
        cols = ", ".join(f'"{c}"' for c in columns)
        for i in range(0, len(rows), BATCH):
            values = ",\n  ".join("(" + ", ".join(literal(r.get(c)) for c in columns) + ")" for r in rows[i:i + BATCH])
            print(f'{verb} INTO "{table}" ({cols}) VALUES\n  {values};')
        total += len(rows)
        print(f"-- {table}: {len(rows)}", file=sys.stderr)
    print(f"Строк: {total}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
