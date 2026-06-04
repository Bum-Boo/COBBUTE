from __future__ import annotations

from datetime import date, datetime, timedelta, tzinfo


KOREAN_DATE_WORDS = {"오늘", "금일"}


def now_in(tz: tzinfo) -> datetime:
    return datetime.now(tz)


def parse_day_arg(value: str, today: date) -> date:
    text = value.strip()
    if not text or text in KOREAN_DATE_WORDS:
        return today
    if text == "어제":
        return today - timedelta(days=1)
    return date.fromisoformat(text)


def parse_month_arg(value: str, today: date) -> tuple[int, int]:
    text = value.strip()
    if not text:
        return today.year, today.month
    parts = text.split("-")
    if len(parts) != 2:
        raise ValueError("month must be YYYY-MM")
    year = int(parts[0])
    month = int(parts[1])
    if not 1 <= month <= 12:
        raise ValueError("month must be 1-12")
    return year, month


def day_bounds(target: date, tz: tzinfo) -> tuple[datetime, datetime]:
    start = datetime(target.year, target.month, target.day, tzinfo=tz)
    return start, start + timedelta(days=1)
