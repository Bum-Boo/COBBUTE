from __future__ import annotations

import os
import secrets
from dataclasses import dataclass
from datetime import timedelta, timezone, tzinfo
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def load_dotenv(path: Path | None = None) -> None:
    env_path = path or PROJECT_ROOT / ".env"
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def _bool_env(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def _path_env(name: str, default: str) -> Path:
    raw = os.getenv(name, default)
    path = Path(raw)
    if not path.is_absolute():
        path = PROJECT_ROOT / path
    return path.resolve()


def parse_report_time(value: str) -> tuple[int, int]:
    try:
        hour_text, minute_text = value.strip().split(":", 1)
        hour = int(hour_text)
        minute = int(minute_text)
    except ValueError as exc:
        raise ValueError("REPORT_TIME must be HH:MM") from exc

    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        raise ValueError("REPORT_TIME must be a valid 24-hour HH:MM value")
    return hour, minute


def get_tzinfo(name: str) -> tzinfo:
    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError:
        if name == "Asia/Seoul":
            return timezone(timedelta(hours=9), "Asia/Seoul")
        raise


@dataclass(frozen=True)
class Settings:
    telegram_bot_token: str
    bot_owner_telegram_id: int | None
    webhook_secret: str
    public_webhook_base_url: str
    report_time: str
    timezone: str
    host: str
    port: int
    database_path: Path
    resource_manager_path: Path
    powershell_exe: str
    llm_timeout_seconds: int
    auto_report_enabled: bool

    @property
    def tzinfo(self) -> tzinfo:
        return get_tzinfo(self.timezone)

    @property
    def report_hour_minute(self) -> tuple[int, int]:
        return parse_report_time(self.report_time)

    @property
    def webhook_path(self) -> str:
        return f"/telegram/webhook/{self.webhook_secret}"

    @property
    def webhook_url(self) -> str:
        return f"{self.public_webhook_base_url.rstrip('/')}{self.webhook_path}"

    def validate_required(self) -> None:
        missing: list[str] = []
        if not self.telegram_bot_token:
            missing.append("TELEGRAM_BOT_TOKEN")
        if self.bot_owner_telegram_id is None:
            missing.append("BOT_OWNER_TELEGRAM_ID")
        if not self.webhook_secret:
            missing.append("WEBHOOK_SECRET")
        if not self.public_webhook_base_url:
            missing.append("PUBLIC_WEBHOOK_BASE_URL")
        if missing:
            raise RuntimeError("Missing required environment variables: " + ", ".join(missing))


def load_settings(validate: bool = False) -> Settings:
    load_dotenv()
    owner_raw = os.getenv("BOT_OWNER_TELEGRAM_ID", "").strip()
    owner_id = int(owner_raw) if owner_raw else None
    secret = os.getenv("WEBHOOK_SECRET", "").strip() or secrets.token_urlsafe(24)

    settings = Settings(
        telegram_bot_token=os.getenv("TELEGRAM_BOT_TOKEN", "").strip(),
        bot_owner_telegram_id=owner_id,
        webhook_secret=secret,
        public_webhook_base_url=os.getenv("PUBLIC_WEBHOOK_BASE_URL", "").strip(),
        report_time=os.getenv("REPORT_TIME", "18:30").strip(),
        timezone=os.getenv("TIMEZONE", "Asia/Seoul").strip(),
        host=os.getenv("HOST", "127.0.0.1").strip(),
        port=int(os.getenv("PORT", "8088")),
        database_path=_path_env("DATABASE_PATH", "data/workbot.sqlite3"),
        resource_manager_path=_path_env("RESOURCE_MANAGER_PATH", "../local-ai-resource-manager.ps1"),
        powershell_exe=os.getenv("POWERSHELL_EXE", "powershell").strip(),
        llm_timeout_seconds=int(os.getenv("LLM_TIMEOUT_SECONDS", "180")),
        auto_report_enabled=_bool_env("AUTO_REPORT_ENABLED", True),
    )
    settings.report_hour_minute
    settings.tzinfo
    if validate:
        settings.validate_required()
    return settings
