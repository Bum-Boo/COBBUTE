from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import date, datetime, tzinfo
from pathlib import Path

from .timeutils import day_bounds


@dataclass(frozen=True)
class AttendanceEvent:
    id: int
    user_id: int
    event_type: str
    note: str
    created_at: datetime


@dataclass(frozen=True)
class WorkNote:
    id: int
    user_id: int
    note: str
    created_at: datetime


@dataclass(frozen=True)
class ReportRun:
    id: int
    user_id: int
    report_date: date
    report_type: str
    content: str
    llm_status: str
    llm_detail: str
    created_at: datetime
    auto: bool


class Database:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def init(self) -> None:
        with self.connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS attendance_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    event_type TEXT NOT NULL CHECK (event_type IN ('check_in', 'check_out')),
                    note TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_attendance_user_created
                    ON attendance_events(user_id, created_at);

                CREATE TABLE IF NOT EXISTS work_notes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    note TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_work_notes_user_created
                    ON work_notes(user_id, created_at);

                CREATE TABLE IF NOT EXISTS report_runs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    report_date TEXT NOT NULL,
                    report_type TEXT NOT NULL,
                    content TEXT NOT NULL,
                    llm_status TEXT NOT NULL,
                    llm_detail TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    auto INTEGER NOT NULL DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS bot_settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                """
            )

    def add_attendance(self, user_id: int, event_type: str, note: str, at: datetime) -> int:
        with self.connect() as conn:
            cur = conn.execute(
                """
                INSERT INTO attendance_events (user_id, event_type, note, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (user_id, event_type, note.strip(), at.isoformat()),
            )
            return int(cur.lastrowid)

    def add_note(self, user_id: int, note: str, at: datetime) -> int:
        with self.connect() as conn:
            cur = conn.execute(
                """
                INSERT INTO work_notes (user_id, note, created_at)
                VALUES (?, ?, ?)
                """,
                (user_id, note.strip(), at.isoformat()),
            )
            return int(cur.lastrowid)

    def record_report(
        self,
        user_id: int,
        report_date: date,
        report_type: str,
        content: str,
        llm_status: str,
        llm_detail: str,
        at: datetime,
        auto: bool,
    ) -> int:
        with self.connect() as conn:
            cur = conn.execute(
                """
                INSERT INTO report_runs
                    (user_id, report_date, report_type, content, llm_status, llm_detail, created_at, auto)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    user_id,
                    report_date.isoformat(),
                    report_type,
                    content,
                    llm_status,
                    llm_detail,
                    at.isoformat(),
                    1 if auto else 0,
                ),
            )
            return int(cur.lastrowid)

    def list_attendance_for_day(self, user_id: int, target: date, tz: tzinfo) -> list[AttendanceEvent]:
        start, end = day_bounds(target, tz)
        rows = self._select_between(
            "attendance_events",
            user_id,
            start.isoformat(),
            end.isoformat(),
            "id, user_id, event_type, note, created_at",
        )
        return [
            AttendanceEvent(
                id=int(row["id"]),
                user_id=int(row["user_id"]),
                event_type=str(row["event_type"]),
                note=str(row["note"]),
                created_at=datetime.fromisoformat(str(row["created_at"])),
            )
            for row in rows
        ]

    def list_notes_for_day(self, user_id: int, target: date, tz: tzinfo) -> list[WorkNote]:
        start, end = day_bounds(target, tz)
        rows = self._select_between(
            "work_notes",
            user_id,
            start.isoformat(),
            end.isoformat(),
            "id, user_id, note, created_at",
        )
        return [
            WorkNote(
                id=int(row["id"]),
                user_id=int(row["user_id"]),
                note=str(row["note"]),
                created_at=datetime.fromisoformat(str(row["created_at"])),
            )
            for row in rows
        ]

    def latest_attendance_for_day(
        self,
        user_id: int,
        target: date,
        tz: tzinfo,
    ) -> AttendanceEvent | None:
        events = self.list_attendance_for_day(user_id, target, tz)
        return events[-1] if events else None

    def list_attendance_for_month(self, user_id: int, year: int, month: int, tz: tzinfo) -> list[AttendanceEvent]:
        start = datetime(year, month, 1, tzinfo=tz)
        if month == 12:
            end = datetime(year + 1, 1, 1, tzinfo=tz)
        else:
            end = datetime(year, month + 1, 1, tzinfo=tz)
        rows = self._select_between(
            "attendance_events",
            user_id,
            start.isoformat(),
            end.isoformat(),
            "id, user_id, event_type, note, created_at",
        )
        return [
            AttendanceEvent(
                id=int(row["id"]),
                user_id=int(row["user_id"]),
                event_type=str(row["event_type"]),
                note=str(row["note"]),
                created_at=datetime.fromisoformat(str(row["created_at"])),
            )
            for row in rows
        ]

    def _select_between(
        self,
        table: str,
        user_id: int,
        start: str,
        end: str,
        columns: str,
    ) -> list[sqlite3.Row]:
        with self.connect() as conn:
            cur = conn.execute(
                f"""
                SELECT {columns}
                FROM {table}
                WHERE user_id = ? AND created_at >= ? AND created_at < ?
                ORDER BY created_at ASC, id ASC
                """,
                (user_id, start, end),
            )
            return list(cur.fetchall())
