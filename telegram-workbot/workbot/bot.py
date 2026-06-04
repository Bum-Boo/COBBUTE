from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime

from .commands import SUPPORTED_COMMANDS, help_text, parse_command
from .config import Settings
from .db import AttendanceEvent, Database
from .llm import ResourceManagerClient
from .reports import ReportService
from .telegram_api import TelegramClient
from .timeutils import now_in, parse_day_arg, parse_month_arg


class Workbot:
    def __init__(
        self,
        settings: Settings,
        db: Database,
        telegram: TelegramClient,
        llm: ResourceManagerClient,
        clock=now_in,
    ):
        self.settings = settings
        self.db = db
        self.telegram = telegram
        self.llm = llm
        self.clock = clock
        self.reports = ReportService(db, llm, settings.tzinfo)

    async def handle_update(self, update: dict) -> None:
        message = update.get("message") or {}
        text = str(message.get("text") or "")
        if not text:
            return

        chat = message.get("chat") or {}
        chat_id = int(chat.get("id"))
        chat_type = str(chat.get("type") or "")
        user = message.get("from") or {}
        user_id = int(user.get("id"))

        if self.settings.bot_owner_telegram_id is None or user_id != self.settings.bot_owner_telegram_id:
            await self.telegram.send_message(chat_id, "권한이 없습니다. 이 봇은 등록된 소유자 DM 전용입니다.")
            return

        if chat_type and chat_type != "private":
            await self.telegram.send_message(chat_id, "이 봇은 개인 DM에서만 사용합니다.")
            return

        command = parse_command(text)
        if command is None:
            return

        if command.name not in SUPPORTED_COMMANDS:
            await self.telegram.send_message(chat_id, "지원하지 않는 명령입니다.\n\n" + help_text())
            return

        now = self.clock(self.settings.tzinfo)
        if command.name == "start":
            await self.telegram.send_message(chat_id, "등록 완료.\n\n" + help_text())
        elif command.name == "출근":
            await self._attendance(chat_id, user_id, "check_in", command.args, now)
        elif command.name == "퇴근":
            await self._attendance(chat_id, user_id, "check_out", command.args, now)
        elif command.name == "메모":
            await self._note(chat_id, user_id, command.args, now)
        elif command.name == "보고서":
            await self._daily_report(chat_id, user_id, command.args, now, auto=False)
        elif command.name == "오늘요약":
            await self._summary(chat_id, user_id, command.args, now)
        elif command.name == "내근태":
            await self._month_attendance(chat_id, user_id, command.args, now.date())
        elif command.name == "상태":
            await self._status(chat_id)

    async def send_auto_report(self) -> None:
        if self.settings.bot_owner_telegram_id is None:
            return
        now = self.clock(self.settings.tzinfo)
        if now.weekday() >= 5:
            return
        await self._daily_report(
            chat_id=self.settings.bot_owner_telegram_id,
            user_id=self.settings.bot_owner_telegram_id,
            arg="오늘",
            now=now,
            auto=True,
        )

    async def _attendance(self, chat_id: int, user_id: int, event_type: str, note: str, now: datetime) -> None:
        latest = self.db.latest_attendance_for_day(user_id, now.date(), self.settings.tzinfo)
        if latest and latest.event_type == event_type:
            label = "출근" if event_type == "check_in" else "퇴근"
            await self.telegram.send_message(chat_id, f"이미 오늘 {label} 기록이 있습니다: {latest.created_at.strftime('%H:%M')}")
            return

        self.db.add_attendance(user_id, event_type, note, now)
        label = "출근" if event_type == "check_in" else "퇴근"
        suffix = f"\n메모: {note.strip()}" if note.strip() else ""
        await self.telegram.send_message(chat_id, f"{label} 기록 완료: {now.strftime('%Y-%m-%d %H:%M')}{suffix}")

    async def _note(self, chat_id: int, user_id: int, note: str, now: datetime) -> None:
        if not note.strip():
            await self.telegram.send_message(chat_id, "업무 메모 내용을 입력하세요. 예: /메모 고객사 미팅 완료")
            return
        self.db.add_note(user_id, note, now)
        await self.telegram.send_message(chat_id, f"메모 저장 완료: {now.strftime('%H:%M')}")

    async def _daily_report(self, chat_id: int, user_id: int, arg: str, now: datetime, auto: bool) -> None:
        try:
            target = parse_day_arg(arg, now.date())
        except ValueError:
            await self.telegram.send_message(chat_id, "날짜 형식이 올바르지 않습니다. 예: /보고서 오늘, /보고서 어제, /보고서 2026-06-04")
            return

        result = self.reports.generate_daily_report(user_id, target, now, auto=auto)
        prefix = "자동 일일보고" if auto else "일일보고"
        status = "" if result.llm_status == "success" else f"\n\nLLM 상태: {result.llm_status} - fallback 보고서 사용"
        await self.telegram.send_message(chat_id, f"{prefix}\n\n{result.content}{status}")

    async def _summary(self, chat_id: int, user_id: int, text: str, now: datetime) -> None:
        if text.strip():
            result = self.reports.summarize_text(now.date(), text)
        else:
            result = self.reports.summarize_today_notes(user_id, now.date())
        status = "" if result.llm_status == "success" else f"\n\nLLM 상태: {result.llm_status} - fallback 요약 사용"
        await self.telegram.send_message(chat_id, f"{result.content}{status}")

    async def _month_attendance(self, chat_id: int, user_id: int, arg: str, today: date) -> None:
        try:
            year, month = parse_month_arg(arg, today)
        except ValueError:
            await self.telegram.send_message(chat_id, "월 형식이 올바르지 않습니다. 예: /내근태 2026-06")
            return

        events = self.db.list_attendance_for_month(user_id, year, month, self.settings.tzinfo)
        await self.telegram.send_message(chat_id, format_month_attendance(year, month, events))

    async def _status(self, chat_id: int) -> None:
        db_ok = self.settings.database_path.exists()
        manager_ok, manager_text = self.llm.status_json()
        try:
            webhook_info = await self.telegram.get_webhook_info()
            if webhook_info.ok:
                webhook_result = webhook_info.payload.get("result") or {}
                webhook_line = (
                    f"- Telegram webhook: {webhook_result.get('url') or 'not set'} "
                    f"pending={webhook_result.get('pending_update_count', '?')}"
                )
            else:
                webhook_line = "- Telegram webhook: check failed"
        except Exception as exc:
            webhook_line = f"- Telegram webhook: check failed - {exc}"
        lines = [
            "상태",
            f"- DB: {'OK' if db_ok else 'not initialized'} ({self.settings.database_path})",
            f"- Webhook path: {self.settings.webhook_path}",
            webhook_line,
            f"- Public URL configured: {'yes' if self.settings.public_webhook_base_url else 'no'}",
            f"- Auto report: {'on' if self.settings.auto_report_enabled else 'off'} {self.settings.report_time} {self.settings.timezone}",
            f"- Resource manager: {'OK' if manager_ok else 'ERROR'} - {manager_text}",
        ]
        await self.telegram.send_message(chat_id, "\n".join(lines))


def format_month_attendance(year: int, month: int, events: list[AttendanceEvent]) -> str:
    grouped: dict[str, list[AttendanceEvent]] = defaultdict(list)
    for event in events:
        grouped[event.created_at.date().isoformat()].append(event)

    lines = [f"[{year:04d}-{month:02d} 근태]"]
    if not grouped:
        lines.append("- 기록 없음")
        return "\n".join(lines)

    for day in sorted(grouped):
        labels = []
        for event in grouped[day]:
            label = "출근" if event.event_type == "check_in" else "퇴근"
            labels.append(f"{label} {event.created_at.strftime('%H:%M')}")
        lines.append(f"- {day}: {', '.join(labels)}")
    return "\n".join(lines)
