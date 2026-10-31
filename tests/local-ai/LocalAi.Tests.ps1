# Regression tests for local-ai-resource-manager.ps1 and local-ai-dispatcher.ps1.
#
# Run with PowerShell 7 or Windows PowerShell 5.1:
#   pwsh -NoProfile -File tests/local-ai/LocalAi.Tests.ps1
#
# Only the function definitions are loaded (never the scripts' main body), and
# Invoke-RestMethod is mocked, so nothing talks to Ollama, ComfyUI or nvidia-smi.

$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$script:failures = 0
$script:passes = 0

function Assert-Equal {
    param($Expected, $Actual, [string]$Name)
    if ($Expected -ceq $Actual) {
        $script:passes++
        Write-Host "ok - $Name"
    }
    else {
        $script:failures++
        Write-Host "not ok - $Name (expected '$Expected', got '$Actual')"
    }
}

function Get-ScriptFunctions {
    param([string]$Path)
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($Path, [ref]$null, [ref]$null)
    $ast.FindAll({
        param($node)
        $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Parent.Parent -eq $ast
    }, $true) | ForEach-Object { $_.Extent.Text }
}

# --- resource manager --------------------------------------------------------
& {
    $managerPath = Join-Path $repoRoot "local-ai-resource-manager.ps1"
    foreach ($definition in Get-ScriptFunctions $managerPath) { . ([scriptblock]::Create($definition)) }
    $script:ManagerRoot = Split-Path -Parent $managerPath

    $script:lastBody = $null
    function Invoke-RestMethod { param($Uri, $Method, $ContentType, $Body, $TimeoutSec) $script:lastBody = $Body; return @{ embeddings = @() } }

    $config = [pscustomobject]@{ ollama_api = "http://127.0.0.1:11434"; keep_alive = "0"; default_context_length = 8192 }
    Invoke-OllamaEmbed -Config $config -Model "qwen3-embedding:0.6b" -Text "hello world" | Out-Null
    Assert-Equal "hello world" ($script:lastBody | ConvertFrom-Json).input "embed sends the input text to Ollama"

    function Get-RouteDecision { param($Config, $TaskType) [pscustomobject]@{ allowed = $true; model = "qwen3-embedding:0.6b"; reason = "test" } }
    $script:lastBody = $null
    Invoke-RoutedTask -Config $config -TaskType embedding -Prompt "note text" -Json | Out-Null
    Assert-Equal "note text" ($script:lastBody | ConvertFrom-Json).input "embed action routes the prompt as input"

    # Windows PowerShell 5.1 reads files without a BOM in the ANSI code page
    # (cp949 on Korean Windows). Simulate that default for Get-Content.
    $tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("local-ai-test-" + [guid]::NewGuid())
    New-Item -ItemType Directory -Path $tempDir | Out-Null
    try {
        $statePath = Join-Path $tempDir "state.json"
        $state = New-CoordinatorState
        $state.turn.owner = "comfyui"
        $state.turn.status = "active"
        $state.turn.note = "이미지 배치 생성 중"
        Set-TextContentWithRetry -Path $statePath -Content ($state | ConvertTo-Json -Depth 8)

        $ansi = $null
        try { $ansi = [System.Text.Encoding]::GetEncoding(949) } catch { $ansi = $null }
        if ($ansi) { $PSDefaultParameterValues["Get-Content:Encoding"] = $ansi }
        try {
            $loaded = Get-CoordinatorState -Config ([pscustomobject]@{ state_path = $statePath })
        }
        finally {
            $PSDefaultParameterValues.Remove("Get-Content:Encoding")
        }
        Assert-Equal "comfyui" $loaded.turn.owner "a Korean turn note survives an ANSI default encoding"
        Assert-Equal "이미지 배치 생성 중" $loaded.turn.note "the Korean turn note is read back intact"
    }
    finally {
        Remove-Item -LiteralPath $tempDir -Recurse -Force
    }
}

# --- dispatcher --------------------------------------------------------------
& {
    $dispatcherPath = Join-Path $repoRoot "local-ai-dispatcher.ps1"
    foreach ($definition in Get-ScriptFunctions $dispatcherPath) { . ([scriptblock]::Create($definition)) }

    $cases = [ordered]@{
        "ComfyUI 이미지 생성 배치"           = "comfyui"
        "새 이미지 배치 준비"                = "comfyui"
        "generate an image of a cat"        = "comfyui"
        "이미지 분석해줘"                    = "vision"
        "화면 캡처 설명"                     = "vision"
        "take a screenshot of the render bug" = "vision"
        "search the docs"                   = "rag"
        "GPU status"                        = "status"
        "Write a paragraph about storage"   = "text"
        "Summarize the average leverage"    = "text"
        "Draft a project statement"         = "text"
        "Translate this drawer label"       = "text"
        "Fix the reindex job"               = "text"
    }
    foreach ($objective in $cases.Keys) {
        Assert-Equal $cases[$objective] (Resolve-Intent -Objective $objective -RequestedTaskType "auto") "intent of '$objective'"
    }
}

Write-Host "# pass $script:passes"
Write-Host "# fail $script:failures"
if ($script:failures -gt 0) { exit 1 }
