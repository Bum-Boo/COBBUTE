from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path

from workbot.config import Settings
from workbot.scheduler import scheduler_cron_kwargs


def test_scheduler_uses_weekday_1830_asia_seoul(tmp_path: Path) -> None:
    settings = Settings(
        telegram_bot_token="token",
        bot_owner_telegram_id=100,
        webhook_secret="secret",
        public_webhook_base_url="https://example.trycloudflare.com",
        report_time="18:30",
        timezone="Asia/Seoul",
        host="127.0.0.1",
        port=8088,
        database_path=tmp_path / "db.sqlite3",
        resource_manager_path=tmp_path / "manager.ps1",
        powershell_exe="powershell",
        llm_timeout_seconds=1,
        auto_report_enabled=True,
    )

    kwargs = scheduler_cron_kwargs(settings)
    assert kwargs["day_of_week"] == "mon-fri"
    assert kwargs["hour"] == 18
    assert kwargs["minute"] == 30
    assert kwargs["timezone"].utcoffset(datetime(2026, 6, 4)) == timedelta(hours=9)
