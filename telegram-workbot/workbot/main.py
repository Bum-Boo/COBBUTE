from __future__ import annotations

import hmac
import logging

from fastapi import FastAPI, HTTPException, Request

from .bot import Workbot
from .config import load_settings
from .db import Database
from .llm import ResourceManagerClient
from .scheduler import install_scheduler
from .telegram_api import TelegramClient


settings = load_settings(validate=True)
logger = logging.getLogger(__name__)
app = FastAPI(title="Telegram Local LLM Workbot", version="0.1.0")


@app.on_event("startup")
async def startup() -> None:
    db = Database(settings.database_path)
    db.init()
    telegram = TelegramClient(settings.telegram_bot_token)
    llm = ResourceManagerClient(
        script_path=settings.resource_manager_path,
        powershell_exe=settings.powershell_exe,
        timeout_seconds=settings.llm_timeout_seconds,
    )
    bot = Workbot(settings=settings, db=db, telegram=telegram, llm=llm)
    app.state.db = db
    app.state.bot = bot
    install_scheduler(app, bot, settings)


@app.on_event("shutdown")
async def shutdown() -> None:
    scheduler = getattr(app.state, "scheduler", None)
    if scheduler:
        scheduler.shutdown(wait=False)


@app.get("/healthz")
async def healthz() -> dict:
    # The webhook path embeds WEBHOOK_SECRET, so it must not be published here.
    return {"ok": True}


@app.post("/telegram/webhook/{secret}")
async def telegram_webhook(secret: str, request: Request) -> dict:
    if not hmac.compare_digest(secret.encode("utf-8"), settings.webhook_secret.encode("utf-8")):
        raise HTTPException(status_code=404, detail="Not found")
    payload = await request.json()
    try:
        await app.state.bot.handle_update(payload)
    except Exception:
        # A non-2xx response makes Telegram redeliver the update, which would
        # store the same note or attendance record again.
        update_id = payload.get("update_id") if isinstance(payload, dict) else None
        logger.exception("Failed to handle Telegram update %s", update_id)
    return {"ok": True}

