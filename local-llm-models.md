# Local LLM Models

## PC summary

- OS: Windows 11 Pro 64-bit
- CPU: AMD Ryzen 9 7950X
- RAM: 64 GB DDR5
- GPU: NVIDIA GeForce RTX 4060, 8 GB VRAM
- Main limitation: 8 GB VRAM
- Practical daily range: quantized 4B-8B models
- 14B+ models: experimental only on this PC, not daily main models

## Ollama

- Installed through winget: `winget install --id Ollama.Ollama -e`
- Installed version checked: `ollama version is 0.24.0`
- Install path used in this setup: `C:\Users\Hojun\AppData\Local\Programs\Ollama\ollama.exe`
- Persistent user PATH includes: `C:\Users\Hojun\AppData\Local\Programs\Ollama`

If a currently open terminal cannot find `ollama`, close and reopen PowerShell, or run the full executable path above.

## Installed models

| Model | Size | Role | Purpose |
| --- | ---: | --- | --- |
| `qwen3:8b` | 5.2 GB | Main local assistant | Daily local LLM, Korean/English writing support, Obsidian note summarization, project planning drafts, Codex prompt drafts, light code explanation, refactoring suggestions, general local assistant use |
| `qwen3:4b` | 2.5 GB | Fast lightweight assistant | Faster responses, lightweight automation, quick summaries, draft classification, long-context experiments when 8B feels heavy, background note processing |
| `gemma3:4b` | 3.3 GB | Image/screenshot helper | Basic image or screenshot understanding, UI screenshot explanation, visual reference description drafts, image-related note organization |
| `qwen3-embedding:0.6b` | 639 MB | Default embedding model | Semantic search, Obsidian vault search, RAG document retrieval, finding related notes, tagging and clustering documents |
| `qwen3-embedding:4b` | 2.5 GB | Optional stronger embedding model | Higher-quality semantic search when disk space and speed are acceptable |

## Recommended default

Use `qwen3:8b` as the default local assistant.

Recommended model roles:

- `qwen3:8b` = main local assistant
- `qwen3:4b` = fast lightweight assistant
- `gemma3:4b` = image/screenshot understanding helper
- `qwen3-embedding:0.6b` = default embedding model for Obsidian/RAG
- `qwen3-embedding:4b` = optional higher-quality embedding model

## Recommended usage order

1. Use `qwen3:8b` for normal writing, planning, note summarization, prompt drafting, and light code help.
2. Use `qwen3:4b` when speed matters more than answer depth.
3. Use `gemma3:4b` when an image or screenshot needs to be interpreted.
4. Use `qwen3-embedding:0.6b` as the default embedding model for Obsidian/RAG.
5. Try `qwen3-embedding:4b` only if retrieval quality matters more than speed and disk use.

## Commands

Run the main local assistant:

```powershell
ollama run qwen3:8b
```

Run the fast lightweight assistant:

```powershell
ollama run qwen3:4b
```

Run the image/screenshot helper:

```powershell
ollama run gemma3:4b
```

Show image model details:

```powershell
ollama show gemma3:4b
```

Show default embedding model details:

```powershell
ollama show qwen3-embedding:0.6b
```

Show optional stronger embedding model details:

```powershell
ollama show qwen3-embedding:4b
```

List installed models:

```powershell
ollama list
```

Check loaded models:

```powershell
ollama ps
```

Check GPU usage:

```powershell
nvidia-smi
```

## VRAM notes

- The RTX 4060 has 8 GB VRAM.
- `qwen3:8b` is practical but uses most of the available VRAM when loaded.
- In testing, baseline VRAM usage was about 1967 MiB before a model was loaded.
- After running `qwen3:8b`, `ollama ps` reported `100% GPU`, and `nvidia-smi` showed about 7432 MiB used.
- Keep other GPU-heavy apps closed when using `qwen3:8b` for smoother results.
- If responses feel slow or VRAM pressure is high, switch to `qwen3:4b`.

## Do not pull without explicit approval

Do not download these models unless explicitly requested later:

- `qwen3:14b`
- `qwen3.6:27b`
- `qwen3.6:35b`
- `qwen3-coder` large variants
- `gpt-oss:20b` or larger

These may run with CPU/RAM offloading, but they are not ideal for smooth daily use on an 8 GB VRAM GPU.

## Obsidian/RAG next step

For Obsidian semantic search or RAG, connect an Obsidian plugin or local RAG tool to the Ollama local API at:

```text
http://localhost:11434
```

Use `qwen3-embedding:0.6b` as the first embedding model. Use `qwen3:8b` for generation, and fall back to `qwen3:4b` when speed matters.
