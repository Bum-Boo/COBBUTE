# Lightweight rule-based Windows AI resource manager for ComfyUI + Ollama.
# This script runs only when invoked. It does not install or change system settings.

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet("status", "state", "dashboard", "ollama-ps", "stop-ollama", "comfy-status", "profile", "request", "claim", "release", "ask", "vision", "embed", "queue", "drain-queue")]
    [string]$Action = "status",

    [Parameter(Position = 1, ValueFromRemainingArguments = $true)]
    [string[]]$InputText,

    [string]$ImagePath,
    [string]$ConfigPath = "",
    [switch]$Open,
    [switch]$Json
)

$ErrorActionPreference = "Stop"

$script:ManagerRoot = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($script:ManagerRoot)) {
    $script:ManagerRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
}
if ([string]::IsNullOrWhiteSpace($script:ManagerRoot)) {
    $script:ManagerRoot = (Get-Location).Path
}
if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
    $ConfigPath = Join-Path $script:ManagerRoot "local-ai-resource-manager.config.json"
}

function Join-InputText {
    param([string[]]$Parts)

    if (-not $Parts) {
        return ""
    }

    return ($Parts -join " ").Trim()
}

function Resolve-ManagerPath {
    param([string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return $null
    }

    if ([System.IO.Path]::IsPathRooted($Path)) {
        return [System.IO.Path]::GetFullPath($Path)
    }

    return [System.IO.Path]::GetFullPath((Join-Path $script:ManagerRoot $Path))
}

function Get-DefaultConfig {
    return [ordered]@{
        min_vram_for_qwen8b = 6144
        min_vram_for_qwen4b = 3584
        default_context_length = 8192
        keep_alive = "0"
        ollama_api = "http://127.0.0.1:11434"
        comfyui_api = "http://127.0.0.1:8188"
        comfyui_process_match = "ComfyUI"
        comfyui_start_command = ""
        comfyui_start_args = ""
        comfyui_lowvram_args = "--lowvram"
        comfyui_working_directory = ""
        queue_path = ".\local-ai-task-queue.jsonl"
        state_path = ".\local-ai-runtime-state.json"
        dashboard_path = ".\local-ai-dashboard.html"
        respect_turn_flags = $true
        models = [ordered]@{
            qwen8b = "qwen3:8b"
            qwen4b = "qwen3:4b"
            gemmaVision = "gemma3:4b"
            embeddingSmall = "qwen3-embedding:0.6b"
            embeddingLarge = "qwen3-embedding:4b"
        }
        ollama_stop_before_comfy = @(
            "qwen3:8b",
            "qwen3:4b",
            "gemma3:4b",
            "qwen3-embedding:0.6b",
            "qwen3-embedding:4b"
        )
    }
}

function Get-ManagerConfig {
    param([string]$Path)

    $resolvedPath = Resolve-ManagerPath $Path
    if (-not (Test-Path -LiteralPath $resolvedPath)) {
        $defaultConfig = Get-DefaultConfig
        $defaultConfig | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $resolvedPath -Encoding UTF8
    }

    return (Get-Content -Raw -LiteralPath $resolvedPath | ConvertFrom-Json)
}

function Get-ConfigString {
    param(
        $Config,
        [string]$Name,
        [string]$Default
    )

    $property = $Config.PSObject.Properties[$Name]
    if ($property -and -not [string]::IsNullOrWhiteSpace([string]$property.Value)) {
        return [string]$property.Value
    }

    return $Default
}

function Get-ConfigBoolean {
    param(
        $Config,
        [string]$Name,
        [bool]$Default
    )

    $property = $Config.PSObject.Properties[$Name]
    if (-not $property) {
        return $Default
    }

    if ($property.Value -is [bool]) {
        return [bool]$property.Value
    }

    $text = ([string]$property.Value).Trim().ToLowerInvariant()
    if ($text -in @("true", "1", "yes", "y")) {
        return $true
    }
    if ($text -in @("false", "0", "no", "n")) {
        return $false
    }

    return $Default
}

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

function Get-NvidiaSmiPath {
    $command = Get-Command nvidia-smi -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    $commonPath = "C:\Program Files\NVIDIA Corporation\NVSMI\nvidia-smi.exe"
    if (Test-Path -LiteralPath $commonPath) {
        return $commonPath
    }

    return $null
}

function Get-GpuStatus {
    $nvidiaSmi = Get-NvidiaSmiPath
    if (-not $nvidiaSmi) {
        return [pscustomobject]@{
            available = $false
            name = $null
            total_mb = 0
            used_mb = 0
            free_mb = 0
            utilization_gpu = 0
            error = "nvidia-smi was not found"
        }
    }

    $query = & $nvidiaSmi --query-gpu=name,memory.total,memory.used,memory.free,utilization.gpu --format=csv,noheader,nounits 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $query) {
        return [pscustomobject]@{
            available = $false
            name = $null
            total_mb = 0
            used_mb = 0
            free_mb = 0
            utilization_gpu = 0
            error = "nvidia-smi did not return GPU status"
        }
    }

    $line = @($query)[0]
    $parts = $line -split ",\s*"

    return [pscustomobject]@{
        available = $true
        name = $parts[0]
        total_mb = [int]$parts[1]
        used_mb = [int]$parts[2]
        free_mb = [int]$parts[3]
        utilization_gpu = [int]$parts[4]
        error = $null
    }
}

function Get-OllamaPs {
    $ollama = Get-OllamaPath
    if (-not $ollama) {
        return "Ollama was not found."
    }

    $output = & $ollama ps 2>&1
    return ($output | Out-String).TrimEnd()
}

function Stop-OllamaModels {
    param([string[]]$Models)

    $ollama = Get-OllamaPath
    if (-not $ollama) {
        Write-Host "Ollama was not found."
        return
    }

    foreach ($model in $Models) {
        if ([string]::IsNullOrWhiteSpace($model)) {
            continue
        }

        $output = & $ollama stop $model 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Stopped $model"
        }
        else {
            $message = ($output | Out-String).Trim()
            if ([string]::IsNullOrWhiteSpace($message)) {
                $message = "not currently loaded or stop failed"
            }
            Write-Host "Stop ${model}: $message"
        }
    }
}

function Get-ComfyProcesses {
    param($Config)

    $matchText = [string]$Config.comfyui_process_match
    if ([string]::IsNullOrWhiteSpace($matchText)) {
        $matchText = "ComfyUI"
    }

    $escapedMatch = [regex]::Escape($matchText)
    $ignoredProcessNames = @(
        "powershell.exe",
        "pwsh.exe",
        "node.exe",
        "cmd.exe",
        "conhost.exe",
        "WindowsTerminal.exe"
    )
    $processes = Get-CimInstance Win32_Process | Where-Object {
        $name = [string]$_.Name
        $commandLine = [string]$_.CommandLine
        $isIgnoredWrapper = $ignoredProcessNames -contains $name
        $looksLikeComfyPython = $commandLine -match "ComfyUI.*main\.py|main\.py.*ComfyUI|run_nvidia_gpu|run_cpu"

        $_.ProcessId -ne $PID -and
        -not ($commandLine -and $commandLine -match "local-ai-resource-manager\.ps1") -and
        -not ($isIgnoredWrapper -and -not $looksLikeComfyPython) -and (
            ($commandLine -and $commandLine -match $escapedMatch) -or
            ($_.Name -and $_.Name -match $escapedMatch)
        )
    }

    return @($processes)
}

function Get-ItemCount {
    param($Value)

    if ($null -eq $Value) {
        return 0
    }

    if ($Value -is [System.Array]) {
        return $Value.Count
    }

    return 1
}

function Get-StatePath {
    param($Config)

    $path = Get-ConfigString -Config $Config -Name "state_path" -Default ".\local-ai-runtime-state.json"
    return Resolve-ManagerPath $path
}

function Get-DashboardPath {
    param($Config)

    $path = Get-ConfigString -Config $Config -Name "dashboard_path" -Default ".\local-ai-dashboard.html"
    return Resolve-ManagerPath $path
}

function New-CoordinatorRequest {
    return [ordered]@{
        waiting = $false
        requested_at = $null
        note = ""
    }
}

function New-CoordinatorState {
    return [ordered]@{
        schema_version = 1
        updated_at = (Get-Date).ToString("o")
        turn = [ordered]@{
            owner = "none"
            status = "idle"
            since = $null
            note = ""
        }
        requests = [ordered]@{
            comfyui = (New-CoordinatorRequest)
            ollama = (New-CoordinatorRequest)
        }
        last_completed = $null
    }
}

function Add-MissingProperty {
    param(
        $Object,
        [string]$Name,
        $Value
    )

    if (-not $Object.PSObject.Properties[$Name]) {
        $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value
    }
}

function Set-TextContentWithRetry {
    param(
        [string]$Path,
        [string]$Content,
        [int]$Attempts = 5
    )

    $encoding = New-Object System.Text.UTF8Encoding($false)
    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        try {
            [System.IO.File]::WriteAllText($Path, $Content, $encoding)
            return
        }
        catch {
            if ($attempt -eq $Attempts) {
                throw
            }
            Start-Sleep -Milliseconds (100 * $attempt)
        }
    }
}

function Get-CoordinatorState {
    param($Config)

    $statePath = Get-StatePath -Config $Config
    if (-not (Test-Path -LiteralPath $statePath)) {
        $defaultState = New-CoordinatorState
        $stateDirectory = Split-Path -Parent $statePath
        if ($stateDirectory -and -not (Test-Path -LiteralPath $stateDirectory)) {
            New-Item -ItemType Directory -Path $stateDirectory | Out-Null
        }
        Set-TextContentWithRetry -Path $statePath -Content ($defaultState | ConvertTo-Json -Depth 8)
    }

    try {
        $state = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json
    }
    catch {
        $state = New-CoordinatorState | ConvertTo-Json -Depth 8 | ConvertFrom-Json
    }

    Add-MissingProperty -Object $state -Name "schema_version" -Value 1
    Add-MissingProperty -Object $state -Name "updated_at" -Value (Get-Date).ToString("o")
    Add-MissingProperty -Object $state -Name "turn" -Value ([pscustomobject]@{ owner = "none"; status = "idle"; since = $null; note = "" })
    Add-MissingProperty -Object $state -Name "requests" -Value ([pscustomobject]@{})
    Add-MissingProperty -Object $state -Name "last_completed" -Value $null

    Add-MissingProperty -Object $state.turn -Name "owner" -Value "none"
    Add-MissingProperty -Object $state.turn -Name "status" -Value "idle"
    Add-MissingProperty -Object $state.turn -Name "since" -Value $null
    Add-MissingProperty -Object $state.turn -Name "note" -Value ""

    foreach ($owner in @("comfyui", "ollama")) {
        if (-not $state.requests.PSObject.Properties[$owner]) {
            $state.requests | Add-Member -NotePropertyName $owner -NotePropertyValue ([pscustomobject](New-CoordinatorRequest))
        }
        $request = $state.requests.PSObject.Properties[$owner].Value
        Add-MissingProperty -Object $request -Name "waiting" -Value $false
        Add-MissingProperty -Object $request -Name "requested_at" -Value $null
        Add-MissingProperty -Object $request -Name "note" -Value ""
    }

    return $state
}

function Save-CoordinatorState {
    param(
        $Config,
        $State
    )

    $statePath = Get-StatePath -Config $Config
    $State.updated_at = (Get-Date).ToString("o")
    Set-TextContentWithRetry -Path $statePath -Content ($State | ConvertTo-Json -Depth 8)
}

function Normalize-OwnerName {
    param([string]$Owner)

    $normalized = ([string]$Owner).Trim().ToLowerInvariant()
    switch ($normalized) {
        "comfy" { return "comfyui" }
        "comfyui" { return "comfyui" }
        "ollama" { return "ollama" }
        "llm" { return "ollama" }
        "mixed" { return "mixed" }
        "none" { return "none" }
        default {
            throw "Unknown owner '$Owner'. Use comfyui, ollama, or mixed."
        }
    }
}

function Split-OwnerAndNote {
    param([string[]]$Parts)

    $text = Join-InputText -Parts $Parts
    if ([string]::IsNullOrWhiteSpace($text)) {
        throw "Owner is required. Use comfyui, ollama, or mixed."
    }

    $split = $text -split "\s+", 2
    $owner = Normalize-OwnerName -Owner $split[0]
    $note = ""
    if ($split.Count -gt 1) {
        $note = $split[1].Trim()
    }

    return [pscustomobject]@{
        owner = $owner
        note = $note
    }
}

function Set-TurnFlag {
    param(
        $Config,
        [string]$Owner,
        [string]$Status,
        [string]$Note
    )

    $owner = Normalize-OwnerName -Owner $Owner
    $state = Get-CoordinatorState -Config $Config
    $now = (Get-Date).ToString("o")

    $state.turn.owner = $owner
    $state.turn.status = $Status
    $state.turn.since = $now
    $state.turn.note = $Note

    if ($owner -in @("comfyui", "ollama")) {
        $request = $state.requests.PSObject.Properties[$owner].Value
        $request.waiting = $false
        $request.requested_at = $null
        $request.note = ""
    }

    Save-CoordinatorState -Config $Config -State $state
    return $state
}

function Set-RequestFlag {
    param(
        $Config,
        [string]$Owner,
        [string]$Note
    )

    $owner = Normalize-OwnerName -Owner $Owner
    if ($owner -notin @("comfyui", "ollama")) {
        throw "Requests can only target comfyui or ollama."
    }

    $state = Get-CoordinatorState -Config $Config
    $request = $state.requests.PSObject.Properties[$owner].Value
    $request.waiting = $true
    $request.requested_at = (Get-Date).ToString("o")
    $request.note = $Note

    Save-CoordinatorState -Config $Config -State $state
    return $state
}

function Release-TurnFlag {
    param(
        $Config,
        [string]$Owner,
        [string]$Note
    )

    $owner = Normalize-OwnerName -Owner $Owner
    $state = Get-CoordinatorState -Config $Config
    $now = (Get-Date).ToString("o")

    if ($owner -in @("comfyui", "ollama")) {
        $request = $state.requests.PSObject.Properties[$owner].Value
        $request.waiting = $false
        $request.requested_at = $null
        $request.note = ""
    }

    if ($state.turn.owner -eq $owner -or $owner -eq "none") {
        $state.last_completed = [pscustomobject]@{
            owner = $state.turn.owner
            status = $state.turn.status
            note = if ([string]::IsNullOrWhiteSpace($Note)) { $state.turn.note } else { $Note }
            completed_at = $now
        }

        $nextOwner = "none"
        foreach ($candidate in @("comfyui", "ollama")) {
            $candidateRequest = $state.requests.PSObject.Properties[$candidate].Value
            if ($candidateRequest.waiting) {
                $nextOwner = $candidate
                break
            }
        }

        if ($nextOwner -eq "none") {
            $state.turn.owner = "none"
            $state.turn.status = "idle"
            $state.turn.since = $now
            $state.turn.note = ""
        }
        else {
            $nextRequest = $state.requests.PSObject.Properties[$nextOwner].Value
            $state.turn.owner = $nextOwner
            $state.turn.status = "reserved"
            $state.turn.since = $now
            $state.turn.note = $nextRequest.note
            $nextRequest.waiting = $false
            $nextRequest.requested_at = $null
            $nextRequest.note = ""
        }
    }

    Save-CoordinatorState -Config $Config -State $state
    return $state
}

function Get-ComfyStatus {
    param($Config)

    $processes = @(Get-ComfyProcesses -Config $Config)
    $apiUrl = ([string]$Config.comfyui_api).TrimEnd("/")
    $apiReachable = $false
    $queueRunningCount = 0
    $queuePendingCount = 0
    $apiError = $null

    try {
        $queue = Invoke-RestMethod -Uri "$apiUrl/queue" -Method Get -TimeoutSec 1
        $apiReachable = $true
        $queueRunningCount = Get-ItemCount $queue.queue_running
        $queuePendingCount = Get-ItemCount $queue.queue_pending
    }
    catch {
        $apiError = $_.Exception.Message
    }

    $running = ($processes.Count -gt 0 -or $apiReachable)
    $generating = ($queueRunningCount -gt 0)

    return [pscustomobject]@{
        running = $running
        generating = $generating
        process_count = $processes.Count
        process_ids = @($processes | ForEach-Object { $_.ProcessId })
        api_reachable = $apiReachable
        queue_running = $queueRunningCount
        queue_pending = $queuePendingCount
        api_error = $apiError
    }
}

function Get-ModelName {
    param(
        $Config,
        [string]$Key
    )

    return [string]$Config.models.$Key
}

function Get-RouteDecision {
    param(
        $Config,
        [ValidateSet("text", "vision", "embedding")]
        [string]$TaskType
    )

    $gpu = Get-GpuStatus
    $comfy = Get-ComfyStatus -Config $Config
    $minQwen4b = [int]$Config.min_vram_for_qwen4b
    $minQwen8b = [int]$Config.min_vram_for_qwen8b
    $state = Get-CoordinatorState -Config $Config
    $respectTurnFlags = Get-ConfigBoolean -Config $Config -Name "respect_turn_flags" -Default $true

    if (-not $gpu.available) {
        return [pscustomobject]@{
            allowed = $false
            action = "queue"
            model = $null
            reason = $gpu.error
            task_type = $TaskType
            gpu = $gpu
            comfy = $comfy
        }
    }

    if ($comfy.generating) {
        return [pscustomobject]@{
            allowed = $false
            action = "queue"
            model = $null
            reason = "ComfyUI is generating"
            task_type = $TaskType
            gpu = $gpu
            comfy = $comfy
        }
    }

    if ($respectTurnFlags -and $state.turn.owner -eq "comfyui" -and $state.turn.status -in @("reserved", "active")) {
        return [pscustomobject]@{
            allowed = $false
            action = "queue"
            model = $null
            reason = "ComfyUI has the current turn flag"
            task_type = $TaskType
            gpu = $gpu
            comfy = $comfy
            turn = $state.turn
        }
    }

    if ($respectTurnFlags -and $state.turn.owner -eq "mixed" -and $TaskType -ne "text") {
        return [pscustomobject]@{
            allowed = $false
            action = "queue"
            model = $null
            reason = "Mixed turn only allows lightweight text tasks"
            task_type = $TaskType
            gpu = $gpu
            comfy = $comfy
            turn = $state.turn
        }
    }

    if ($gpu.free_mb -lt $minQwen4b) {
        return [pscustomobject]@{
            allowed = $false
            action = "queue"
            model = $null
            reason = "VRAM free is below $minQwen4b MB"
            task_type = $TaskType
            gpu = $gpu
            comfy = $comfy
            turn = $state.turn
        }
    }

    if ($TaskType -eq "embedding") {
        return [pscustomobject]@{
            allowed = $true
            action = "embed"
            model = (Get-ModelName -Config $Config -Key "embeddingSmall")
            reason = "RAG/Obsidian embedding task"
            task_type = $TaskType
            gpu = $gpu
            comfy = $comfy
            turn = $state.turn
        }
    }

    if ($TaskType -eq "vision") {
        return [pscustomobject]@{
            allowed = $true
            action = "generate"
            model = (Get-ModelName -Config $Config -Key "gemmaVision")
            reason = "Image or screenshot understanding while ComfyUI is idle or closed"
            task_type = $TaskType
            gpu = $gpu
            comfy = $comfy
            turn = $state.turn
        }
    }

    if ($respectTurnFlags -and $state.turn.owner -eq "mixed") {
        return [pscustomobject]@{
            allowed = $true
            action = "generate"
            model = (Get-ModelName -Config $Config -Key "qwen4b")
            reason = "Mixed turn flag allows lightweight text routing"
            task_type = $TaskType
            gpu = $gpu
            comfy = $comfy
            turn = $state.turn
        }
    }

    if ($gpu.free_mb -ge $minQwen8b -and -not $comfy.running) {
        return [pscustomobject]@{
            allowed = $true
            action = "generate"
            model = (Get-ModelName -Config $Config -Key "qwen8b")
            reason = "VRAM free is above $minQwen8b MB and ComfyUI is not running"
            task_type = $TaskType
            gpu = $gpu
            comfy = $comfy
            turn = $state.turn
        }
    }

    return [pscustomobject]@{
        allowed = $true
        action = "generate"
        model = (Get-ModelName -Config $Config -Key "qwen4b")
        reason = "VRAM free is at least $minQwen4b MB, or ComfyUI is running idle"
        task_type = $TaskType
        gpu = $gpu
        comfy = $comfy
        turn = $state.turn
    }
}

function Add-QueuedTask {
    param(
        $Config,
        [string]$TaskType,
        [string]$Prompt,
        [string]$ImagePath,
        [string]$Reason,
        [string]$Owner = "ollama"
    )

    $queuePath = Resolve-ManagerPath ([string]$Config.queue_path)
    $queueDirectory = Split-Path -Parent $queuePath
    if ($queueDirectory -and -not (Test-Path -LiteralPath $queueDirectory)) {
        New-Item -ItemType Directory -Path $queueDirectory | Out-Null
    }

    $item = [ordered]@{
        id = ([guid]::NewGuid().ToString("N")).Substring(0, 12)
        queued_at = (Get-Date).ToString("o")
        owner = $Owner
        task_type = $TaskType
        prompt = $Prompt
        image_path = $ImagePath
        reason = $Reason
    }

    Add-Content -LiteralPath $queuePath -Value ($item | ConvertTo-Json -Compress -Depth 6) -Encoding UTF8
    return $queuePath
}

function Get-QueuedTasks {
    param($Config)

    $queuePath = Resolve-ManagerPath ([string]$Config.queue_path)
    if (-not (Test-Path -LiteralPath $queuePath)) {
        return @()
    }

    $lines = Get-Content -LiteralPath $queuePath | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    $tasks = foreach ($line in $lines) {
        try {
            $line | ConvertFrom-Json
        }
        catch {
            Write-Warning "Skipping invalid queue line: $line"
        }
    }

    return @($tasks)
}

function Clear-Queue {
    param($Config)

    $queuePath = Resolve-ManagerPath ([string]$Config.queue_path)
    if (Test-Path -LiteralPath $queuePath) {
        Clear-Content -LiteralPath $queuePath
    }
}

function Invoke-OllamaGenerate {
    param(
        $Config,
        [string]$Model,
        [string]$Prompt,
        [string]$ImagePath
    )

    $apiUrl = ([string]$Config.ollama_api).TrimEnd("/")
    $body = [ordered]@{
        model = $Model
        prompt = $Prompt
        stream = $false
        keep_alive = [string]$Config.keep_alive
        options = @{
            num_ctx = [int]$Config.default_context_length
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($ImagePath)) {
        $resolvedImage = (Resolve-Path -LiteralPath $ImagePath).Path
        $body.images = @([Convert]::ToBase64String([System.IO.File]::ReadAllBytes($resolvedImage)))
    }

    return Invoke-RestMethod -Uri "$apiUrl/api/generate" -Method Post -ContentType "application/json" -Body ($body | ConvertTo-Json -Depth 8) -TimeoutSec 1800
}

function Invoke-OllamaEmbed {
    param(
        $Config,
        [string]$Model,
        [string]$Input
    )

    $apiUrl = ([string]$Config.ollama_api).TrimEnd("/")
    $body = [ordered]@{
        model = $Model
        input = $Input
        keep_alive = [string]$Config.keep_alive
        options = @{
            num_ctx = [int]$Config.default_context_length
        }
    }

    return Invoke-RestMethod -Uri "$apiUrl/api/embed" -Method Post -ContentType "application/json" -Body ($body | ConvertTo-Json -Depth 8) -TimeoutSec 1800
}

function Invoke-RoutedTask {
    param(
        $Config,
        [ValidateSet("text", "vision", "embedding")]
        [string]$TaskType,
        [string]$Prompt,
        [string]$ImagePath,
        [switch]$Json
    )

    if ([string]::IsNullOrWhiteSpace($Prompt)) {
        throw "Prompt/input text is required."
    }

    $decision = Get-RouteDecision -Config $Config -TaskType $TaskType
    if (-not $decision.allowed) {
        $queuePath = Add-QueuedTask -Config $Config -TaskType $TaskType -Prompt $Prompt -ImagePath $ImagePath -Reason $decision.reason
        $queued = [pscustomobject]@{
            queued = $true
            queue_path = $queuePath
            decision = $decision
        }

        if ($Json) {
            $queued | ConvertTo-Json -Depth 8
        }
        else {
            Write-Host "Queued task: $($decision.reason)"
            Write-Host "Queue: $queuePath"
        }
        return
    }

    if ($TaskType -eq "embedding") {
        $result = Invoke-OllamaEmbed -Config $Config -Model $decision.model -Input $Prompt
        if ($Json) {
            [pscustomobject]@{
                decision = $decision
                response = $result
            } | ConvertTo-Json -Depth 12
        }
        else {
            $embeddingCount = Get-ItemCount $result.embeddings
            $dimensionCount = 0
            if ($embeddingCount -gt 0) {
                $firstEmbedding = @($result.embeddings)[0]
                $dimensionCount = @($firstEmbedding).Count
            }
            Write-Host "Model: $($decision.model)"
            Write-Host "Embeddings: $embeddingCount"
            Write-Host "Dimensions: $dimensionCount"
            Write-Host "Use -Json to print the full embedding payload."
        }
        return
    }

    $result = Invoke-OllamaGenerate -Config $Config -Model $decision.model -Prompt $Prompt -ImagePath $ImagePath
    if ($Json) {
        [pscustomobject]@{
            decision = $decision
            response = $result
        } | ConvertTo-Json -Depth 12
    }
    else {
        Write-Host "Model: $($decision.model)"
        Write-Host "Reason: $($decision.reason)"
        Write-Host ""
        Write-Output $result.response
    }
}

function Start-ComfyUi {
    param(
        $Config,
        [switch]$LowVram
    )

    $status = Get-ComfyStatus -Config $Config
    if ($status.running) {
        Write-Host "ComfyUI already appears to be running."
        return
    }

    $command = [string]$Config.comfyui_start_command
    if ([string]::IsNullOrWhiteSpace($command)) {
        Write-Host "ComfyUI launch command is not configured."
        Write-Host "Edit local-ai-resource-manager.config.json and set comfyui_start_command."
        return
    }

    $argumentList = @()
    if (-not [string]::IsNullOrWhiteSpace([string]$Config.comfyui_start_args)) {
        $argumentList += [string]$Config.comfyui_start_args
    }
    if ($LowVram -and -not [string]::IsNullOrWhiteSpace([string]$Config.comfyui_lowvram_args)) {
        $argumentList += [string]$Config.comfyui_lowvram_args
    }

    $startParameters = @{
        FilePath = $command
        WindowStyle = "Hidden"
    }

    if ($argumentList.Count -gt 0) {
        $startParameters.ArgumentList = ($argumentList -join " ")
    }

    if (-not [string]::IsNullOrWhiteSpace([string]$Config.comfyui_working_directory)) {
        $startParameters.WorkingDirectory = [string]$Config.comfyui_working_directory
    }

    Start-Process @startParameters
    Write-Host "Started ComfyUI."
}

function Stop-ComfyUi {
    param($Config)

    $processes = @(Get-ComfyProcesses -Config $Config)
    if ($processes.Count -eq 0) {
        Write-Host "ComfyUI is not running."
        return
    }

    foreach ($process in $processes) {
        Write-Host "Stopping ComfyUI process $($process.ProcessId) ($($process.Name))"
        Stop-Process -Id $process.ProcessId -Force
    }
}

function Invoke-Profile {
    param(
        $Config,
        [string]$ProfileName
    )

    if ([string]::IsNullOrWhiteSpace($ProfileName)) {
        throw "Profile name is required. Use creative, mixed, or writing."
    }

    switch ($ProfileName.ToLowerInvariant()) {
        "creative" {
            Write-Host "Creative mode: ComfyUI priority. Stopping configured Ollama models first."
            Set-TurnFlag -Config $Config -Owner "comfyui" -Status "reserved" -Note "Creative profile: ComfyUI priority" | Out-Null
            Stop-OllamaModels -Models @($Config.ollama_stop_before_comfy)
            Start-ComfyUi -Config $Config
        }
        "mixed" {
            Write-Host "Mixed mode: ComfyUI lowvram + qwen3:4b only."
            Set-TurnFlag -Config $Config -Owner "mixed" -Status "reserved" -Note "Mixed profile: ComfyUI low VRAM and qwen3:4b text only" | Out-Null
            $modelsToStop = @(
                (Get-ModelName -Config $Config -Key "qwen8b"),
                (Get-ModelName -Config $Config -Key "gemmaVision"),
                (Get-ModelName -Config $Config -Key "embeddingSmall"),
                (Get-ModelName -Config $Config -Key "embeddingLarge")
            )
            Stop-OllamaModels -Models $modelsToStop
            Start-ComfyUi -Config $Config -LowVram
        }
        "writing" {
            Write-Host "Writing mode: stopping ComfyUI and allowing qwen3:8b."
            Set-TurnFlag -Config $Config -Owner "ollama" -Status "reserved" -Note "Writing profile: Ollama priority" | Out-Null
            Stop-ComfyUi -Config $Config
            $modelsToStop = @(
                (Get-ModelName -Config $Config -Key "qwen4b"),
                (Get-ModelName -Config $Config -Key "gemmaVision")
            )
            Stop-OllamaModels -Models $modelsToStop
        }
        default {
            throw "Unknown profile '$ProfileName'. Use creative, mixed, or writing."
        }
    }
}

function Get-ObjectProperty {
    param(
        $Object,
        [string]$Name,
        $Default = $null
    )

    if ($null -eq $Object) {
        return $Default
    }

    $property = $Object.PSObject.Properties[$Name]
    if ($property) {
        return $property.Value
    }

    return $Default
}

function Get-OllamaLoadedModelsFromText {
    param([string]$OllamaPsText)

    if ([string]::IsNullOrWhiteSpace($OllamaPsText)) {
        return @()
    }

    if ($OllamaPsText -match "Ollama was not found") {
        return @()
    }

    $lines = @($OllamaPsText -split "`r?`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($lines.Count -le 1) {
        return @()
    }

    $models = foreach ($line in $lines) {
        if ($line -match "^\s*NAME\s+") {
            continue
        }

        $parts = $line.Trim() -split "\s+"
        if ($parts.Count -eq 0) {
            continue
        }

        [pscustomobject]@{
            name = $parts[0]
            raw = $line.Trim()
        }
    }

    return @($models)
}

function Limit-Text {
    param(
        [string]$Text,
        [int]$MaxLength = 120
    )

    if ([string]::IsNullOrWhiteSpace($Text)) {
        return ""
    }

    $clean = ($Text -replace "\s+", " ").Trim()
    if ($clean.Length -le $MaxLength) {
        return $clean
    }

    return $clean.Substring(0, $MaxLength - 3) + "..."
}

function ConvertTo-HtmlText {
    param([string]$Text)

    return [System.Net.WebUtility]::HtmlEncode([string]$Text)
}

function Get-CoordinatorView {
    param($Config)

    $state = Get-CoordinatorState -Config $Config
    $gpu = Get-GpuStatus
    $comfy = Get-ComfyStatus -Config $Config
    $ollamaPs = Get-OllamaPs
    $loadedModels = Get-OllamaLoadedModelsFromText -OllamaPsText $ollamaPs
    $tasks = Get-QueuedTasks -Config $Config
    $minQwen4b = [int]$Config.min_vram_for_qwen4b

    $liveOwner = "none"
    $liveReason = "No active GPU owner detected"
    if ($comfy.generating) {
        $liveOwner = "comfyui"
        $liveReason = "ComfyUI API reports a running generation"
    }
    elseif ($comfy.running -and $gpu.available -and $gpu.free_mb -lt $minQwen4b) {
        $liveOwner = "comfyui"
        $liveReason = "ComfyUI is running and VRAM free is below $minQwen4b MB"
    }
    elseif ($loadedModels.Count -gt 0) {
        $liveOwner = "ollama"
        $liveReason = "Ollama has loaded model(s)"
    }
    elseif ($state.turn.owner -ne "none") {
        $liveOwner = $state.turn.owner
        $liveReason = "Turn flag is $($state.turn.status)"
    }

    $waitingItems = @()
    foreach ($task in $tasks) {
        $prompt = Get-ObjectProperty -Object $task -Name "prompt" -Default ""
        $waitingItems += [pscustomobject]@{
            id = Get-ObjectProperty -Object $task -Name "id" -Default "legacy"
            owner = Get-ObjectProperty -Object $task -Name "owner" -Default "ollama"
            kind = Get-ObjectProperty -Object $task -Name "task_type" -Default "task"
            title = Limit-Text -Text $prompt -MaxLength 110
            reason = Get-ObjectProperty -Object $task -Name "reason" -Default ""
            since = Get-ObjectProperty -Object $task -Name "queued_at" -Default ""
            source = "manager queue"
        }
    }

    foreach ($owner in @("comfyui", "ollama")) {
        $request = $state.requests.PSObject.Properties[$owner].Value
        if ($request.waiting) {
            $waitingItems += [pscustomobject]@{
                id = "request"
                owner = $owner
                kind = "request"
                title = if ([string]::IsNullOrWhiteSpace($request.note)) { "$owner requested a turn" } else { $request.note }
                reason = "Waiting for the current turn to be released"
                since = $request.requested_at
                source = "turn flag"
            }
        }
    }

    if ($comfy.queue_pending -gt 0) {
        $waitingItems += [pscustomobject]@{
            id = "comfy-pending"
            owner = "comfyui"
            kind = "comfy queue"
            title = "$($comfy.queue_pending) ComfyUI item(s) pending"
            reason = "Reported by ComfyUI /queue"
            since = ""
            source = "ComfyUI API"
        }
    }

    return [pscustomobject]@{
        generated_at = (Get-Date).ToString("o")
        state_path = Get-StatePath -Config $Config
        queue_path = Resolve-ManagerPath ([string]$Config.queue_path)
        dashboard_path = Get-DashboardPath -Config $Config
        state = $state
        gpu = $gpu
        comfy = $comfy
        ollama_ps = $ollamaPs
        ollama_loaded_models = @($loadedModels)
        live_owner = $liveOwner
        live_reason = $liveReason
        waiting_items = @($waitingItems)
    }
}

function Get-OwnerLabel {
    param([string]$Owner)

    switch ($Owner) {
        "comfyui" { return "ComfyUI" }
        "ollama" { return "Ollama" }
        "mixed" { return "Mixed" }
        default { return "None" }
    }
}

function Get-ComfyDisplayStatus {
    param($View)

    if ($View.comfy.generating) {
        return "In use"
    }
    if ($View.state.turn.owner -eq "comfyui") {
        return "Turn held"
    }
    if ($View.live_owner -eq "comfyui") {
        return "VRAM held"
    }
    if ($View.comfy.running) {
        return "On, idle"
    }
    return "Off"
}

function Get-OllamaDisplayStatus {
    param($View)

    if ($View.ollama_loaded_models.Count -gt 0) {
        return "In use"
    }
    if ($View.state.turn.owner -eq "ollama") {
        return "Turn held"
    }
    if ($View.state.turn.owner -eq "mixed") {
        return "Mixed mode"
    }
    return "Waiting"
}

function New-DashboardHtml {
    param($View)

    $generatedLocal = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss K")
    $turnOwner = Get-OwnerLabel -Owner $View.state.turn.owner
    $liveOwner = Get-OwnerLabel -Owner $View.live_owner
    $comfyStatus = Get-ComfyDisplayStatus -View $View
    $ollamaStatus = Get-OllamaDisplayStatus -View $View
    $vramPercent = 0
    if ($View.gpu.available -and $View.gpu.total_mb -gt 0) {
        $vramPercent = [math]::Round(($View.gpu.used_mb / $View.gpu.total_mb) * 100, 1)
    }

    $modelRows = if ($View.ollama_loaded_models.Count -eq 0) {
        "<p class=""muted"">No loaded Ollama models</p>"
    }
    else {
        ($View.ollama_loaded_models | ForEach-Object {
            "<div class=""model-row""><span>$((ConvertTo-HtmlText $_.name))</span><code>$((ConvertTo-HtmlText $_.raw))</code></div>"
        }) -join "`n"
    }

    $waitingRows = if ($View.waiting_items.Count -eq 0) {
        "<p class=""muted"">No waiting work</p>"
    }
    else {
        ($View.waiting_items | ForEach-Object {
            $owner = ConvertTo-HtmlText (Get-OwnerLabel -Owner $_.owner)
            $kind = ConvertTo-HtmlText $_.kind
            $title = ConvertTo-HtmlText $_.title
            $reason = ConvertTo-HtmlText $_.reason
            $since = ConvertTo-HtmlText $_.since
            $source = ConvertTo-HtmlText $_.source
            "<article class=""queue-item""><div><span class=""tag"">$owner</span><span class=""tag soft"">$kind</span></div><strong>$title</strong><p>$reason</p><small>$source $since</small></article>"
        }) -join "`n"
    }

    $comfyTurnClass = if ($View.state.turn.owner -eq "comfyui") { "on" } else { "off" }
    $ollamaTurnClass = if ($View.state.turn.owner -eq "ollama") { "on" } elseif ($View.state.turn.owner -eq "mixed") { "mixed" } else { "off" }
    $liveClass = if ($View.live_owner -eq "comfyui") { "comfy" } elseif ($View.live_owner -eq "ollama") { "ollama" } elseif ($View.live_owner -eq "mixed") { "mixed" } else { "idle" }

@"
<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Local AI Resource Dashboard</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f9;
      --panel: #ffffff;
      --line: #d8dde5;
      --text: #17202a;
      --muted: #657282;
      --comfy: #0f766e;
      --ollama: #2557a7;
      --mixed: #8a5a00;
      --danger: #b42318;
      --idle: #596579;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", "Malgun Gothic", Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      letter-spacing: 0;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 18px 24px;
      border-bottom: 1px solid var(--line);
      background: var(--panel);
    }
    h1, h2, h3, p { margin: 0; }
    h1 { font-size: 20px; font-weight: 700; }
    h2 { font-size: 16px; font-weight: 700; }
    h3 { font-size: 14px; font-weight: 700; }
    main { padding: 20px 24px 28px; }
    code {
      font-family: Consolas, "Cascadia Mono", monospace;
      font-size: 12px;
      word-break: break-word;
    }
    .timestamp { color: var(--muted); font-size: 12px; text-align: right; }
    .summary {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 18px;
    }
    .tile, .lane, .commands {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
    }
    .tile { padding: 14px; min-height: 104px; }
    .tile .label { color: var(--muted); font-size: 12px; margin-bottom: 8px; }
    .tile .value { font-size: 22px; font-weight: 700; }
    .tile .detail { color: var(--muted); font-size: 12px; margin-top: 8px; line-height: 1.45; }
    .meter { height: 8px; background: #e8ecf2; border-radius: 999px; overflow: hidden; margin-top: 10px; }
    .meter span { display: block; height: 100%; background: #5b6f8f; width: $vramPercent%; }
    .lanes {
      display: grid;
      grid-template-columns: 1fr 1fr 1.15fr;
      gap: 12px;
      align-items: start;
    }
    .lane { padding: 16px; min-height: 310px; }
    .lane-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 14px;
    }
    .pill, .tag {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      padding: 3px 8px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
      white-space: nowrap;
    }
    .pill.on, .tag { color: #ffffff; background: var(--comfy); }
    .pill.off { color: var(--idle); background: #eef1f5; }
    .pill.mixed { color: #ffffff; background: var(--mixed); }
    .live.comfy { color: #ffffff; background: var(--comfy); }
    .live.ollama { color: #ffffff; background: var(--ollama); }
    .live.mixed { color: #ffffff; background: var(--mixed); }
    .live.idle { color: var(--idle); background: #eef1f5; }
    .tag.soft { color: var(--text); background: #eef1f5; margin-left: 6px; }
    .status-list {
      display: grid;
      gap: 10px;
      margin-top: 12px;
    }
    .status-list div {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid #eef1f5;
      font-size: 13px;
    }
    .status-list span:first-child { color: var(--muted); }
    .model-row {
      display: grid;
      gap: 4px;
      padding: 10px 0;
      border-bottom: 1px solid #eef1f5;
      font-size: 13px;
    }
    .model-row span { font-weight: 700; color: var(--ollama); }
    .queue-list { display: grid; gap: 10px; }
    .queue-item {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px;
      background: #fbfcfe;
    }
    .queue-item strong {
      display: block;
      margin-top: 8px;
      font-size: 13px;
      line-height: 1.35;
    }
    .queue-item p {
      margin-top: 6px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.4;
    }
    .queue-item small {
      display: block;
      margin-top: 8px;
      color: var(--muted);
      font-size: 11px;
      line-height: 1.35;
      word-break: break-word;
    }
    .muted { color: var(--muted); font-size: 13px; line-height: 1.5; }
    .commands {
      margin-top: 12px;
      padding: 16px;
    }
    .command-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      margin-top: 12px;
    }
    .command-grid div {
      border-top: 1px solid #eef1f5;
      padding-top: 10px;
      display: grid;
      gap: 6px;
    }
    @media (max-width: 980px) {
      .summary, .lanes, .command-grid { grid-template-columns: 1fr; }
      header { align-items: flex-start; flex-direction: column; }
      .timestamp { text-align: left; }
    }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Local AI Resource Dashboard</h1>
      <p class="muted">GPU turn flags, queue, and VRAM state for ComfyUI and Ollama</p>
    </div>
    <div class="timestamp">Generated<br>$generatedLocal</div>
  </header>
  <main>
    <section class="summary" aria-label="Summary">
      <div class="tile">
        <div class="label">Live owner</div>
        <div class="value"><span class="pill live $liveClass">$liveOwner</span></div>
        <p class="detail">$((ConvertTo-HtmlText $View.live_reason))</p>
      </div>
      <div class="tile">
        <div class="label">Turn flag</div>
        <div class="value">$turnOwner</div>
        <p class="detail">$((ConvertTo-HtmlText $View.state.turn.status)) - $((ConvertTo-HtmlText $View.state.turn.note))</p>
      </div>
      <div class="tile">
        <div class="label">VRAM</div>
        <div class="value">$($View.gpu.free_mb) MB free</div>
        <div class="meter"><span></span></div>
        <p class="detail">$($View.gpu.used_mb) MB used / $($View.gpu.total_mb) MB total</p>
      </div>
      <div class="tile">
        <div class="label">Waiting</div>
        <div class="value">$($View.waiting_items.Count)</div>
        <p class="detail">Manager queue, manual requests, ComfyUI pending queue combined</p>
      </div>
    </section>

    <section class="lanes" aria-label="Resource lanes">
      <section class="lane">
        <div class="lane-head">
          <h2>ComfyUI</h2>
          <span class="pill $comfyTurnClass">$comfyStatus</span>
        </div>
        <div class="status-list">
          <div><span>Running</span><strong>$($View.comfy.running)</strong></div>
          <div><span>Generating</span><strong>$($View.comfy.generating)</strong></div>
          <div><span>Queue running</span><strong>$($View.comfy.queue_running)</strong></div>
          <div><span>Queue pending</span><strong>$($View.comfy.queue_pending)</strong></div>
          <div><span>Process IDs</span><strong>$((ConvertTo-HtmlText ((@($View.comfy.process_ids) -join ', '))))</strong></div>
        </div>
      </section>

      <section class="lane">
        <div class="lane-head">
          <h2>Ollama</h2>
          <span class="pill $ollamaTurnClass">$ollamaStatus</span>
        </div>
        $modelRows
      </section>

      <section class="lane">
        <div class="lane-head">
          <h2>Waiting Queue</h2>
          <span class="pill off">$($View.waiting_items.Count) items</span>
        </div>
        <div class="queue-list">
          $waitingRows
        </div>
      </section>
    </section>

    <section class="commands">
      <h2>Control commands</h2>
      <div class="command-grid">
        <div>
          <h3>ComfyUI turn</h3>
          <code>.\local-ai-resource-manager.ps1 request comfyui "image batch"</code>
          <code>.\local-ai-resource-manager.ps1 claim comfyui "generating"</code>
          <code>.\local-ai-resource-manager.ps1 release comfyui</code>
        </div>
        <div>
          <h3>Ollama turn</h3>
          <code>.\local-ai-resource-manager.ps1 request ollama "RAG question"</code>
          <code>.\local-ai-resource-manager.ps1 claim ollama "writing"</code>
          <code>.\local-ai-resource-manager.ps1 release ollama</code>
        </div>
        <div>
          <h3>Dashboard</h3>
          <code>.\local-ai-resource-manager.ps1 dashboard -Open</code>
          <code>.\local-ai-resource-manager.ps1 state</code>
          <code>.\local-ai-resource-manager.ps1 queue</code>
        </div>
      </div>
    </section>
  </main>
</body>
</html>
"@
}

function Write-Dashboard {
    param(
        $Config,
        [switch]$Open
    )

    $view = Get-CoordinatorView -Config $Config
    $dashboardPath = Get-DashboardPath -Config $Config
    $html = New-DashboardHtml -View $view
    $html | Set-Content -LiteralPath $dashboardPath -Encoding UTF8

    if ($Open) {
        Start-Process -FilePath $dashboardPath
    }

    Write-Host "Dashboard: $dashboardPath"
}

function Show-CoordinatorState {
    param(
        $Config,
        [switch]$Json
    )

    $view = Get-CoordinatorView -Config $Config
    if ($Json) {
        $view | ConvertTo-Json -Depth 10
        return
    }

    Write-Host "Turn flag: $(Get-OwnerLabel -Owner $view.state.turn.owner) / $($view.state.turn.status)"
    if (-not [string]::IsNullOrWhiteSpace($view.state.turn.note)) {
        Write-Host "Turn note: $($view.state.turn.note)"
    }
    Write-Host "Live owner: $(Get-OwnerLabel -Owner $view.live_owner) - $($view.live_reason)"
    Write-Host "State file: $($view.state_path)"
    Write-Host "Queue file: $($view.queue_path)"
    Write-Host ""
    Write-Host "Requests:"
    foreach ($owner in @("comfyui", "ollama")) {
        $request = $view.state.requests.PSObject.Properties[$owner].Value
        Write-Host "  $(Get-OwnerLabel -Owner $owner): waiting=$($request.waiting) note=$($request.note)"
    }
    Write-Host ""
    Write-Host "Waiting items: $($view.waiting_items.Count)"
    foreach ($item in $view.waiting_items) {
        Write-Host "  [$($item.owner)] $($item.kind): $($item.title) - $($item.reason)"
    }
}

function Show-Status {
    param(
        $Config,
        [switch]$Json
    )

    $gpu = Get-GpuStatus
    $comfy = Get-ComfyStatus -Config $Config
    $ollamaPs = Get-OllamaPs
    $textRoute = Get-RouteDecision -Config $Config -TaskType "text"

    if ($Json) {
        [pscustomobject]@{
            gpu = $gpu
            comfy = $comfy
            ollama_ps = $ollamaPs
            text_route = $textRoute
        } | ConvertTo-Json -Depth 8
        return
    }

    if ($gpu.available) {
        Write-Host "GPU: $($gpu.name)"
        Write-Host "VRAM: $($gpu.free_mb) MB free / $($gpu.total_mb) MB total ($($gpu.used_mb) MB used)"
        Write-Host "GPU utilization: $($gpu.utilization_gpu)%"
    }
    else {
        Write-Host "GPU: $($gpu.error)"
    }

    Write-Host ""
    Write-Host "ComfyUI:"
    Write-Host "  Running: $($comfy.running)"
    Write-Host "  Generating: $($comfy.generating)"
    Write-Host "  Queue running/pending: $($comfy.queue_running)/$($comfy.queue_pending)"
    Write-Host "  Process IDs: $(@($comfy.process_ids) -join ', ')"

    Write-Host ""
    Write-Host "Ollama loaded models:"
    if ([string]::IsNullOrWhiteSpace($ollamaPs)) {
        Write-Host "  No output from ollama ps."
    }
    else {
        Write-Output $ollamaPs
    }

    Write-Host ""
    Write-Host "Text route now: $($textRoute.action) $($textRoute.model) - $($textRoute.reason)"
}

function Show-Queue {
    param($Config)

    $tasks = Get-QueuedTasks -Config $Config
    $queuePath = Resolve-ManagerPath ([string]$Config.queue_path)
    Write-Host "Queue: $queuePath"
    Write-Host "Queued tasks: $($tasks.Count)"

    foreach ($task in $tasks) {
        $id = Get-ObjectProperty -Object $task -Name "id" -Default "legacy"
        $owner = Get-ObjectProperty -Object $task -Name "owner" -Default "ollama"
        $taskType = Get-ObjectProperty -Object $task -Name "task_type" -Default "task"
        $reason = Get-ObjectProperty -Object $task -Name "reason" -Default ""
        $queuedAt = Get-ObjectProperty -Object $task -Name "queued_at" -Default ""
        Write-Host "$queuedAt [$owner/$taskType/$id] $reason"
    }
}

function Invoke-DrainQueue {
    param(
        $Config,
        [switch]$Json
    )

    $tasks = Get-QueuedTasks -Config $Config
    if ($tasks.Count -eq 0) {
        Write-Host "Queue is empty."
        return
    }

    Clear-Queue -Config $Config

    foreach ($task in $tasks) {
        try {
            Invoke-RoutedTask -Config $Config -TaskType $task.task_type -Prompt $task.prompt -ImagePath $task.image_path -Json:$Json
        }
        catch {
            Add-QueuedTask -Config $Config -TaskType $task.task_type -Prompt $task.prompt -ImagePath $task.image_path -Reason $_.Exception.Message | Out-Null
            Write-Host "Re-queued task after error: $($_.Exception.Message)"
        }
    }
}

$config = Get-ManagerConfig -Path $ConfigPath
$text = Join-InputText -Parts $InputText

switch ($Action) {
    "status" {
        Show-Status -Config $config -Json:$Json
    }
    "state" {
        Show-CoordinatorState -Config $config -Json:$Json
    }
    "dashboard" {
        Write-Dashboard -Config $config -Open:$Open
    }
    "ollama-ps" {
        Get-OllamaPs
    }
    "stop-ollama" {
        Stop-OllamaModels -Models @($config.ollama_stop_before_comfy)
    }
    "comfy-status" {
        $status = Get-ComfyStatus -Config $config
        if ($Json) {
            $status | ConvertTo-Json -Depth 6
        }
        else {
            Write-Host "Running: $($status.running)"
            Write-Host "Generating: $($status.generating)"
            Write-Host "Queue running/pending: $($status.queue_running)/$($status.queue_pending)"
            Write-Host "Process IDs: $(@($status.process_ids) -join ', ')"
        }
    }
    "profile" {
        Invoke-Profile -Config $config -ProfileName $text
    }
    "request" {
        $target = Split-OwnerAndNote -Parts $InputText
        $state = Set-RequestFlag -Config $config -Owner $target.owner -Note $target.note
        Write-Host "Requested turn: $(Get-OwnerLabel -Owner $target.owner)"
        if (-not [string]::IsNullOrWhiteSpace($target.note)) {
            Write-Host "Note: $($target.note)"
        }
        Write-Host "Current turn: $(Get-OwnerLabel -Owner $state.turn.owner) / $($state.turn.status)"
    }
    "claim" {
        $target = Split-OwnerAndNote -Parts $InputText
        $state = Set-TurnFlag -Config $config -Owner $target.owner -Status "active" -Note $target.note
        Write-Host "Claimed turn: $(Get-OwnerLabel -Owner $state.turn.owner) / $($state.turn.status)"
    }
    "release" {
        $target = Split-OwnerAndNote -Parts $InputText
        $state = Release-TurnFlag -Config $config -Owner $target.owner -Note $target.note
        Write-Host "Released: $(Get-OwnerLabel -Owner $target.owner)"
        Write-Host "Current turn: $(Get-OwnerLabel -Owner $state.turn.owner) / $($state.turn.status)"
    }
    "ask" {
        Invoke-RoutedTask -Config $config -TaskType "text" -Prompt $text -Json:$Json
    }
    "vision" {
        Invoke-RoutedTask -Config $config -TaskType "vision" -Prompt $text -ImagePath $ImagePath -Json:$Json
    }
    "embed" {
        Invoke-RoutedTask -Config $config -TaskType "embedding" -Prompt $text -Json:$Json
    }
    "queue" {
        Show-Queue -Config $config
    }
    "drain-queue" {
        Invoke-DrainQueue -Config $config -Json:$Json
    }
}
