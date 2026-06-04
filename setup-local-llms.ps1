# Simple native Windows Ollama setup helper.
# It does not install Docker, WSL, CUDA Toolkit, or change model/page-file locations.

$ErrorActionPreference = "Stop"

function Get-OllamaPath {
    $command = Get-Command ollama -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    $commonPath = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"
    if (Test-Path -LiteralPath $commonPath) {
        return $commonPath
    }

    return $null
}

$ollama = Get-OllamaPath
if (-not $ollama) {
    Write-Host "Ollama was not found."
    Write-Host "Recommended install command:"
    Write-Host "winget install --id Ollama.Ollama -e --accept-package-agreements --accept-source-agreements"
    exit 1
}

Write-Host "Using Ollama: $ollama"
& $ollama --version

$models = @(
    @{
        Name = "qwen3:8b"
        Purpose = "Main daily local assistant: Korean/English writing, Obsidian summaries, planning drafts, Codex prompt drafts, light code help."
    },
    @{
        Name = "qwen3:4b"
        Purpose = "Fast lightweight assistant: quick summaries, automation, classification, background note processing."
    },
    @{
        Name = "gemma3:4b"
        Purpose = "Image/screenshot helper: UI screenshot explanation and visual reference description drafts."
    },
    @{
        Name = "qwen3-embedding:0.6b"
        Purpose = "Default embedding model: Obsidian/RAG semantic search, related notes, tagging, clustering."
    },
    @{
        Name = "qwen3-embedding:4b"
        Purpose = "Optional stronger embedding model: higher-quality semantic search when speed and disk use are acceptable."
    }
)

foreach ($model in $models) {
    Write-Host ""
    Write-Host "Pulling $($model.Name)"
    Write-Host "Purpose: $($model.Purpose)"
    & $ollama pull $model.Name
}

Write-Host ""
Write-Host "Installed models:"
& $ollama list

Write-Host ""
Write-Host "Testing qwen3:8b"
& $ollama run qwen3:8b "Introduce yourself briefly as a local assistant."

Write-Host ""
Write-Host "Testing qwen3:4b"
& $ollama run qwen3:4b "Summarize what a local LLM is in one sentence."

Write-Host ""
Write-Host "Checking helper model metadata"
& $ollama show gemma3:4b
& $ollama show qwen3-embedding:0.6b

Write-Host ""
Write-Host "Reminder: run nvidia-smi while qwen3:8b is loaded to confirm VRAM usage."
Write-Host "Expected behavior on this PC: qwen3:8b should fit, but it will use most of the 8 GB VRAM."
