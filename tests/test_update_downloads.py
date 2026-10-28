"""Счётчик неудачных скачиваний файлов ГУУ (update.py → track_downloads): тревога только с 3-й неудачи подряд,
архив сессии — без тревоги, скачался снова — тревога уходит. Запуск: .venv/bin/python -m unittest discover -s tests"""
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import update  # noqa: E402

SCHEDULE = update.Source("schedule", "https://guu.ru/wp-content/uploads/1-kurs.xlsx", "1-курс-бакалавриат-ОФО-143.xlsx",
                         "1 курс бакалавриат ОФО", "бакалавриат")
SESSION = update.Source("session", "https://guu.ru/wp-content/uploads/sessiya.xlsx", "Сессия-1-курс-бакалавриат-ОФО-11.xlsx",
                        "Сессия 1 курс бакалавриат ОФО", "бакалавриат")


class TrackDownloads(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.out = Path(self.tmp.name) / "public" / "data"
        self.out.mkdir(parents=True)
        self.saved = (update.OUT, update.STATE_FILE, update.warn)
        update.OUT = self.out
        update.STATE_FILE = Path(self.tmp.name) / "state.json"
        update.warn = lambda message: self.warnings.append(message)
        self.warnings = []
        (self.out / "alerts.json").write_text(json.dumps({"alerts": [{"id": "events-x", "at": "-", "text": "make.events молчит"}]}))

    def tearDown(self):
        update.OUT, update.STATE_FILE, update.warn = self.saved
        self.tmp.cleanup()

    def alerts(self):
        return json.loads((self.out / "alerts.json").read_text())["alerts"]

    def download_alerts(self):
        return [a for a in self.alerts() if a["text"].startswith("Файл ГУУ не скачался:")]

    def test_alert_only_from_third_failure_and_gone_after_success(self):
        state = {"files": {SCHEDULE.key: {"name": SCHEDULE.name, "sha256": "aa", "groups": 63}}}
        for run in (1, 2):
            update.track_downloads([SCHEDULE], {}, state)
            self.assertEqual(state["files"][SCHEDULE.key]["failures"], run)
            self.assertEqual(self.download_alerts(), [], f"после {run}-й неудачи тревоги быть не должно")
        self.assertTrue(any("1-я неудача" in w for w in self.warnings) and any("2-я неудача" in w for w in self.warnings))
        update.track_downloads([SCHEDULE], {}, state)
        alerts = self.download_alerts()
        self.assertEqual(len(alerts), 1)
        self.assertTrue(alerts[0]["text"].startswith(f"Файл ГУУ не скачался: {SCHEDULE.name}"))
        first_at = alerts[0]["at"]
        update.track_downloads([SCHEDULE], {}, state)  # 4-я неудача — та же тревога, бот её не повторит
        self.assertEqual([(a["id"], a["at"]) for a in self.download_alerts()], [(alerts[0]["id"], first_at)])
        # скачался — счётчик обнулён, тревога ушла, чужие тревоги на месте
        self.assertTrue(update.track_downloads([SCHEDULE], {SCHEDULE.url: b"x"}, state))
        self.assertNotIn("failures", state["files"][SCHEDULE.key])
        self.assertEqual(self.download_alerts(), [])
        self.assertEqual([a["id"] for a in self.alerts()], ["events-x"])
        # новая серия неудач считается с нуля
        update.track_downloads([SCHEDULE], {}, state)
        self.assertEqual(state["files"][SCHEDULE.key]["failures"], 1)
        self.assertEqual(self.download_alerts(), [])

    def test_archive_session_never_alerts(self):
        state = {"files": {SESSION.key: {"name": SESSION.name, "sha256": "bb", "archive": True}}}
        for _ in range(5):
            update.track_downloads([SESSION], {}, state)
        self.assertEqual(state["files"][SESSION.key]["failures"], 5)
        self.assertEqual(self.download_alerts(), [])
        self.assertTrue(all("архив" in w for w in self.warnings))

    def test_archive_known_only_from_session_status(self):
        (self.out / "session_status.json").write_text(json.dumps({"files": [{"name": SESSION.name, "archive": True}]}))
        state = {"files": {SESSION.key: {"name": SESSION.name, "sha256": "bb"}}}
        for _ in range(4):
            update.track_downloads([SESSION], {}, state)
        self.assertEqual(self.download_alerts(), [])

    def test_current_session_alerts_like_schedule(self):
        state = {"files": {SESSION.key: {"name": SESSION.name, "sha256": "bb", "archive": False}}}
        for _ in range(3):
            update.track_downloads([SESSION], {}, state)
        self.assertEqual(len(self.download_alerts()), 1)

    def test_old_style_alert_removed(self):
        (self.out / "alerts.json").write_text(json.dumps({"alerts": [
            {"id": "859d3a830c19", "at": "-", "text": f"Файл ГУУ не скачался: {SESSION.name}"},
            {"id": "events-x", "at": "-", "text": "make.events молчит"}]}))
        state = {"files": {SESSION.key: {"name": SESSION.name, "sha256": "bb", "archive": True}}}
        update.track_downloads([SESSION], {SESSION.url: b"x"}, state)
        self.assertEqual([a["id"] for a in self.alerts()], ["events-x"])


class UpdateKeepsCounter(unittest.TestCase):
    """update(): файлы не менялись (сборки нет) — обнулённый счётчик всё равно сохраняется в state.json."""

    def test_reset_is_saved_without_build(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "public" / "data"
            out.mkdir(parents=True)
            (out / "groups.json").write_text("{}")
            state_file = Path(tmp) / "state.json"
            body = b"same file"
            state_file.write_text(json.dumps({"files": {SCHEDULE.key: {
                "name": SCHEDULE.name, "sha256": hashlib.sha256(body).hexdigest(), "failures": 2}}}))
            saved = {k: getattr(update, k) for k in ("OUT", "STATE_FILE", "find_sources", "fetch", "update_kug",
                                                     "update_events", "write_status", "warn", "build")}
            try:
                update.OUT, update.STATE_FILE = out, state_file
                update.find_sources = lambda: [SCHEDULE]
                update.fetch = lambda url: ({}, body)
                update.update_kug = lambda force: False
                update.update_events = lambda: False
                update.write_status = lambda sources: True
                update.warn = lambda message: None
                update.build = lambda *a: self.fail("сборка не нужна — файлы те же")
                update.update(False, None)
            finally:
                for k, v in saved.items():
                    setattr(update, k, v)
            entry = json.loads(state_file.read_text())["files"][SCHEDULE.key]
            self.assertNotIn("failures", entry)
            self.assertEqual(entry["sha256"], hashlib.sha256(body).hexdigest())


if __name__ == "__main__":
    unittest.main()
