from __future__ import annotations

import asyncio
import json
import urllib.error
import urllib.request
from dataclasses import dataclass


@dataclass(frozen=True)
class TelegramResponse:
    ok: bool
    payload: dict


class TelegramClient:
    def __init__(self, token: str, timeout_seconds: int = 20):
        self.token = token
        self.timeout_seconds = timeout_seconds

    @property
    def api_base(self) -> str:
        return f"https://api.telegram.org/bot{self.token}"

    async def send_message(self, chat_id: int, text: str) -> None:
        for chunk in _chunk_message(text):
            await asyncio.to_thread(self._post_json, "sendMessage", {"chat_id": chat_id, "text": chunk})

    async def get_webhook_info(self) -> TelegramResponse:
        payload = await asyncio.to_thread(self._post_json, "getWebhookInfo", {})
        return TelegramResponse(ok=bool(payload.get("ok")), payload=payload)

    def _post_json(self, method: str, payload: dict) -> dict:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(
            f"{self.api_base}/{method}",
            data=data,
            headers={"Content-Type": "application/json; charset=utf-8"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout_seconds) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Telegram API HTTP {exc.code}: {body}") from exc


def _chunk_message(text: str, limit: int = 3500) -> list[str]:
    if len(text) <= limit:
        return [text]
    chunks: list[str] = []
    remaining = text
    while remaining:
        chunks.append(remaining[:limit])
        remaining = remaining[limit:]
    return chunks

