from __future__ import annotations

from datetime import date

import pytest

from workbot.commands import parse_command
from workbot.config import parse_report_time
from workbot.timeutils import parse_day_arg, parse_month_arg


def test_parse_korean_command_with_bot_username() -> None:
    parsed = parse_command("/보고서@mybot 어제")
    assert parsed is not None
    assert parsed.name == "보고서"
    assert parsed.args == "어제"


def test_parse_day_words() -> None:
    today = date(2026, 6, 4)
    assert parse_day_arg("오늘", today) == today
    assert parse_day_arg("어제", today) == date(2026, 6, 3)
    assert parse_day_arg("2026-05-31", today) == date(2026, 5, 31)


def test_parse_month_and_report_time_validation() -> None:
    assert parse_month_arg("2026-06", date(2026, 6, 4)) == (2026, 6)
    assert parse_report_time("18:30") == (18, 30)
    with pytest.raises(ValueError):
        parse_report_time("25:00")

