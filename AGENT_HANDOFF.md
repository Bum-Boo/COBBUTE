# Agent Handoff Report

Last updated: 2026-06-04T18:46:29+09:00
Workspace: `C:\Users\Hojun\Desktop\Bumboo\AGENTS`

This file is the durable handoff and work log for local AI tooling work in this folder. Read it before making changes. After making changes, append a log entry at the bottom and update any stale status sections.

## Current Goal

Build and maintain a lightweight Windows local AI resource manager for a single RTX 4060 8 GB GPU shared by ComfyUI and Ollama.

The manager must stay rule-based and run-on-demand. Do not turn it into an always-on LLM manager or background service.

Current coordination direction: use soft turn flags and a generated dashboard snapshot so ComfyUI and Ollama do not compete for the RTX 4060 VRAM without an explicit handoff.

AnythingLLM integration direction: use the supported Custom Agent Skill extension point instead of patching the bundled desktop UI. The skill appears in AnythingLLM Agent Skills and returns status/plans inside the AnythingLLM chat UI.

Coordinator logging direction: every AnythingLLM coordinator skill action appends a structured JSONL record so persona assignment, model choice, issued commands, and progress can be audited after the run.

VRAM policy direction: do not use AnythingLLM as an always-on middle manager. AnythingLLM should be a UI/RAG/chat client used only when the Ollama turn is allowed; persistent coordination should stay in the lightweight PowerShell/JSON/dashboard manager.

CPU dispatcher direction: use `local-ai-dispatcher.ps1` as the default one-shot middle-manager entrypoint. It classifies requests and writes the coordinator log without keeping a process alive or touching VRAM unless `-Execute` is explicitly used.

## User Constraints

- PC uses ComfyUI and Ollama on the same RTX 4060 8 GB GPU.
- Main problem is VRAM contention.
- Do not install Docker, WSL, CUDA Toolkit, or change page file settings.
- Use existing Ollama models:
  - `qwen3:8b`
  - `qwen3:4b`
  - `gemma3:4b`
  - `qwen3-embedding:0.6b`
  - `qwen3-embedding:4b`

## Implemented Files

| File | Purpose | Status |
| --- | --- | --- |
| `local-ai-resource-manager.ps1` | Main PowerShell CLI resource manager. | Implemented and syntax-checked. |
| `local-ai-dispatcher.ps1` | CPU-only one-shot dispatcher for request classification, persona/model assignment, recommendations, optional turn-flag application, and coordinator logging. | Implemented and syntax-checked. |
| `local-ai-resource-manager.config.json` | Editable thresholds, model names, Ollama/ComfyUI endpoints, ComfyUI launch placeholders. | Implemented. Needs user-specific ComfyUI launch command. |
| `local-ai-resource-manager.md` | User-facing command documentation. | Implemented. |
| `local-ai-task-queue.jsonl` | Queue created only when tasks are deferred. | Not present unless queued tasks exist. |
| `local-ai-runtime-state.json` | Soft turn flags and waiting requests for ComfyUI/Ollama coordination. | Implemented. Current turn is `none/idle`. |
| `local-ai-dashboard.html` | Generated visual dashboard snapshot for live owner, turn flag, VRAM, and waiting queue. | Implemented. Re-run `dashboard` to refresh. |
| `local-ai-personas.json` | Local model role/persona map used by the AnythingLLM coordinator skill. | Implemented. |
| `local-ai-coordinator-log.jsonl` | Append-only coordinator run log with persona assignments, model choices, issued commands, and progress. | Implemented. Use a UTF-8 reader for Korean text. |
| `%APPDATA%\anythingllm-desktop\storage\plugins\agent-skills\local-ai-coordinator` | AnythingLLM Custom Agent Skill exposing local status, planning, turn flag commands, and optional thread creation. | Implemented. Reload AnythingLLM UI to see it. |
| `local-llm-models.md` | Existing model inventory and usage notes. | Existing reference. |
| `setup-local-llms.ps1` | Existing native Windows Ollama setup helper. | Existing reference. |
| `local-llm-tooling.md` | Existing broader local LLM tooling notes, including AnythingLLM/Obsidian-related setup. | Existing reference. |

## Manager Behavior

The manager supports:

- GPU VRAM status through `nvidia-smi`.
- Loaded Ollama model status through `ollama ps`.
- Stopping configured Ollama models before ComfyUI launch.
- ComfyUI detection by process match and ComfyUI API probe.
- ComfyUI generating detection through `http://127.0.0.1:8188/queue`.
- Text, vision, and embedding task routing.
- Queueing deferred tasks to JSONL.
- Soft turn flags:
  - `request comfyui|ollama`
  - `claim comfyui|ollama|mixed`
  - `release comfyui|ollama|mixed`
- Visual dashboard generation through `dashboard` and `dashboard -Open`.
- Live owner detection treats ComfyUI as the owner when it is running and free VRAM is below `min_vram_for_qwen4b`, even if the ComfyUI queue is idle.
- CPU-only one-shot dispatching through `local-ai-dispatcher.ps1`:
  - Default mode only reads state, classifies the objective, assigns a persona/model, logs the dispatch, recommends commands, and exits.
  - `-Apply` mutates only soft turn flags by calling the manager.
  - `-Execute` intentionally delegates to Ollama through the manager and may use VRAM.
- AnythingLLM custom skill integration:
  - `status`: show resource status and model roles in AnythingLLM UI.
  - `plan`: propose persona/model/thread split without mutating state.
  - `execute`: route a simple primary text-persona command through the manager when Ollama can safely run.
  - `orchestrate`: write a local run log and request or claim turn flags when needed.
  - `request`, `claim`, `release`, `dashboard`: bridge AnythingLLM agent calls into the manager.
  - Every skill action appends to `local-ai-coordinator-log.jsonl`.
  - Optional thread creation requires `ANYTHINGLLM_API_KEY` and `DEFAULT_WORKSPACE_SLUG` in skill settings.
- Launch profiles:
  - `creative`: ComfyUI priority, stop Ollama models first.
  - `mixed`: ComfyUI low-VRAM mode, allow only lightweight text routing.
  - `writing`: stop ComfyUI, allow `qwen3:8b`.

## Routing Rules

Config values are currently:

```json
{
  "min_vram_for_qwen8b": 6144,
  "min_vram_for_qwen4b": 3584,
  "default_context_length": 8192,
  "keep_alive": "0",
  "respect_turn_flags": true
}
```

Rules:

- If ComfyUI is generating, queue local LLM tasks.
- If ComfyUI holds the current turn flag, queue local LLM tasks even when ComfyUI is idle.
- If `mixed` holds the current turn flag, allow only lightweight text routing through `qwen3:4b`; queue vision/embedding work.
- If free VRAM is below `min_vram_for_qwen4b`, queue local LLM tasks.
- If free VRAM is from `min_vram_for_qwen4b` to below `min_vram_for_qwen8b`, use `qwen3:4b` with `keep_alive=0`.
- If free VRAM is above `min_vram_for_qwen8b` and ComfyUI is not running, use `qwen3:8b`.
- Use `gemma3:4b` only for image or screenshot understanding and only when ComfyUI is idle or closed.
- Use `qwen3-embedding:0.6b` for RAG/Obsidian embedding tasks.

## Latest Live Snapshot

Snapshot time: 2026-06-04T18:13:34+09:00

Command used:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\local-ai-resource-manager.ps1 state -Json
```

Observed result:

- GPU: NVIDIA GeForce RTX 4060.
- VRAM: about 873 MB free / 8188 MB total.
- ComfyUI: running, not generating.
- ComfyUI API: reachable; queue running/pending is 0/0.
- Ollama loaded models: none shown by `ollama ps`.
- Turn flag: `none/idle`.
- Queue: 0 tasks.
- Live owner: `comfyui`, because ComfyUI is running and free VRAM is below 3584 MB.
- Current text route: queued, because free VRAM is below 3584 MB.
- Ollama API: running at `http://127.0.0.1:11434`.

The snapshot is volatile. Re-run the status command before making routing or debugging decisions.

## Local LLM Tooling Status

Snapshot time: 2026-06-04T17:02:50+09:00

- Ollama is running and still has the intended five models: `qwen3:8b`, `qwen3:4b`, `gemma3:4b`, `qwen3-embedding:0.6b`, and `qwen3-embedding:4b`.
- Continue is installed as the VS Code extension `continue.continue`; local config exists at `C:\Users\Hojun\.continue\config.yaml`.
- AnythingLLM is installed as `AnythingLLM 1.13.0` and is running from `C:\Users\Hojun\Desktop\Bumboo\AGENTS\AnythingLLM\AnythingLLM.exe`.
- AnythingLLM `.env` is configured for external Ollama: `LLM_PROVIDER=ollama`, `OLLAMA_MODEL_PREF=qwen3:8b`, `EMBEDDING_ENGINE=ollama`, `EMBEDDING_MODEL_PREF=qwen3-embedding:0.6b`, and `DISABLE_TELEMETRY=true`.
- Latest AnythingLLM backend log confirms telemetry is disabled and `qwen3:8b` initializes through Ollama. Earlier log confirmed `OllamaEmbedder` initialized with `qwen3-embedding:0.6b`; validate with a small document upload if RAG behavior is in question.
- AnythingLLM internal Ollama partial model cache has 0 `*-partial*` files after cleanup.
- Page Assist is installed in Chrome `Default` profile, extension version `1.5.68_0`.
- Obsidian plugin state:
  - `C:\Users\Hojun\Documents\Obsidians\Link`: Copilot installed, Smart Connections installed.
  - `C:\Users\Hojun\Documents\Obsidians\Brain\Brain`: Copilot not installed, Smart Connections not installed.
  - `C:\Users\Hojun\Documents\Obsidians\Brain\Obsidian-Homepage-main\Rainbell`: Copilot not installed, Smart Connections not installed.

## Verification History

2026-06-04:

- PowerShell parser syntax check passed for `local-ai-resource-manager.ps1`.
- `local-ai-resource-manager.config.json` parsed successfully as JSON.
- `status` command successfully called `nvidia-smi`, `ollama ps`, and ComfyUI status detection.
- Earlier smoke test correctly queued text routing when `qwen3:8b` was loaded and free VRAM was below 3584 MB.
- Later smoke test correctly routed text to `qwen3:4b` when free VRAM was about 5461 MB and ComfyUI was closed.
- Turn flag smoke test correctly blocked text routing while `comfyui` held the turn, passed a waiting Ollama request on `release comfyui`, and returned to `none/idle` after `release ollama`.
- Dashboard generation created `local-ai-dashboard.html` and included expected markers for live owner, turn flag, waiting queue, and control commands.
- Browser plugin verification attempted to open the `file://` dashboard, but the in-app browser URL policy blocked local file navigation. HTML generation was verified by file inspection instead.
- AnythingLLM Custom Agent Skill files validated as JSON/Node module. Handler smoke tests passed for `status`, `plan`, `request`, and `release`.
- Process detection was tightened after a smoke test showed that arbitrary command lines containing the word `ComfyUI` could be misclassified as a running ComfyUI process.
- Coordinator `execute` smoke test passed with a simple writer-persona status report. The last log record is `coord-20260604084523-5c7ec2`, action `execute`, status `complete`, assigned `writer` to `qwen3:4b`, and recorded the issued command plus progress steps.
- Live owner detection smoke test passed while ComfyUI was running idle but holding VRAM: the manager now reports `live_owner=comfyui`, regenerates the dashboard, and queues text routing when free VRAM is below 3584 MB.
- CPU dispatcher parser check passed. Dry-run smoke tests classified a Korean RAG request as `rag` and deferred/requested Ollama while ComfyUI held VRAM; a Korean status request was classified as `status` and logged without dashboard regeneration.

Useful verification commands:

```powershell
$tokens = $null
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path .\local-ai-resource-manager.ps1), [ref]$tokens, [ref]$errors) | Out-Null
$errors

Get-Content -Raw .\local-ai-resource-manager.config.json | ConvertFrom-Json | Out-Null

powershell -NoProfile -ExecutionPolicy Bypass -File .\local-ai-resource-manager.ps1 status
powershell -NoProfile -ExecutionPolicy Bypass -File .\local-ai-resource-manager.ps1 comfy-status
powershell -NoProfile -ExecutionPolicy Bypass -File .\local-ai-resource-manager.ps1 state
powershell -NoProfile -ExecutionPolicy Bypass -File .\local-ai-resource-manager.ps1 dashboard
powershell -NoProfile -ExecutionPolicy Bypass -File .\local-ai-resource-manager.ps1 queue

powershell -NoProfile -ExecutionPolicy Bypass -File .\local-ai-dispatcher.ps1 "현재 상태 보고" -TaskType status -Json -NoDashboard
powershell -NoProfile -ExecutionPolicy Bypass -File .\local-ai-dispatcher.ps1 "AnythingLLM RAG after ComfyUI" -TaskType rag -NoDashboard
```

Avoid mutating checks such as `stop-ollama`, `profile writing`, or `profile creative` unless the user asks for them or the task requires it.

## Open Items

- `local-ai-resource-manager.config.json` still needs the user's real ComfyUI launch command:
  - `comfyui_start_command`
  - `comfyui_start_args`
  - `comfyui_working_directory`
- If ComfyUI is launched by a batch file, confirm whether `--lowvram` can be passed through by `mixed` mode. Some launchers ignore extra arguments.
- If the user wants queue processing to be more automated, keep it run-on-demand unless they explicitly request a scheduler or automation.

## Agent Update Protocol

When another agent continues this work:

1. Read this file first.
2. Run `.\local-ai-resource-manager.ps1 status` before interpreting current GPU or routing state.
3. Check whether the queue exists and has entries with `.\local-ai-resource-manager.ps1 queue`.
4. Before editing files, inspect the target file and preserve user changes.
5. After changes, update the relevant sections above and append a log entry below.

Append-only log format:

```markdown
### YYYY-MM-DDTHH:MM:SS+09:00 - Agent/Tool Name

- Intent:
- Files changed:
- Commands run:
- Result:
- Next handoff note:
```

## Agent Log

### 2026-06-04T14:08:51+09:00 - Codex

- Intent: Build a lightweight Windows local AI resource manager for ComfyUI and Ollama VRAM contention.
- Files changed: Added `local-ai-resource-manager.ps1`, `local-ai-resource-manager.config.json`, and `local-ai-resource-manager.md`.
- Commands run: PowerShell parser syntax check, config JSON parse, manager `status`, manager `comfy-status`, manager `queue`.
- Result: Manager works as a run-on-demand rule-based tool. It detected low VRAM while `qwen3:8b` was loaded and routed text tasks to queue.
- Next handoff note: User must set the real ComfyUI launch command in the config before launch profiles can start ComfyUI.

### 2026-06-04T17:00:10+09:00 - Codex

- Intent: Create a durable handoff report that future agents can read and append logs to.
- Files changed: Added `AGENT_HANDOFF.md`.
- Commands run: Directory listing, related-doc search, `Get-Date`, manager `status -Json`, manager `queue`.
- Result: Report now records current implementation, routing rules, latest live snapshot, verification history, open items, and an append-only logging protocol.
- Next handoff note: Keep this file current after any manager, config, or documentation edits.

### 2026-06-04T17:02:50+09:00 - Codex

- Intent: Re-check local LLM tooling and resource-manager state, then record the result in the agent report.
- Files changed: Updated `AGENT_HANDOFF.md`; updated `local-llm-tooling.md` to correct current Obsidian/Page Assist/AnythingLLM status.
- Commands run: `ollama list`, Ollama API probe, `code --list-extensions`, `winget list --name AnythingLLM`, AnythingLLM process/log/env checks, Chrome extension check, Obsidian plugin checks, manager `status -Json`, manager `queue`, `ollama ps`.
- Result: Ollama, Continue, AnythingLLM, Page Assist, and the `Link` vault's Copilot/Smart Connections setup are confirmed. ComfyUI is closed, no Ollama models are loaded, queue has 0 tasks, and text routing currently chooses `qwen3:4b` due to available VRAM being below the `qwen3:8b` threshold.
- Next handoff note: RAG should be validated from the AnythingLLM UI with one small Markdown/PDF upload; install Obsidian plugins in the two other vaults only if the user actually wants those vaults connected.

### 2026-06-04T17:23:52+09:00 - Codex

- Intent: Add ComfyUI/Ollama turn coordination and a visual queue/status dashboard without creating an always-on service.
- Files changed: Updated `local-ai-resource-manager.ps1`, `local-ai-resource-manager.config.json`, `local-ai-resource-manager.md`, and `AGENT_HANDOFF.md`; created `local-ai-runtime-state.json` and generated `local-ai-dashboard.html`.
- Commands run: PowerShell parser syntax check, config/state JSON parse, manager `state`, manager `status -Json`, manager `dashboard`, manager `queue`, turn flag smoke test with `claim comfyui`, `request ollama`, `release comfyui`, and `release ollama`.
- Result: Manager now respects soft turn flags, queues Ollama tasks while ComfyUI holds the turn, supports passing a waiting request on release, and generates an HTML dashboard snapshot showing live owner, turn flag, VRAM, loaded Ollama models, and waiting work.
- Next handoff note: The dashboard is a static snapshot; re-run `.\local-ai-resource-manager.ps1 dashboard -Open` to refresh. In-app Browser verification could not open `file://` due to URL policy, so visual browser verification remains manual unless served through an approved local URL.

### 2026-06-04T17:33:23+09:00 - Codex

- Intent: Integrate the local resource manager into AnythingLLM through a supported custom agent skill and define model/persona responsibilities.
- Files changed: Added `local-ai-personas.json`; added `%APPDATA%\anythingllm-desktop\storage\plugins\agent-skills\local-ai-coordinator\plugin.json`, `handler.js`, and `README.md`; updated `local-ai-resource-manager.ps1`, `local-ai-resource-manager.md`, and `AGENT_HANDOFF.md`.
- Commands run: Official AnythingLLM Custom Agent Skill docs lookup, local backend extension-point inspection, plugin JSON parse, Node handler load test, handler `status` and `plan` smoke tests, handler `request`/`release` smoke test, manager parser check, manager `state -Json`.
- Result: AnythingLLM can now show local AI status and orchestration plans via `@agent` and the `Local AI Coordinator` skill. The skill can request/claim/release turn flags and can optionally create AnythingLLM threads if an API key and workspace slug are configured.
- Next handoff note: Reload the AnythingLLM UI or revisit Agent Skills settings to see the new skill. Do not store an API key in docs; put it only in the skill setup UI if thread creation is needed.

### 2026-06-04T17:47:35+09:00 - Codex

- Intent: Add a coordinator-managed run log and execute a small example command through the persona router.
- Files changed: Updated `%APPDATA%\anythingllm-desktop\storage\plugins\agent-skills\local-ai-coordinator\handler.js`, `local-ai-resource-manager.md`, and `AGENT_HANDOFF.md`; created/updated `local-ai-coordinator-log.jsonl`.
- Commands run: Handler `execute` smoke test, coordinator log inspection, manager `state -Json`, manager `queue`.
- Result: The coordinator now appends one JSONL record per skill action with run ID, timestamps, action, objective, initial resource state, persona assignments, issued commands, progress, and result preview. Example run `coord-20260604084523-5c7ec2` assigned `writer` to `qwen3:4b` and completed a 3-line Korean resource status report. Current turn is `none/idle`; queue has 0 tasks.
- Next handoff note: Read `local-ai-coordinator-log.jsonl` with UTF-8. Plain PowerShell output may show mojibake for Korean text unless the console encoding is UTF-8.

### 2026-06-04T18:13:33+09:00 - Codex

- Intent: Re-evaluate the AnythingLLM-as-middle-manager design after the user identified possible VRAM contention.
- Files changed: Updated `local-ai-resource-manager.ps1`, `local-ai-resource-manager.md`, and `AGENT_HANDOFF.md`; regenerated `local-ai-dashboard.html`.
- Commands run: Manager `state -Json`, PowerShell parser check, manager `dashboard`, manager `status`.
- Result: Confirmed the concern is valid: AnythingLLM should not be treated as an always-on middle manager because agent/chat calls can load Ollama models into VRAM. Persistent coordination remains in the CPU/lightweight manager and dashboard. Live owner detection now marks ComfyUI as owner when it is running and free VRAM is below the `qwen3:4b` threshold, even when ComfyUI is idle.
- Next handoff note: If using AnythingLLM during ComfyUI sessions, treat it as an Ollama turn request. Prefer `request ollama` and wait for ComfyUI release, or run `stop-ollama` after heavy AnythingLLM/Ollama work.

### 2026-06-04T18:46:29+09:00 - Codex

- Intent: Build a simple CPU-only one-shot middle-manager program that can classify and hand off requests without staying resident or occupying VRAM.
- Files changed: Added `local-ai-dispatcher.ps1`; updated `local-ai-resource-manager.md` and `AGENT_HANDOFF.md`; appended dispatch records to `local-ai-coordinator-log.jsonl`.
- Commands run: PowerShell parser check for `local-ai-dispatcher.ps1`, dispatcher dry-run for a Korean RAG request, dispatcher JSON dry-run for a Korean status request.
- Result: `local-ai-dispatcher.ps1` now reads manager state, classifies requests, assigns personas/models from `local-ai-personas.json`, recommends safe commands, optionally applies turn flags with `-Apply`, optionally invokes Ollama with `-Execute`, writes `cpu_dispatch` records, refreshes the dashboard unless `-NoDashboard` is set, and exits.
- Next handoff note: Treat dispatcher default mode as the main control surface. Use `-Execute` only when the user intentionally wants an Ollama call and accepts possible VRAM use.

### 2026-06-04T18:44:17+09:00 - Codex

- Intent: Implement a personal Telegram DM workbot that uses the existing local AI resource manager for report/summary generation.
- Files changed: Added `telegram-workbot` with FastAPI webhook app, SQLite storage, Telegram command handlers, local resource-manager LLM wrapper, scheduler setup, webhook scripts, README, `.env.example`, `.gitignore`, and tests; updated `AGENT_HANDOFF.md`.
- Commands run: `python -m pytest`, `.venv\Scripts\python.exe -m pytest`, `python -m compileall workbot scripts`, `.venv\Scripts\python.exe -m compileall workbot scripts`, venv creation and `pip install -r requirements.txt`, FastAPI app import/health function smoke test.
- Result: `telegram-workbot` is implemented and verified with 9 passing tests in both global Python and the project `.venv`. FastAPI app loads with required environment variables and reports the expected webhook path. Background server launch from this Codex session was blocked by Windows access denied, so no persistent server was left running.
- Next handoff note: Fill `telegram-workbot\.env` with the real Telegram token, owner Telegram ID, webhook secret, and Cloudflare Quick Tunnel URL, then run Uvicorn and `scripts\set_webhook.py`.

### 2026-06-04T18:48:11+09:00 - Codex

- Intent: Re-audit the Telegram workbot implementation against the requested plan and strengthen verification coverage.
- Files changed: Updated `telegram-workbot\tests\test_bot.py`, added `telegram-workbot\tests\test_llm.py`, and updated `AGENT_HANDOFF.md`.
- Commands run: `.venv\Scripts\python.exe -m pytest`, `python -m pytest`, `.venv\Scripts\python.exe -m compileall workbot scripts`, FastAPI startup/shutdown smoke test with a temporary SQLite database.
- Result: `telegram-workbot` now has 16 passing tests covering owner access, Korean command parsing, date/month parsing, check-in/check-out, duplicate check-in, missing checkout, empty-note fallback reports, today-note summary fallback, resource-manager success/queued/error handling, and weekday 18:30 KST scheduling. Startup smoke test created the expected SQLite tables and returned `/telegram/webhook/test-secret`.
- Next handoff note: No real `.env` exists yet. Runtime activation still requires real Telegram credentials and a Cloudflare Quick Tunnel URL.

### 2026-06-04T18:49:34+09:00 - Codex

- Intent: Align `/상태` with the plan by reporting live Telegram webhook configuration as well as local settings.
- Files changed: Updated `telegram-workbot\workbot\bot.py`, `telegram-workbot\tests\test_bot.py`, and `AGENT_HANDOFF.md`.
- Commands run: `.venv\Scripts\python.exe -m pytest`, `python -m pytest`, `.venv\Scripts\python.exe -m compileall workbot scripts`, FastAPI startup/shutdown smoke test with a temporary SQLite database.
- Result: `/상태` now calls `getWebhookInfo` and includes the Telegram webhook URL/pending count when available, while still reporting DB, public URL config, auto-report schedule, and local resource-manager state. All 16 tests pass in both environments.
- Next handoff note: Real Telegram webhook verification still needs `telegram-workbot\.env` with the user's bot token, owner Telegram ID, webhook secret, and current Cloudflare Quick Tunnel URL.
