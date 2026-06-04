from __future__ import annotations

from .config import Settings


def scheduler_cron_kwargs(settings: Settings) -> dict:
    hour, minute = settings.report_hour_minute
    return {
        "day_of_week": "mon-fri",
        "hour": hour,
        "minute": minute,
        "timezone": settings.tzinfo,
    }


def install_scheduler(app, bot, settings: Settings):
    from apscheduler.schedulers.asyncio import AsyncIOScheduler

    scheduler = AsyncIOScheduler(timezone=settings.tzinfo)
    if settings.auto_report_enabled:
        scheduler.add_job(bot.send_auto_report, "cron", **scheduler_cron_kwargs(settings))
    scheduler.start()
    app.state.scheduler = scheduler
    return scheduler
