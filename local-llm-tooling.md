# Local LLM Tooling Checklist

## Setup policy

- PC: Windows 11 Pro, RTX 4060 8 GB VRAM, Ryzen 9 7950X, 64 GB RAM.
- Keep this setup native Windows-first.
- Do not install Docker, WSL, CUDA Toolkit, page file changes, model directory moves, or unrelated tools unless explicitly requested.
- Use manual installs for GUI apps, browser extensions, and Obsidian plugins unless there is a safe official method.
- Use the existing Ollama API endpoint for local tools:

```text
http://127.0.0.1:11434
```

If PowerShell cannot find `ollama`, use the explicit Windows install path:

```powershell
& "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" --version
& "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" list
```

## Recommended first workflow

Use this first:

```text
Ollama + qwen3:8b + qwen3-embedding:0.6b + AnythingLLM + Obsidian Copilot
```

Recommended model roles:

| Model | Use first for | Notes |
| --- | --- | --- |
| `qwen3:8b` | General chat, document Q&A, note summaries, code explanations, browser summaries | Main local assistant. Practical on RTX 4060 8 GB, but close other GPU-heavy apps. |
| `qwen3:4b` | Faster chat, quick summaries, lower VRAM pressure | Use when `qwen3:8b` feels slow or memory pressure is high. |
| `gemma3:4b` | Image or screenshot understanding | Keep as a helper, not the default text model. |
| `qwen3-embedding:0.6b` | Default RAG, semantic search, note retrieval | Best first embedding choice because it is small and fast. |
| `qwen3-embedding:4b` | Later retrieval-quality experiments | Use only if better semantic search quality is worth extra size and time. |

## Required now

| Tool | Required now? | Install method | Purpose | Recommended model | RTX 4060 8 GB notes |
| --- | --- | --- | --- | --- | --- |
| Ollama | Yes, already installed | Native Windows installer or winget; already present at `$env:LOCALAPPDATA\Programs\Ollama\ollama.exe` | Local model runner and API server | `qwen3:8b`, `qwen3-embedding:0.6b` | Keep only one large model active when possible. Check memory with `ollama ps` and `nvidia-smi`. |
| AnythingLLM Desktop | Yes, manual install | Download the Windows 10+ x86_64 desktop installer from the official AnythingLLM Windows docs. Install for Current User only, not all users. | Local document chat, PDF and Markdown RAG, project knowledge bases | LLM: `qwen3:8b`; embedding: `qwen3-embedding:0.6b` | Prefer connecting to your existing Ollama at `http://127.0.0.1:11434` instead of relying on an extra bundled model runtime. |
| Obsidian Copilot | Yes, manual install | Obsidian Settings -> Community plugins -> Browse -> search `Copilot` -> Install -> Enable | Local note Q&A, chat with notes, selected text rewrite, note summaries | Chat: `qwen3:8b`; fallback: `qwen3:4b` | Keep max output and context modest for vault Q&A. Use `qwen3:4b` if `qwen3:8b` makes Obsidian feel heavy. |

### AnythingLLM Desktop checklist

1. Open the official Windows install page: https://docs.anythingllm.com/installation-desktop/windows
2. Download the Windows 10+ x86_64 installer.
3. Install for Current User only.
4. Start AnythingLLM Desktop.
5. In LLM settings, choose Ollama and set the base URL to:

```text
http://127.0.0.1:11434
```

6. Select `qwen3:8b` as the chat model.
7. In embedding settings, choose Ollama and select `qwen3-embedding:0.6b`.
8. Create one small workspace first, upload one PDF or Markdown file, and ask a short factual question about it.

AnythingLLM notes:

- AnythingLLM's Ollama docs use `http://127.0.0.1:11434` for local Ollama.
- Its embedder dropdown can show both LLMs and embedding models. Choose an actual embedding model, not `qwen3:8b`.
- If AnythingLLM reports bundled GPU dependency issues, keep the setup simple: use the separately installed Ollama instance instead of manual GPU-support file fixes.

### Obsidian Copilot checklist

1. Open Obsidian.
2. Go to Settings -> Community plugins.
3. Turn on Community plugins if needed.
4. Click Browse, search for `Copilot`, install, then enable it.
5. In Copilot settings, add an Ollama/local model entry.
6. Use the exact model name from `ollama list`:

```text
qwen3:8b
```

7. If the plugin asks for a local server URL, use:

```text
http://127.0.0.1:11434
```

8. Test with one current note:

```text
Summarize this note in five bullets.
```

9. For vault Q&A, start with a small folder or tag before indexing/searching the whole vault.

## Useful now, install manually when ready

| Tool | Required now? | Install method | Purpose | Recommended model | RTX 4060 8 GB notes |
| --- | --- | --- | --- | --- | --- |
| Smart Connections | Useful now, not required for first workflow | Obsidian Settings -> Community plugins -> Browse -> search `Smart Connections` -> Install -> Enable | Related note discovery, semantic search, local note linking | Start with its built-in local embeddings; use `qwen3-embedding:0.6b` only if the plugin exposes a safe Ollama embedding configuration you want to use | Let it finish initial indexing before judging quality. Re-index if you change embedding model. |
| Continue VS Code extension | Useful now, manual install | Install `Continue.continue` from the VS Code Marketplace or VS Code Extensions panel | Local coding assistant, code explanation, error log summaries, small refactors, README/test drafts | Chat/edit: `qwen3:8b`; fast fallback: `qwen3:4b` | Avoid large agent/tool workflows on this GPU. Use compact prompts and smaller context if responses slow down. |
| Page Assist Chrome extension | Useful now, manual install | Install from the Chrome Web Store via Page Assist's official install page | Browser sidebar for Ollama, local webpage summaries, Q&A over current pages | `qwen3:8b`; fallback: `qwen3:4b` | Summarizing long pages can exceed practical context. Summarize sections when needed. |

### Smart Connections checklist

1. Open Obsidian.
2. Go to Settings -> Community plugins -> Browse.
3. Search `Smart Connections`.
4. Install and enable the plugin.
5. Let initial local indexing finish.
6. Open the Connections view on a real note and confirm related notes appear.
7. Use Lookup view for semantic search across the vault.

Smart Connections notes:

- It is local-first and has a zero-setup local embedding path.
- Do not switch embedding models casually after indexing. Re-index if you intentionally change the embedding model.
- Use this for related-note discovery. Use Obsidian Copilot or AnythingLLM for direct chat/Q&A.

### Continue VS Code checklist

1. Open the official Continue install docs: https://docs.continue.dev/ide-extensions/install
2. Install the VS Code extension from the Marketplace: https://marketplace.visualstudio.com/items?itemName=Continue.continue
3. In Continue, use the model selector or local configuration to add Ollama.
4. Prefer Autodetect first so Continue scans local models from `ollama list`.
5. If manual configuration is needed, use model names that exactly match `ollama list`.

Minimal local model configuration example:

```yaml
name: Local Ollama
version: 0.0.1
schema: v1
models:
  - name: Ollama Autodetect
    provider: ollama
    model: AUTODETECT
    apiBase: http://127.0.0.1:11434
    roles:
      - chat
      - edit
      - apply
```

Use Continue for:

- Explaining unfamiliar code.
- Summarizing error logs.
- Drafting README sections.
- Drafting tests.
- Suggesting small refactors.

Avoid at first:

- Large autonomous agent tasks.
- Multi-file rewrites.
- Very large context windows.
- Assuming tool-calling works reliably with every local model.

### Page Assist Chrome checklist

1. Open Page Assist: https://pageassist.xyz/
2. Use the official install path for Chrome.
3. Open the Page Assist sidebar.
4. Configure provider as Ollama.
5. Use:

```text
http://127.0.0.1:11434
```

6. Select `qwen3:8b`.
7. Open an official documentation page and ask for a short summary.
8. If the page is long or slow, switch to `qwen3:4b` or summarize only the selected section.

## Optional later only

Do not install these automatically.

| Tool | Required now? | Install method | Purpose | When to install | Recommended model | RTX 4060 8 GB notes |
| --- | --- | --- | --- | --- | --- | --- |
| Open WebUI | Optional later | Prefer official Desktop if you want native app behavior. Docker is commonly recommended by the project, so do not use Docker unless explicitly requested. | Full local web chat UI, model management, shared local chat workspace | Install after AnythingLLM/Page Assist if you want a richer web UI around Ollama | `qwen3:8b`, fallback `qwen3:4b` | Running another UI is fine, but avoid loading multiple models simultaneously. |
| n8n | Optional later | Do not install now. Native/manual setup usually requires extra runtime decisions. | Workflow automation, scheduled research, local LLM automations | Install only when you have a concrete automation workflow | Use Ollama HTTP calls to `qwen3:4b` for fast automations or `qwen3:8b` for quality | Automation can create repeated model loads. Start with small models and rate limits. |
| LM Studio | Optional later | Native Windows desktop installer from official LM Studio site | Alternative local model runner and OpenAI-compatible local server | Install only if you want to compare GGUF model downloads, UI model management, or non-Ollama local serving | Keep Ollama as primary; use LM Studio for experiments | Do not run LM Studio server and heavy Ollama models at the same time unless you are watching VRAM. |

## Verification commands

Run these from a fresh PowerShell after installing any manual tools.

Check Ollama version:

```powershell
ollama --version
```

If `ollama` is not on PATH yet:

```powershell
& "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" --version
```

List models:

```powershell
ollama list
```

Confirm required models are present:

```powershell
ollama list | Select-String -Pattern 'qwen3:8b|qwen3-embedding:0.6b'
```

Confirm `qwen3:8b` responds:

```powershell
ollama run qwen3:8b "Give a one-sentence setup confirmation."
```

Confirm `qwen3-embedding:0.6b` embedding API works:

```powershell
$body = @{ model = 'qwen3-embedding:0.6b'; input = 'local llm tooling test' } | ConvertTo-Json
$response = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/embed' -Method Post -ContentType 'application/json' -Body $body
$response.embeddings[0].Count
```

Check loaded models:

```powershell
ollama ps
```

Check GPU use:

```powershell
nvidia-smi
```

Check Continue only if installed:

```powershell
code --list-extensions | Select-String -Pattern '^Continue\.continue$'
```

Then open VS Code and confirm Continue can select Ollama Autodetect or `qwen3:8b`.

Check AnythingLLM only if installed:

1. Open AnythingLLM Desktop.
2. Set LLM provider to Ollama.
3. Set Ollama URL to `http://127.0.0.1:11434`.
4. Select `qwen3:8b`.
5. Set embedding provider to Ollama.
6. Select `qwen3-embedding:0.6b`.
7. Upload one small Markdown file and ask a simple factual question.

Check Page Assist only if installed:

1. Open Chrome.
2. Open the Page Assist sidebar.
3. Confirm provider is Ollama.
4. Confirm model is `qwen3:8b` or `qwen3:4b`.
5. Ask it to summarize the current page in five bullets.

## Current verification result

Checked on 2026-06-04 from `C:\Users\Hojun\Desktop\Bumboo\AGENTS`.

| Check | Result |
| --- | --- |
| `ollama` on current PowerShell `PATH` | Not found in this shell. Use a fresh PowerShell or the explicit executable path. |
| Explicit Ollama executable path | Found at `$env:LOCALAPPDATA\Programs\Ollama\ollama.exe`. |
| Ollama local API | Passed: `http://127.0.0.1:11434` returned `Ollama is running`. |
| Ollama version | Passed with `ollama --version`: `ollama version is 0.24.0`. |
| `ollama version` | This build returned `unknown command`; use `ollama --version`. |
| `ollama list` | Passed with explicit executable path. |
| `qwen3:8b` | Present and responded successfully. |
| `qwen3-embedding:0.6b` | Present and embedding API returned 1024 dimensions. |
| `ollama ps` after test | `qwen3:8b` loaded at 6.0 GB with `15%/85% CPU/GPU`, context 4096. |
| Continue VS Code extension | Installed with `code --install-extension Continue.continue`; version `1.2.22` was reported during install. |
| Continue local config | Created at `C:\Users\Hojun\.continue\config.yaml` with `qwen3:8b`, `qwen3:4b`, and `qwen3-embedding:0.6b`. |
| AnythingLLM Desktop | Installed: `AnythingLLM 1.13.0`, user-level install record. Running from `C:\Users\Hojun\Desktop\Bumboo\AGENTS\AnythingLLM\AnythingLLM.exe`. |
| AnythingLLM installer | Downloaded official x64 installer to `C:\Users\Hojun\Downloads\AnythingLLMDesktop.exe` and opened the installer for manual Current User installation. Signature status: `Valid`. SHA256: `3323AFF1921C47EEC8E90CA080671A028E7296FAB9C3C6BBDF1A575B36F73EF7`. |
| AnythingLLM external Ollama config | Updated `C:\Users\Hojun\AppData\Roaming\anythingllm-desktop\storage\.env` to use external Ollama: `LLM_PROVIDER=ollama`, `OLLAMA_MODEL_PREF=qwen3:8b`, `EMBEDDING_ENGINE=ollama`, `EMBEDDING_MODEL_PREF=qwen3-embedding:0.6b`, `DISABLE_TELEMETRY=true`. Backup created next to the `.env` file. |
| AnythingLLM config verification | Backend log confirms `LLMSelection=ollama`, `Embedder=ollama`, `LLMModel=qwen3:8b`, and `OllamaEmbedder` initialized with `qwen3-embedding:0.6b` at `http://127.0.0.1:11434`. |
| AnythingLLM internal partial model cleanup | Removed 17 incomplete `*-partial*` files from AnythingLLM's internal Ollama model cache, freeing `3295613865` bytes. No internal Ollama manifests remained. |
| Obsidian plugin install pages | Current vault status: `C:\Users\Hojun\Documents\Obsidians\Link` has Copilot and Smart Connections installed. `Brain\Brain` and `Brain\Obsidian-Homepage-main\Rainbell` do not have either plugin installed. |
| Page Assist Chrome extension | Installed in Chrome `Default` profile, extension version `1.5.68_0`. |

Installed Ollama models found:

| Model | Size |
| --- | ---: |
| `qwen3:8b` | 5.2 GB |
| `qwen3:4b` | 2.5 GB |
| `gemma3:4b` | 3.3 GB |
| `qwen3-embedding:0.6b` | 639 MB |
| `qwen3-embedding:4b` | 2.5 GB |

## Official sources

- AnythingLLM Windows Desktop: https://docs.anythingllm.com/installation-desktop/windows
- AnythingLLM Ollama LLM setup: https://docs.anythingllm.com/setup/llm-configuration/local/ollama
- AnythingLLM Ollama embedding setup: https://docs.anythingllm.com/setup/embedder-configuration/local/ollama
- Continue install docs: https://docs.continue.dev/ide-extensions/install
- Continue Ollama guide: https://docs.continue.dev/guides/ollama-guide
- Continue VS Code Marketplace: https://marketplace.visualstudio.com/items?itemName=Continue.continue
- Page Assist: https://pageassist.xyz/
- Page Assist docs: https://docs.pageassist.xyz/
- Obsidian Copilot: https://community.obsidian.md/plugins/copilot
- Obsidian Copilot settings: https://www.obsidiancopilot.com/docs/settings
- Smart Connections: https://community.obsidian.md/plugins/smart-connections
- Open WebUI quick start: https://docs.openwebui.com/getting-started/quick-start/
- Open WebUI Desktop: https://github.com/open-webui/desktop
- n8n npm install docs: https://docs.n8n.io/hosting/installation/npm/
- LM Studio: https://lmstudio.ai/
