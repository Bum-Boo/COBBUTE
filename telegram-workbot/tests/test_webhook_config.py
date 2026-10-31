from __future__ import annotations

import asyncio
import importlib
import json
import sys

import pytest

from workbot.config import load_settings, parse_env_value


ENV_KEYS = [
    "TELEGRAM_BOT_TOKEN",
    "BOT_OWNER_TELEGRAM_ID",
    "WEBHOOK_SECRET",
    "PUBLIC_WEBHOOK_BASE_URL",
    "REPORT_TIME",
    "TIMEZONE",
    "PORT",
    "LLM_TIMEOUT_SECONDS",
    "AUTO_REPORT_ENABLED",
    "DATABASE_PATH",
]


@pytest.fixture
def clean_env(monkeypatch, tmp_path):
    for key in ENV_KEYS:
        monkeypatch.delenv(key, raising=False)
    # Never read a developer's real .env during tests.
    monkeypatch.setattr("workbot.config.PROJECT_ROOT", tmp_path)
    monkeypatch.setenv("DATABASE_PATH", str(tmp_path / "db.sqlite3"))
    return monkeypatch


def import_main(monkeypatch, tmp_path):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "123:fake")
    monkeypatch.setenv("BOT_OWNER_TELEGRAM_ID", "100")
    monkeypatch.setenv("WEBHOOK_SECRET", "s3cr3t-value")
    monkeypatch.setenv("PUBLIC_WEBHOOK_BASE_URL", "https://example.invalid")
    sys.modules.pop("workbot.main", None)
    return importlib.import_module("workbot.main")


def test_healthz_does_not_expose_webhook_secret(clean_env, tmp_path):
    main = import_main(clean_env, tmp_path)
    body = asyncio.run(main.healthz())
    assert "s3cr3t-value" not in json.dumps(body)


class FakeRequest:
    def __init__(self, payload):
        self.payload = payload

    async def json(self):
        return self.payload


class ExplodingBot:
    async def handle_update(self, update):
        raise RuntimeError("Telegram API HTTP 502")


def test_webhook_acknowledges_update_even_if_handling_fails(clean_env, tmp_path):
    # A 5xx makes Telegram redeliver, which stored the same note again.
    main = import_main(clean_env, tmp_path)
    main.app.state.bot = ExplodingBot()
    result = asyncio.run(main.telegram_webhook("s3cr3t-value", FakeRequest({"update_id": 7})))
    assert result == {"ok": True}


def test_webhook_rejects_wrong_secret(clean_env, tmp_path):
    from fastapi import HTTPException

    main = import_main(clean_env, tmp_path)
    with pytest.raises(HTTPException) as info:
        asyncio.run(main.telegram_webhook("s3cr3t-valuX", FakeRequest({})))
    assert info.value.status_code == 404


def test_empty_webhook_secret_is_reported_as_missing(clean_env):
    clean_env.setenv("TELEGRAM_BOT_TOKEN", "123:fake")
    clean_env.setenv("BOT_OWNER_TELEGRAM_ID", "100")
    clean_env.setenv("PUBLIC_WEBHOOK_BASE_URL", "https://example.invalid")
    clean_env.setenv("WEBHOOK_SECRET", "")
    with pytest.raises(RuntimeError, match="WEBHOOK_SECRET"):
        load_settings(validate=True)


def test_dotenv_inline_comments_are_stripped(clean_env, tmp_path):
    (tmp_path / ".env").write_text(
        "REPORT_TIME=18:30  # KST\nAUTO_REPORT_ENABLED=true # on\nWEBHOOK_SECRET='abc#def'\n",
        encoding="utf-8",
    )
    settings = load_settings()
    assert settings.report_time == "18:30"
    assert settings.auto_report_enabled is True
    assert settings.webhook_secret == "abc#def"


def test_parse_env_value_keeps_hash_inside_unquoted_value():
    assert parse_env_value("abc#def") == "abc#def"
    assert parse_env_value('"quoted # value"') == "quoted # value"
    assert parse_env_value("  # only a comment") == ""


def test_bad_integer_env_names_the_variable(clean_env):
    clean_env.setenv("BOT_OWNER_TELEGRAM_ID", "@me")
    with pytest.raises(ValueError, match="BOT_OWNER_TELEGRAM_ID"):
        load_settings()
