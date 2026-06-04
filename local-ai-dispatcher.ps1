# CPU-only one-shot dispatcher for local ComfyUI + Ollama coordination.
# It exits after each run. It does not call an LLM unless -Execute is used.

[CmdletBinding()]
param(
    [Parameter(Position = 0, ValueFromRemainingArguments = $true)]
    [string[]]$ObjectiveParts,

    [ValidateSet("auto", "status", "text", "rag", "vision", "comfyui", "embedding")]
    [string]$TaskType = "auto",

    [switch]$Apply,
    [switch]$Execute,
    [switch]$Json,
    [switch]$NoDashboard,
    [string]$ImagePath = "",
    [string]$ConfigPath = ""
)

$ErrorActionPreference = "Stop"

$script:DispatcherRoot = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($script:DispatcherRoot)) {
    $script:DispatcherRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
}
if ([string]::IsNullOrWhiteSpace($script:DispatcherRoot)) {
    $script:DispatcherRoot = (Get-Location).Path
}

$script:ManagerPath = Join-Path $script:DispatcherRoot "local-ai-resource-manager.ps1"
$script:PersonasPath = Join-Path $script:DispatcherRoot "local-ai-personas.json"
$script:LogPath = Join-Path $script:DispatcherRoot "local-ai-coordinator-log.jsonl"
if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
    $ConfigPath = Join-Path $script:DispatcherRoot "local-ai-resource-manager.config.json"
}

function Join-Objective {
    param([string[]]$Parts)

    if (-not $Parts) {
        return ""
    }
    return ($Parts -join " ").Trim()
}

function Read-JsonFile {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Required file not found: $Path"
    }
    return Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json
}

function Invoke-ManagerText {
    param([string[]]$Arguments)

    if (-not (Test-Path -LiteralPath $script:ManagerPath)) {
        throw "Manager script not found: $script:ManagerPath"
    }

    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script:ManagerPath @Arguments 2>&1
    $exitCode = $LASTEXITCODE
    $text = ($output | Out-String).TrimEnd()
    if ($exitCode -ne 0) {
        throw "Manager command failed ($($Arguments -join ' ')): $text"
    }
    return $text
}

function Invoke-ManagerJson {
    param([string[]]$Arguments)

    $text = Invoke-ManagerText -Arguments $Arguments
    return $text | ConvertFrom-Json
}

function New-RunId {
    return "cpu-{0}-{1}" -f (Get-Date).ToUniversalTime().ToString("yyyyMMddHHmmss"), ([guid]::NewGuid().ToString("N").Substring(0, 6))
}

function New-HangulSyllable {
    param(
        [int]$Initial,
        [int]$Medial,
        [int]$Final = 0
    )

    return [string][char](0xAC00 + (($Initial * 21 + $Medial) * 28) + $Final)
}

function New-HangulWord {
    param([string]$Spec)

    $chars = foreach ($part in ($Spec -split ";")) {
        $items = @($part -split "," | ForEach-Object { [int]($_.Trim()) })
        $tail = 0
        if ($items.Count -ge 3) {
            $tail = $items[2]
        }
        New-HangulSyllable -Initial $items[0] -Medial $items[1] -Final $tail
    }
    return ($chars -join "")
}

function Test-ContainsAny {
    param(
        [string]$Text,
        [string[]]$Keywords
    )

    foreach ($keyword in $Keywords) {
        if (-not [string]::IsNullOrWhiteSpace($keyword) -and $Text.Contains($keyword)) {
            return $true
        }
    }
    return $false
}

function Get-ObjectValue {
    param(
        $Object,
        [string]$Name,
        $Default = $null
    )

    if ($null -ne $Object -and $Object.PSObject.Properties[$Name]) {
        return $Object.PSObject.Properties[$Name].Value
    }
    return $Default
}

function Resolve-Intent {
    param(
        [string]$Objective,
        [string]$RequestedTaskType
    )

    if ($RequestedTaskType -ne "auto") {
        return $RequestedTaskType
    }

    $text = $Objective.ToLowerInvariant()

    $statusKo = @(
        (New-HangulWord "9,0,21;16,1,0"),
        (New-HangulWord "18,6,4;18,9,21"),
        (New-HangulWord "15,17,0"),
        (New-HangulWord "3,1,0;0,20,0"),
        (New-HangulWord "5,20,0;9,8,0;9,18,0"),
        (New-HangulWord "7,18,0;11,20,0;5,1,16")
    )
    $visionKo = @(
        (New-HangulWord "9,18,0;15,18,0;5,20,4;9,2,19"),
        (New-HangulWord "18,9,0;6,6,4"),
        (New-HangulWord "11,20,0;6,20,0;12,20,0"),
        (New-HangulWord "9,0,0;12,20,4"),
        (New-HangulWord "7,13,4;9,4,1"),
        (New-HangulWord "15,1,17;14,4,0")
    )
    $embeddingKo = @(
        (New-HangulWord "9,1,1;11,20,4"),
        (New-HangulWord "11,20,16;7,5,0;3,20,21"),
        (New-HangulWord "7,5,1;16,4,0")
    )
    $ragKo = @(
        (New-HangulWord "6,13,4;9,4,0"),
        (New-HangulWord "12,0,0;5,12,0"),
        (New-HangulWord "0,4,16;9,1,1"),
        (New-HangulWord "0,18,4;0,4,0"),
        (New-HangulWord "14,13,8;14,4,0"),
        (New-HangulWord "11,20,4;11,12,21"),
        (New-HangulWord "11,4,17;5,8,0;3,18,0")
    )
    $comfyKo = @(
        (New-HangulWord "11,20,0;6,20,0;12,20,0"),
        (New-HangulWord "9,1,21;9,4,21"),
        (New-HangulWord "0,18,0;5,20,16"),
        (New-HangulWord "5,5,4;3,4,0"),
        (New-HangulWord "7,1,0;14,20,0"),
        (New-HangulWord "15,4,16;17,20,0")
    )

    if ([string]::IsNullOrWhiteSpace($text) -or ($text -match "status|state|queue|vram|gpu|resource") -or (Test-ContainsAny -Text $Objective -Keywords $statusKo)) {
        return "status"
    }
    if (($text -match "embedding|embed|index|vector") -or (Test-ContainsAny -Text $Objective -Keywords $embeddingKo)) {
        return "embedding"
    }
    if (($text -match "rag|document|docs|pdf|source|citation|retrieve|search") -or (Test-ContainsAny -Text $Objective -Keywords $ragKo)) {
        return "rag"
    }
    if (($text -match "screenshot|screen shot|ui capture|image analysis|describe image|vision") -or (Test-ContainsAny -Text $Objective -Keywords $visionKo)) {
        return "vision"
    }
    if (($text -match "comfy|stable diffusion|image generation|generate image|draw|render") -or (Test-ContainsAny -Text $Objective -Keywords $comfyKo)) {
        return "comfyui"
    }
    return "text"
}

function Get-AgentNameForIntent {
    param([string]$Intent)

    switch ($Intent) {
        "status" { return "resource_manager" }
        "rag" { return "rag_librarian" }
        "embedding" { return "rag_librarian" }
        "vision" { return "vision_reviewer" }
        "comfyui" { return "comfyui_operator" }
        default { return "writer" }
    }
}

function Get-ModelForIntent {
    param(
        [string]$Intent,
        $Config,
        $View
    )

    $minQwen8b = [int]$Config.min_vram_for_qwen8b
    $freeVram = [int]$View.gpu.free_mb
    $comfyRunning = [bool]$View.comfy.running

    switch ($Intent) {
        "status" { return "none" }
        "comfyui" { return "none" }
        "vision" { return [string]$Config.models.gemmaVision }
        "embedding" { return [string]$Config.models.embeddingSmall }
        "rag" {
            if ($freeVram -ge $minQwen8b -and -not $comfyRunning) {
                return [string]$Config.models.qwen8b
            }
            return [string]$Config.models.qwen4b
        }
        default {
            if ($freeVram -ge $minQwen8b -and -not $comfyRunning) {
                return [string]$Config.models.qwen8b
            }
            return [string]$Config.models.qwen4b
        }
    }
}

function Test-OllamaTurnAvailable {
    param(
        [string]$Intent,
        $Config,
        $View
    )

    if ($Intent -in @("status", "comfyui")) {
        return $true
    }
    if (-not [bool]$View.gpu.available) {
        return $false
    }
    if ([bool]$View.comfy.generating) {
        return $false
    }
    $turnOwner = [string]$View.state.turn.owner
    $turnStatus = [string]$View.state.turn.status
    if ($turnOwner -eq "comfyui" -and $turnStatus -in @("reserved", "active")) {
        return $false
    }
    if ([int]$View.gpu.free_mb -lt [int]$Config.min_vram_for_qwen4b) {
        return $false
    }
    return $true
}

function Get-DecisionReason {
    param(
        [string]$Intent,
        [bool]$CanRunNow,
        $Config,
        $View
    )

    if ($Intent -eq "status") {
        return "Status requests use only the CPU rule engine."
    }
    if ($Intent -eq "comfyui") {
        return "ComfyUI work should own the GPU turn; no Ollama model is needed for dispatch."
    }
    if ($CanRunNow) {
        return "Ollama turn appears available under current VRAM and turn-flag rules."
    }
    if ([bool]$View.comfy.generating) {
        return "ComfyUI is generating, so Ollama work should wait."
    }
    if ([string]$View.live_owner -eq "comfyui") {
        return "ComfyUI is the live owner or is holding too much VRAM for Ollama."
    }
    if ([int]$View.gpu.free_mb -lt [int]$Config.min_vram_for_qwen4b) {
        return "Free VRAM is below the qwen3:4b threshold."
    }
    return "Current turn flags or resource state require deferral."
}

function Get-RecommendedCommands {
    param(
        [string]$Intent,
        [string]$Objective,
        [bool]$CanRunNow
    )

    switch ($Intent) {
        "status" {
            return @(
                ".\local-ai-resource-manager.ps1 state",
                ".\local-ai-resource-manager.ps1 dashboard"
            )
        }
        "comfyui" {
            return @(
                ".\local-ai-resource-manager.ps1 claim comfyui `"$Objective`"",
                ".\local-ai-resource-manager.ps1 dashboard"
            )
        }
        default {
            if ($CanRunNow) {
                return @(
                    ".\local-ai-resource-manager.ps1 claim ollama `"$Objective`"",
                    ".\local-ai-resource-manager.ps1 ask `"$Objective`"",
                    ".\local-ai-resource-manager.ps1 release ollama"
                )
            }
            return @(
                ".\local-ai-resource-manager.ps1 request ollama `"$Objective`"",
                ".\local-ai-resource-manager.ps1 dashboard"
            )
        }
    }
}

function Get-AgentResponsibility {
    param(
        $Personas,
        [string]$AgentName
    )

    $agent = Get-ObjectValue -Object $Personas.agents -Name $AgentName
    if ($null -eq $agent) {
        return ""
    }
    return [string](Get-ObjectValue -Object $agent -Name "responsibility" -Default "")
}

function Append-JsonLine {
    param(
        [string]$Path,
        $Record
    )

    $jsonLine = $Record | ConvertTo-Json -Depth 24 -Compress
    Add-Content -LiteralPath $Path -Value $jsonLine -Encoding UTF8
}

function Invoke-ApplyAction {
    param(
        [string]$Intent,
        [string]$Objective,
        [bool]$CanRunNow
    )

    if ($Intent -eq "status") {
        return [pscustomobject]@{ target = "manager"; command = "state"; status = "skipped"; output = "Status was already read without mutating turn flags." }
    }
    if ($Intent -eq "comfyui") {
        $output = Invoke-ManagerText -Arguments @("claim", "comfyui", $Objective)
        return [pscustomobject]@{ target = "comfyui"; command = "claim comfyui"; status = "done"; output = $output }
    }
    if ($CanRunNow) {
        $output = Invoke-ManagerText -Arguments @("claim", "ollama", $Objective)
        return [pscustomobject]@{ target = "ollama"; command = "claim ollama"; status = "done"; output = $output }
    }
    $output = Invoke-ManagerText -Arguments @("request", "ollama", $Objective)
    return [pscustomobject]@{ target = "ollama"; command = "request ollama"; status = "done"; output = $output }
}

function Invoke-ExecuteAction {
    param(
        [string]$Intent,
        [string]$Objective,
        [string]$ImagePath
    )

    switch ($Intent) {
        "text" {
            $output = Invoke-ManagerText -Arguments @("ask", $Objective)
            return [pscustomobject]@{ target = "ollama"; command = "ask"; status = "done"; output = $output }
        }
        "vision" {
            if ([string]::IsNullOrWhiteSpace($ImagePath)) {
                return [pscustomobject]@{ target = "ollama"; command = "vision"; status = "blocked"; output = "ImagePath is required for vision execution." }
            }
            $output = Invoke-ManagerText -Arguments @("vision", "-ImagePath", $ImagePath, $Objective)
            return [pscustomobject]@{ target = "ollama"; command = "vision"; status = "done"; output = $output }
        }
        "embedding" {
            $output = Invoke-ManagerText -Arguments @("embed", $Objective)
            return [pscustomobject]@{ target = "ollama"; command = "embed"; status = "done"; output = $output }
        }
        default {
            return [pscustomobject]@{ target = "manager"; command = "execute"; status = "skipped"; output = "This dispatcher only executes text, vision, and embedding through the manager. Use AnythingLLM manually for RAG retrieval." }
        }
    }
}

function New-InitialState {
    param($View)

    return [pscustomobject]@{
        live_owner = [string]$View.live_owner
        live_reason = [string]$View.live_reason
        turn_owner = [string]$View.state.turn.owner
        turn_status = [string]$View.state.turn.status
        free_vram_mb = [int]$View.gpu.free_mb
        total_vram_mb = [int]$View.gpu.total_mb
        comfy_running = [bool]$View.comfy.running
        comfy_generating = [bool]$View.comfy.generating
        comfy_queue_running = [int]$View.comfy.queue_running
        comfy_queue_pending = [int]$View.comfy.queue_pending
        ollama_loaded_models = @($View.ollama_loaded_models)
        waiting_count = @($View.waiting_items).Count
    }
}

function Write-HumanSummary {
    param($Record)

    Write-Host "# CPU Local AI Dispatcher"
    Write-Host ""
    Write-Host "Objective: $($Record.objective)"
    Write-Host "Intent: $($Record.intent)"
    Write-Host "Reasoning engine: $($Record.reasoning_engine)"
    Write-Host "Decision: $($Record.decision)"
    Write-Host "Reason: $($Record.reason)"
    Write-Host ""
    Write-Host "Live owner: $($Record.initial_state.live_owner) - $($Record.initial_state.live_reason)"
    Write-Host "Turn flag: $($Record.initial_state.turn_owner) / $($Record.initial_state.turn_status)"
    Write-Host "VRAM: $($Record.initial_state.free_vram_mb) MB free / $($Record.initial_state.total_vram_mb) MB total"
    Write-Host "ComfyUI: running=$($Record.initial_state.comfy_running), generating=$($Record.initial_state.comfy_generating)"
    Write-Host "Ollama loaded models: $($Record.initial_state.ollama_loaded_models -join ', ')"
    Write-Host ""
    Write-Host "Assignment: $($Record.assignments[0].agent) -> $($Record.assignments[0].model)"
    Write-Host "Persona: $($Record.assignments[0].persona)"
    Write-Host ""
    Write-Host "Recommended commands:"
    foreach ($command in $Record.recommended_commands) {
        Write-Host "  $command"
    }
    Write-Host ""
    Write-Host "Log: $script:LogPath"
    Write-Host "Dashboard: $($Record.dashboard_path)"
}

$objective = Join-Objective -Parts $ObjectiveParts
if ([string]::IsNullOrWhiteSpace($objective)) {
    $objective = "Show current local AI resource status."
}

$config = Read-JsonFile -Path $ConfigPath
$personas = Read-JsonFile -Path $script:PersonasPath
$view = Invoke-ManagerJson -Arguments @("state", "-Json")
$startView = $view

$intent = Resolve-Intent -Objective $objective -RequestedTaskType $TaskType
$agentName = Get-AgentNameForIntent -Intent $intent
$modelName = Get-ModelForIntent -Intent $intent -Config $config -View $view
$canRunNow = Test-OllamaTurnAvailable -Intent $intent -Config $config -View $view
$reason = Get-DecisionReason -Intent $intent -CanRunNow $canRunNow -Config $config -View $view
$decision = if ($intent -eq "status") {
    "report"
}
elseif ($intent -eq "comfyui") {
    "handoff_to_comfyui"
}
elseif ($canRunNow) {
    "ollama_can_run_if_explicitly_executed"
}
else {
    "defer_or_request_ollama_turn"
}

$dashboardPath = [string]$view.dashboard_path
$issuedCommands = @()
$progress = @(
    [pscustomobject]@{ at = (Get-Date).ToUniversalTime().ToString("o"); step = "Read resource state"; status = "done"; detail = [string]$view.live_reason },
    [pscustomobject]@{ at = (Get-Date).ToUniversalTime().ToString("o"); step = "Classify objective"; status = "done"; detail = $intent },
    [pscustomobject]@{ at = (Get-Date).ToUniversalTime().ToString("o"); step = "Assign persona and model"; status = "done"; detail = "$agentName -> $modelName" }
)

if ($Apply) {
    $applyResult = Invoke-ApplyAction -Intent $intent -Objective $objective -CanRunNow $canRunNow
    $issuedCommands += $applyResult
    $progress += [pscustomobject]@{ at = (Get-Date).ToUniversalTime().ToString("o"); step = "Apply turn action"; status = $applyResult.status; detail = $applyResult.command }
    $view = Invoke-ManagerJson -Arguments @("state", "-Json")
}

if ($Execute) {
    $executeResult = Invoke-ExecuteAction -Intent $intent -Objective $objective -ImagePath $ImagePath
    $issuedCommands += $executeResult
    $progress += [pscustomobject]@{ at = (Get-Date).ToUniversalTime().ToString("o"); step = "Execute delegated task"; status = $executeResult.status; detail = $executeResult.command }
    $view = Invoke-ManagerJson -Arguments @("state", "-Json")
}

if (-not $NoDashboard) {
    $dashboardOutput = Invoke-ManagerText -Arguments @("dashboard")
    $issuedCommands += [pscustomobject]@{ target = "manager"; command = "dashboard"; status = "done"; output = $dashboardOutput }
    $dashboardPath = [string]$view.dashboard_path
}

$record = [pscustomobject]@{
    run_id = New-RunId
    created_at = (Get-Date).ToUniversalTime().ToString("o")
    finished_at = (Get-Date).ToUniversalTime().ToString("o")
    status = "complete"
    action = "cpu_dispatch"
    objective = $objective
    intent = $intent
    reasoning_engine = "cpu_rule_engine"
    gpu_compute_used = "none"
    decision = $decision
    reason = $reason
    initial_state = (New-InitialState -View $startView)
    assignments = @(
        [pscustomobject]@{
            agent = $agentName
            model = $modelName
            fallback = "rule_based_dispatch"
            persona = Get-AgentResponsibility -Personas $personas -AgentName $agentName
            command = $objective
            progress = "planned"
        },
        [pscustomobject]@{
            agent = "resource_manager"
            model = "none"
            fallback = "cpu_rule_engine"
            persona = Get-AgentResponsibility -Personas $personas -AgentName "resource_manager"
            command = "Read state, classify request, and write handoff log."
            progress = "done"
        }
    )
    recommended_commands = @(Get-RecommendedCommands -Intent $intent -Objective $objective -CanRunNow $canRunNow)
    issued_commands = @($issuedCommands)
    progress = @($progress)
    dashboard_path = $dashboardPath
}

Append-JsonLine -Path $script:LogPath -Record $record

if ($Json) {
    $record | ConvertTo-Json -Depth 24
}
else {
    Write-HumanSummary -Record $record
}
