from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path

from workbot.bot import Workbot
from workbot.config import Settings
from workbot.db import Database
from workbot.llm import LLMResult


class FakeTelegram:
    def __init__(self) -> None:
        self.messages: list[tuple[int, str]] = []

    async def send_message(self, chat_id: int, text: str) -> None:
        self.messages.append((chat_id, text))

    async def get_webhook_info(self):
        class Response:
            ok = True
            payload = {
                "ok": True,
                "result": {
                    "url": "https://example.trycloudflare.com/telegram/webhook/secret",
                    "pending_update_count": 0,
                },
            }

        return Response()


class FakeLLM:
    def __init__(self, result: LLMResult | None = None) -> None:
        self.result = result or LLMResult("queued", "", "test queue")
        self.prompts: list[str] = []

    def generate(self, prompt: str) -> LLMResult:
        self.prompts.append(prompt)
        return self.result

    def status_json(self) -> tuple[bool, str]:
        return True, "fake status"


def make_settings(tmp_path: Path) -> Settings:
    return Settings(
        telegram_bot_token="token",
        bot_owner_telegram_id=100,
        webhook_secret="secret",
        public_webhook_base_url="https://example.trycloudflare.com",
        report_time="18:30",
        timezone="Asia/Seoul",
        host="127.0.0.1",
        port=8088,
        database_path=tmp_path / "workbot.sqlite3",
        resource_manager_path=tmp_path / "missing.ps1",
        powershell_exe="powershell",
        llm_timeout_seconds=1,
        auto_report_enabled=True,
    )


def make_update(user_id: int, text: str, chat_type: str = "private") -> dict:
    return {
        "update_id": 1,
        "message": {
            "message_id": 1,
            "from": {"id": user_id},
            "chat": {"id": user_id, "type": chat_type},
            "text": text,
        },
    }


KST = timezone(timedelta(hours=9), "Asia/Seoul")


def fixed_clock(_) -> datetime:
    return datetime(2026, 6, 4, 9, 0, tzinfo=KST)


def make_bot(tmp_path: Path, llm: FakeLLM | None = None) -> tuple[Workbot, FakeTelegram, Database]:
    settings = make_settings(tmp_path)
    db = Database(settings.database_path)
    db.init()
    telegram = FakeTelegram()
    bot = Workbot(settings, db, telegram, llm or FakeLLM(), clock=fixed_clock)
    return bot, telegram, db


def test_rejects_non_owner_without_persisting(tmp_path: Path) -> None:
    bot, telegram, db = make_bot(tmp_path)
    asyncio.run(bot.handle_update(make_update(200, "/출근")))
    assert "권한이 없습니다" in telegram.messages[-1][1]
    assert db.list_attendance_for_day(100, fixed_clock(KST).date(), KST) == []


def test_attendance_duplicate_check_in(tmp_path: Path) -> None:
    bot, telegram, db = make_bot(tmp_path)
    asyncio.run(bot.handle_update(make_update(100, "/출근 사무실 도착")))
    asyncio.run(bot.handle_update(make_update(100, "/출근 다시")))

    events = db.list_attendance_for_day(100, fixed_clock(KST).date(), KST)
    assert len(events) == 1
    assert "이미 오늘 출근 기록" in telegram.messages[-1][1]


def test_check_in_then_check_out_and_month_attendance(tmp_path: Path) -> None:
    bot, telegram, db = make_bot(tmp_path)
    asyncio.run(bot.handle_update(make_update(100, "/출근")))
    asyncio.run(bot.handle_update(make_update(100, "/퇴근 업무 종료")))
    asyncio.run(bot.handle_update(make_update(100, "/내근태 2026-06")))

    events = db.list_attendance_for_day(100, fixed_clock(KST).date(), KST)
    assert [event.event_type for event in events] == ["check_in", "check_out"]
    assert "2026-06-04" in telegram.messages[-1][1]
    assert "출근 09:00" in telegram.messages[-1][1]
    assert "퇴근 09:00" in telegram.messages[-1][1]


def test_report_falls_back_when_llm_queued_and_records_run(tmp_path: Path) -> None:
    bot, telegram, db = make_bot(tmp_path, FakeLLM(LLMResult("queued", "", "VRAM low")))
    asyncio.run(bot.handle_update(make_update(100, "/출근")))
    asyncio.run(bot.handle_update(make_update(100, "/메모 고객사 미팅 완료")))
    asyncio.run(bot.handle_update(make_update(100, "/보고서 오늘")))

    last = telegram.messages[-1][1]
    assert "fallback 보고서 사용" in last
    assert "고객사 미팅 완료" in last
    with db.connect() as conn:
        rows = conn.execute("SELECT llm_status FROM report_runs").fetchall()
    assert rows[0]["llm_status"] == "queued"


def test_report_without_notes_uses_deterministic_empty_section(tmp_path: Path) -> None:
    bot, telegram, _ = make_bot(tmp_path, FakeLLM(LLMResult("queued", "", "VRAM low")))
    asyncio.run(bot.handle_update(make_update(100, "/보고서 오늘")))

    assert "등록된 업무 메모 없음" in telegram.messages[-1][1]


def test_report_marks_missing_checkout(tmp_path: Path) -> None:
    bot, telegram, _ = make_bot(tmp_path, FakeLLM(LLMResult("error", "", "offline")))
    asyncio.run(bot.handle_update(make_update(100, "/출근")))
    asyncio.run(bot.handle_update(make_update(100, "/보고서 오늘")))

    assert "퇴근 기록 없음" in telegram.messages[-1][1]


def test_llm_success_report_uses_model_output(tmp_path: Path) -> None:
    bot, telegram, _ = make_bot(tmp_path, FakeLLM(LLMResult("success", "모델 보고서", "ok", "qwen3:8b")))
    asyncio.run(bot.handle_update(make_update(100, "/보고서 오늘")))

    assert "모델 보고서" in telegram.messages[-1][1]
    assert "fallback" not in telegram.messages[-1][1]


def test_today_summary_without_text_uses_today_notes(tmp_path: Path) -> None:
    bot, telegram, _ = make_bot(tmp_path, FakeLLM(LLMResult("queued", "", "VRAM low")))
    asyncio.run(bot.handle_update(make_update(100, "/메모 견적서 수정 완료")))
    asyncio.run(bot.handle_update(make_update(100, "/오늘요약")))

    assert "견적서 수정 완료" in telegram.messages[-1][1]
    assert "fallback 요약 사용" in telegram.messages[-1][1]


def test_status_command_reports_resource_manager_state(tmp_path: Path) -> None:
    bot, telegram, _ = make_bot(tmp_path)
    asyncio.run(bot.handle_update(make_update(100, "/상태")))

    assert "Resource manager: OK" in telegram.messages[-1][1]
    assert "Webhook path:" in telegram.messages[-1][1]
    assert "Telegram webhook:" in telegram.messages[-1][1]
