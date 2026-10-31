from __future__ import annotations

import asyncio

import pytest

from workbot.commands import parse_command
from workbot.telegram_api import _chunk_message
from workbot.timeutils import parse_month_arg

from test_bot import fixed_clock, make_bot, make_update


@pytest.mark.parametrize(
    "text, name, args",
    [
        ("/메모\n고객사 미팅\n견적 전달", "메모", "고객사 미팅\n견적 전달"),
        ("/메모\t탭 구분", "메모", "탭 구분"),
        ("/메모　전각 공백", "메모", "전각 공백"),
        ("/출근@WorkBot 재택", "출근", "재택"),
        ("/상태", "상태", ""),
    ],
)
def test_command_split_on_any_whitespace(text, name, args):
    command = parse_command(text)
    assert command is not None
    assert (command.name, command.args) == (name, args)


def test_multiline_note_is_saved(tmp_path):
    bot, telegram, db = make_bot(tmp_path)
    asyncio.run(bot.handle_update(make_update(100, "/메모\n고객사 미팅")))
    assert "메모 저장 완료" in telegram.messages[-1][1]
    notes = db.list_notes_for_day(100, fixed_clock(None).date(), fixed_clock(None).tzinfo)
    assert [note.note for note in notes] == ["고객사 미팅"]


@pytest.mark.parametrize("value", ["0-06", "9999-12", "10000-01"])
def test_month_out_of_range_is_a_format_error(value):
    with pytest.raises(ValueError):
        parse_month_arg(value, fixed_clock(None).date())


def test_month_out_of_range_replies_instead_of_crashing(tmp_path):
    bot, telegram, _ = make_bot(tmp_path)
    asyncio.run(bot.handle_update(make_update(100, "/내근태 0-06")))
    assert "월 형식이 올바르지 않습니다" in telegram.messages[-1][1]


@pytest.mark.parametrize(
    "message",
    [
        {"chat": {"id": -100, "type": "channel"}, "text": "/출근"},
        {"from": {"id": 100}, "text": "/출근"},
        {"from": {}, "chat": {"id": 100, "type": "private"}, "text": "/출근"},
    ],
)
def test_update_without_sender_or_chat_is_ignored(tmp_path, message):
    bot, telegram, db = make_bot(tmp_path)
    asyncio.run(bot.handle_update({"update_id": 1, "message": message}))
    assert telegram.messages == []
    assert db.list_attendance_for_day(100, fixed_clock(None).date(), fixed_clock(None).tzinfo) == []


def utf16_len(text: str) -> int:
    return len(text.encode("utf-16-le")) // 2


def test_chunks_respect_telegram_utf16_limit():
    text = "😀" * 3500 + "가" * 1000
    chunks = _chunk_message(text)
    assert "".join(chunks) == text
    assert all(utf16_len(chunk) <= 3500 for chunk in chunks)


def test_short_message_is_a_single_chunk():
    assert _chunk_message("안녕하세요") == ["안녕하세요"]
