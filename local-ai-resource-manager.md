# Local AI Resource Manager

Lightweight Windows helper for one RTX 4060 8 GB GPU shared by ComfyUI and Ollama.

This is a rule-based, run-on-demand tool. It is not an always-on LLM manager and it does not install Docker, WSL, CUDA Toolkit, or change page file settings.

## Files

- `local-ai-resource-manager.ps1` - the command tool.
- `local-ai-dispatcher.ps1` - CPU-only one-shot dispatcher that classifies a request, assigns a persona/model, writes the coordinator log, and exits.
- `local-ai-resource-manager.config.json` - editable thresholds, model names, Ollama API URL, ComfyUI API URL, and ComfyUI launch command.
- `local-ai-task-queue.jsonl` - created only when a task is queued.
- `local-ai-runtime-state.json` - soft turn flags for ComfyUI and Ollama.
- `local-ai-dashboard.html` - generated visual dashboard snapshot.
- `local-ai-personas.json` - role map for local Ollama models and orchestration personas.
- `local-ai-coordinator-log.jsonl` - append-only coordinator run log for persona assignment, model choice, issued commands, and progress.
- `%APPDATA%\anythingllm-desktop\storage\plugins\agent-skills\local-ai-coordinator` - AnythingLLM custom agent skill that exposes this manager in the AnythingLLM UI.

## First edit

Open `local-ai-resource-manager.config.json` and set your ComfyUI launch command if you want the profile commands to start ComfyUI:

```json
"comfyui_start_command": "C:\\path\\to\\python.exe",
"comfyui_start_args": "-s C:\\path\\to\\ComfyUI\\main.py --windows-standalone-build",
"comfyui_lowvram_args": "--lowvram",
"comfyui_working_directory": "C:\\path\\to\\ComfyUI",
"state_path": ".\\local-ai-runtime-state.json",
"dashboard_path": ".\\local-ai-dashboard.html",
"respect_turn_flags": true
```

If you use a `.bat` launcher, set `comfyui_start_command` to the `.bat` path and leave `comfyui_start_args` empty unless your batch file accepts extra arguments.

## Editable thresholds

The config values are in MB:

```json
"min_vram_for_qwen8b": 6144,
"min_vram_for_qwen4b": 3584,
"default_context_length": 8192,
"keep_alive": "0"
```

The default rules are:

- Below `min_vram_for_qwen4b`, queue local model tasks.
- From `min_vram_for_qwen4b` to `min_vram_for_qwen8b`, use `qwen3:4b`.
- Above `min_vram_for_qwen8b`, use `qwen3:8b` only when ComfyUI is not running.
- Use `gemma3:4b` only for image or screenshot understanding when ComfyUI is idle or closed.
- Use `qwen3-embedding:0.6b` for embedding tasks.

## Status commands

Check GPU VRAM with `nvidia-smi`, ComfyUI status, loaded Ollama models, and the current text routing decision:

```powershell
.\local-ai-resource-manager.ps1 status
```

Print structured JSON:

```powershell
.\local-ai-resource-manager.ps1 status -Json
```

Show the live coordinator view, including turn flags and waiting work:

```powershell
.\local-ai-resource-manager.ps1 state
.\local-ai-resource-manager.ps1 state -Json
```

Generate a browser-readable dashboard snapshot:

```powershell
.\local-ai-resource-manager.ps1 dashboard
.\local-ai-resource-manager.ps1 dashboard -Open
```

The dashboard is a snapshot, not a background service. Run the command again to refresh it.

Check loaded Ollama models directly:

```powershell
ollama ps
.\local-ai-resource-manager.ps1 ollama-ps
```

Check ComfyUI only:

```powershell
.\local-ai-resource-manager.ps1 comfy-status
```

Check raw GPU status:

```powershell
nvidia-smi
```

## Stop Ollama before ComfyUI

Manual commands:

```powershell
ollama stop qwen3:8b
ollama stop qwen3:4b
ollama stop gemma3:4b
```

Manager command:

```powershell
.\local-ai-resource-manager.ps1 stop-ollama
```

The manager also stops the embedding models listed in the config because they can still occupy GPU memory when loaded.

## Launch profiles

Creative mode gives ComfyUI priority and stops configured Ollama models first:

```powershell
.\local-ai-resource-manager.ps1 profile creative
```

Mixed mode starts ComfyUI with the low-VRAM arguments and allows only `qwen3:4b` for text routing:

```powershell
.\local-ai-resource-manager.ps1 profile mixed
```

Writing mode stops ComfyUI and allows `qwen3:8b`:

```powershell
.\local-ai-resource-manager.ps1 profile writing
```

Profiles also update the turn flag:

- `creative` reserves the turn for ComfyUI.
- `mixed` reserves a low-VRAM mixed turn where only lightweight text routing is allowed.
- `writing` reserves the turn for Ollama.

## Turn flags

Turn flags are soft coordination signals stored in `local-ai-runtime-state.json`. They do not hook into ComfyUI or Ollama internals, but the manager respects them when routing work.

Ask for the next turn without interrupting the current owner:

```powershell
.\local-ai-resource-manager.ps1 request comfyui "next image batch"
.\local-ai-resource-manager.ps1 request ollama "RAG question after ComfyUI"
```

Claim the current GPU turn:

```powershell
.\local-ai-resource-manager.ps1 claim comfyui "generating image batch"
.\local-ai-resource-manager.ps1 claim ollama "writing or RAG task"
```

Release the current turn:

```powershell
.\local-ai-resource-manager.ps1 release comfyui
.\local-ai-resource-manager.ps1 release ollama
```

If the other side has a waiting request, `release` passes the turn to that side as `reserved`.

Recommended manual flow:

```powershell
.\local-ai-resource-manager.ps1 claim comfyui "ComfyUI batch"
# Run ComfyUI work.
.\local-ai-resource-manager.ps1 request ollama "AnythingLLM RAG after batch"
.\local-ai-resource-manager.ps1 release comfyui
.\local-ai-resource-manager.ps1 dashboard -Open
```

When ComfyUI holds the turn flag, routed Ollama tasks are queued instead of generated:

```powershell
.\local-ai-resource-manager.ps1 ask "Summarize this note."
```

## CPU One-Shot Dispatcher

Use `local-ai-dispatcher.ps1` as the default middle-manager entrypoint. It runs on CPU only, reads the current manager state, classifies the request, assigns a persona/model, appends a record to `local-ai-coordinator-log.jsonl`, optionally refreshes the dashboard, and exits.

It does not keep a process alive. It does not call Ollama or occupy VRAM unless `-Execute` is explicitly used.

Plan a request without mutating turn flags:

```powershell
.\local-ai-dispatcher.ps1 "ComfyUI 끝나면 AnythingLLM RAG로 문서 근거를 찾아 보고서 작성"
```

Force a task type when the wording is ambiguous:

```powershell
.\local-ai-dispatcher.ps1 "현재 상태 보고" -TaskType status
.\local-ai-dispatcher.ps1 "새 이미지 배치 준비" -TaskType comfyui
.\local-ai-dispatcher.ps1 "문서 근거 검색 후 보고서 작성" -TaskType rag
```

Apply the recommended turn action:

```powershell
.\local-ai-dispatcher.ps1 "ComfyUI 이미지 생성 배치" -TaskType comfyui -Apply
.\local-ai-dispatcher.ps1 "AnythingLLM RAG after ComfyUI" -TaskType rag -Apply
```

Only use `-Execute` when you intentionally want to delegate to Ollama through the manager:

```powershell
.\local-ai-dispatcher.ps1 "짧은 상태 보고서 작성" -TaskType text -Execute
```

Useful options:

- `-Json` prints the full dispatch record.
- `-NoDashboard` skips dashboard regeneration.
- `-Apply` mutates only the soft turn flags through the manager.
- `-Execute` may invoke Ollama through `ask`, `vision`, or `embed`; this can use VRAM.

## AnythingLLM Agent Skill

The local AnythingLLM desktop installation has a custom agent skill installed at:

```text
C:\Users\Hojun\AppData\Roaming\anythingllm-desktop\storage\plugins\agent-skills\local-ai-coordinator
```

Files:

- `plugin.json` - AnythingLLM skill metadata and setup UI fields.
- `handler.js` - reads the manager state, applies turn flag commands, and returns status/plans to the chat UI.
- `README.md` - short usage notes.

After adding or changing the skill, reload the AnythingLLM page or revisit the Agent Skills settings page so the UI sees the new skill.

Example prompts inside AnythingLLM:

```text
@agent show local AI status
@agent plan this across my local models: read my docs and make a Korean report
@agent execute this with the local coordinator: write a 3-line resource status report
@agent reserve ComfyUI for an image generation batch
@agent request Ollama after the ComfyUI batch finishes
```

Skill actions:

- `status` shows live owner, turn flag, VRAM, ComfyUI/Ollama state, queue, and model roles.
- `plan` returns a persona/model/thread split without changing state.
- `execute` runs the primary text persona through the manager when the task can safely use Ollama.
- `orchestrate` returns a plan and requests or claims a turn flag when the plan requires it.
- `request`, `claim`, and `release` call the same manager turn flag commands from inside AnythingLLM.
- `dashboard` regenerates `local-ai-dashboard.html`.

Every coordinator skill action appends one JSONL record to `local-ai-coordinator-log.jsonl`. Each record includes:

- `run_id`, timestamps, action, objective, and final status.
- Initial resource state: live owner, turn flag, VRAM, ComfyUI/Ollama state, and waiting count.
- Persona assignments: agent name, model, fallback, persona responsibility, command, and progress.
- Issued commands and step-by-step progress.

Use a UTF-8 reader for the log. Some PowerShell console views can display Korean text incorrectly if the console encoding is not UTF-8.

Optional thread creation:

- The skill can create AnythingLLM threads only when `ANYTHINGLLM_API_KEY` and `DEFAULT_WORKSPACE_SLUG` are configured in the skill settings.
- Without those values, it shows the recommended thread split but does not create threads.

The current implementation does not patch AnythingLLM's bundled React UI. It uses AnythingLLM's supported Custom Agent Skill extension point, which is less fragile across app updates.

### VRAM policy for AnythingLLM

Do not use AnythingLLM as an always-on middle manager. The AnythingLLM desktop app itself does not meaningfully occupy GPU memory, but any chat or agent request through Ollama can load a model into VRAM. That model can linger depending on Ollama/provider settings.

The preferred split is:

- Persistent coordination: `local-ai-resource-manager.ps1`, `local-ai-runtime-state.json`, `local-ai-coordinator-log.jsonl`, and `local-ai-dashboard.html`.
- AnythingLLM: UI and RAG/chat client used only when the Ollama turn is allowed.
- LLM-based planning or writing: short, explicit calls routed through the manager, with `keep_alive` set to `0`.

When ComfyUI is running and free VRAM is below `min_vram_for_qwen4b`, the dashboard treats ComfyUI as the live owner even if the ComfyUI queue is idle. This prevents the UI from implying that the GPU is free just because no generation is currently running.

After a heavy AnythingLLM/Ollama run, use this if VRAM remains occupied:

```powershell
.\local-ai-resource-manager.ps1 stop-ollama
```

## Routed tasks

Ask a text question. The manager chooses `qwen3:8b`, `qwen3:4b`, or queues the task:

```powershell
.\local-ai-resource-manager.ps1 ask "Draft a short Korean/English project note."
```

Run image or screenshot understanding with `gemma3:4b` only when ComfyUI is idle or closed:

```powershell
.\local-ai-resource-manager.ps1 vision "Describe this UI screenshot." -ImagePath "C:\path\to\screenshot.png"
```

Create an embedding with `qwen3-embedding:0.6b`:

```powershell
.\local-ai-resource-manager.ps1 embed "Text from an Obsidian note" -Json
```

## Queue

If ComfyUI is generating or VRAM free is below `min_vram_for_qwen4b`, routed tasks are appended to `local-ai-task-queue.jsonl`.

If ComfyUI holds the current turn flag, routed Ollama tasks are also appended to the queue. New queue entries include an `id`, `owner`, `task_type`, prompt, image path, and reason.

Show queued tasks:

```powershell
.\local-ai-resource-manager.ps1 queue
```

Try queued tasks again:

```powershell
.\local-ai-resource-manager.ps1 drain-queue
```

If a queued task still cannot run, it is re-queued.

## ComfyUI detection

The manager detects ComfyUI in two ways:

- Process command line or process name contains the config value `comfyui_process_match`, default `ComfyUI`.
- ComfyUI API responds at `comfyui_api`, default `http://127.0.0.1:8188`.

ComfyUI is considered generating when the API `/queue` endpoint has a running item. If the API is unavailable, the VRAM threshold still protects the GPU from local LLM launches.

## Ollama API use

Routed generation uses the Ollama local API at:

```text
http://127.0.0.1:11434
```

Generation calls pass:

```json
{
  "stream": false,
  "keep_alive": "0",
  "options": {
    "num_ctx": 8192
  }
}
```

This keeps local LLM use short-lived by default instead of creating another resident manager.
