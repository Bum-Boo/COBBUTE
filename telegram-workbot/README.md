# Telegram Local LLM Workbot

Personal Telegram DM bot for attendance logging, work notes, and local LLM-assisted Korean work reports.

This project is intentionally separate from the existing AnythingLLM bundle and local AI resource manager. It uses the existing resource manager at `..\local-ai-resource-manager.ps1` for Ollama routing, so ComfyUI/VRAM policy stays in one place.

## Features

- `/출근 [메모]` and `/퇴근 [메모]`
- `/메모 내용`
- `/보고서 [오늘|어제|YYYY-MM-DD]`
- `/오늘요약 [텍스트]`
- `/내근태 [YYYY-MM]`
- `/상태`
- Weekday auto report at `18:30` Asia/Seoul by default
- SQLite-only local storage
- Owner-only DM access

## Setup

```powershell
cd C:\Users\Hojun\Desktop\Bumboo\AGENTS\telegram-workbot
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -U pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Edit `.env`:

```text
TELEGRAM_BOT_TOKEN=
BOT_OWNER_TELEGRAM_ID=
WEBHOOK_SECRET=
PUBLIC_WEBHOOK_BASE_URL=
```

## Cloudflare Quick Tunnel

Install `cloudflared` if it is not already available:

```powershell
winget install --id Cloudflare.cloudflared -e
```

Run the local server:

```powershell
.\.venv\Scripts\python.exe -m uvicorn workbot.main:app --host 127.0.0.1 --port 8088
```

In another PowerShell:

```powershell
cloudflared tunnel --url http://127.0.0.1:8088
```

Copy the generated `https://*.trycloudflare.com` URL into `.env` as `PUBLIC_WEBHOOK_BASE_URL`, then register the webhook:

```powershell
.\.venv\Scripts\python.exe .\scripts\set_webhook.py
```

Delete the webhook if needed:

```powershell
.\.venv\Scripts\python.exe .\scripts\delete_webhook.py
```

## Tests

```powershell
.\.venv\Scripts\python.exe -m pytest
```

The tests mock Telegram and the LLM resource manager; they do not call the network or Ollama.
