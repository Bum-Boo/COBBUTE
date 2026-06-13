param(
    [switch]$StartMinimized
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$script:Config = [ordered]@{
    Distro = if ($env:HERMES_WSL_DISTRO) { $env:HERMES_WSL_DISTRO } else { 'Ubuntu' }
    DashboardUrl = if ($env:HERMES_DASHBOARD_URL) { $env:HERMES_DASHBOARD_URL } else { 'http://127.0.0.1:9119' }
    DashboardTaskName = if ($env:HERMES_DASHBOARD_TASK_NAME) { $env:HERMES_DASHBOARD_TASK_NAME } else { 'Hermes Dashboard 9119' }
    DashboardScript = if ($env:HERMES_DASHBOARD_SCRIPT) { $env:HERMES_DASHBOARD_SCRIPT } else { '$HOME/hermes-lab/bin/hermes-dashboard-9119.sh' }
    HermesHome = if ($env:HERMES_HOME) { $env:HERMES_HOME } else { '$HOME/hermes-lab/.hermes' }
    LabRoot = if ($env:HERMES_LAB_ROOT) { $env:HERMES_LAB_ROOT } else { '$HOME/hermes-lab' }
    RefreshSeconds = 15
}

$script:LastReady = $null
$script:LastStatus = $null
$script:IsBusy = $false
$script:ExitRequested = $false

function Get-WslPath {
    $systemWsl = Join-Path $env:WINDIR 'System32\wsl.exe'
    if (Test-Path -LiteralPath $systemWsl) { return $systemWsl }
    return 'wsl.exe'
}

function Invoke-External {
    param(
        [Parameter(Mandatory=$true)][string]$FilePath,
        [Parameter(Mandatory=$true)][string[]]$Arguments,
        [int]$TimeoutSeconds = 10
    )

    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $FilePath
    foreach ($arg in $Arguments) {
        [void]$psi.ArgumentList.Add($arg)
    }
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true

    $process = [System.Diagnostics.Process]::Start($psi)
    $finished = $process.WaitForExit($TimeoutSeconds * 1000)
    if (-not $finished) {
        try { $process.Kill() } catch {}
        return [pscustomobject]@{
            ExitCode = 124
            Output = ''
            Error = "Timed out after $TimeoutSeconds seconds"
            TimedOut = $true
        }
    }

    return [pscustomobject]@{
        ExitCode = $process.ExitCode
        Output = $process.StandardOutput.ReadToEnd()
        Error = $process.StandardError.ReadToEnd()
        TimedOut = $false
    }
}

function Invoke-Wsl {
    param(
        [Parameter(Mandatory=$true)][string]$Command,
        [int]$TimeoutSeconds = 10
    )

    Invoke-External -FilePath (Get-WslPath) -Arguments @(
        '-d', $script:Config.Distro,
        '--',
        'bash',
        '-lc',
        $Command
    ) -TimeoutSeconds $TimeoutSeconds
}

function Test-Dashboard {
    try {
        $response = Invoke-WebRequest -Uri $script:Config.DashboardUrl -UseBasicParsing -TimeoutSec 3
        return ($response.StatusCode -eq 200)
    } catch {
        return $false
    }
}

function Get-WslRunning {
    $result = Invoke-External -FilePath (Get-WslPath) -Arguments @('-l','-v') -TimeoutSeconds 6
    $text = ($result.Output + "`n" + $result.Error) -replace "`0", ''
    return ($text -match "(?m)^\s*\*?\s*$([regex]::Escape($script:Config.Distro))\s+Running\s+2\s*$")
}

function Get-HermesGatewayStatus {
    if (-not (Get-WslRunning)) { return 'WSL off' }
    $result = Invoke-Wsl -TimeoutSeconds 8 -Command 'systemctl --user is-active hermes-gateway.service 2>/dev/null || true'
    $text = $result.Output.Trim()
    if ([string]::IsNullOrWhiteSpace($text)) { return 'unknown' }
    return $text
}

function Get-CodexAuthStatus {
    if (-not (Get-WslRunning)) { return 'WSL off' }
    $cmd = "cd $($script:Config.LabRoot) && HERMES_HOME=$($script:Config.HermesHome) hermes auth status openai-codex 2>&1 | head -n 1"
    $result = Invoke-Wsl -TimeoutSeconds 12 -Command $cmd
    $text = $result.Output.Trim()
    if ($text -match 'logged in') { return 'logged in' }
    if ([string]::IsNullOrWhiteSpace($text)) { return 'unknown' }
    return $text
}

function Get-HermesLabStatus {
    $wslRunning = Get-WslRunning
    $dashboardOnline = Test-Dashboard
    $gateway = if ($wslRunning) { Get-HermesGatewayStatus } else { 'WSL off' }
    $auth = if ($wslRunning) { Get-CodexAuthStatus } else { 'WSL off' }
    $ready = $wslRunning -and $dashboardOnline -and ($auth -eq 'logged in')

    [pscustomobject]@{
        WslRunning = $wslRunning
        DashboardOnline = $dashboardOnline
        Gateway = $gateway
        CodexAuth = $auth
        Ready = $ready
        CheckedAt = Get-Date
    }
}

function Start-HermesLab {
    Set-UiBusy 'Starting Hermes...'
    try {
        $task = Get-ScheduledTask -TaskName $script:Config.DashboardTaskName -ErrorAction SilentlyContinue
        if ($task) {
            Start-ScheduledTask -TaskName $script:Config.DashboardTaskName
        } else {
            Start-Process -FilePath (Get-WslPath) -ArgumentList @('-d', $script:Config.Distro, '--exec', $script:Config.DashboardScript) -WindowStyle Hidden
        }

        Start-Sleep -Seconds 3
        [void](Invoke-Wsl -TimeoutSeconds 12 -Command "cd $($script:Config.LabRoot) && HERMES_HOME=$($script:Config.HermesHome) hermes gateway status >/dev/null 2>&1 || true")
        Update-Status
        Show-Balloon 'Hermes Lab' 'Start command sent. Status will refresh shortly.'
    } catch {
        Show-Balloon 'Hermes Lab Error' $_.Exception.Message
        [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Hermes Lab Error', 'OK', 'Error') | Out-Null
    } finally {
        Clear-UiBusy
    }
}

function Stop-HermesLab {
    Set-UiBusy 'Stopping Hermes...'
    try {
        Stop-ScheduledTask -TaskName $script:Config.DashboardTaskName -ErrorAction SilentlyContinue
        [void](Invoke-Wsl -TimeoutSeconds 15 -Command "systemctl --user stop hermes-dashboard.service >/dev/null 2>&1 || true; HERMES_HOME=$($script:Config.HermesHome) hermes gateway stop >/dev/null 2>&1 || systemctl --user stop hermes-gateway.service >/dev/null 2>&1 || true")
        [void](Invoke-External -FilePath (Get-WslPath) -Arguments @('--terminate', $script:Config.Distro) -TimeoutSeconds 15)
        Start-Sleep -Seconds 2
        Update-Status
        Show-Balloon 'Hermes Lab' 'Hermes and WSL Ubuntu were stopped.'
    } catch {
        Show-Balloon 'Hermes Lab Error' $_.Exception.Message
        [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Hermes Lab Error', 'OK', 'Error') | Out-Null
    } finally {
        Clear-UiBusy
    }
}

function Open-Dashboard {
    Start-Process $script:Config.DashboardUrl
}

function Open-LabFolder {
    Start-Process 'explorer.exe' '\\wsl.localhost\Ubuntu\home\hojun\hermes-lab'
}

function Show-Balloon {
    param(
        [Parameter(Mandatory=$true)][string]$Title,
        [Parameter(Mandatory=$true)][string]$Text
    )
    $script:NotifyIcon.BalloonTipTitle = $Title
    $script:NotifyIcon.BalloonTipText = $Text
    $script:NotifyIcon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
    $script:NotifyIcon.ShowBalloonTip(4000)
}

function Set-UiBusy {
    param([string]$Message)
    $script:IsBusy = $true
    $script:StatusLabel.Text = $Message
    if (Get-Variable -Name StatusPill -Scope Script -ErrorAction SilentlyContinue) {
        $script:StatusPill.Text = 'WORKING'
        $script:StatusPill.BackColor = [System.Drawing.Color]::FromArgb(78, 116, 180)
    }
    $script:StartButton.Enabled = $false
    $script:StopButton.Enabled = $false
    $script:RefreshButton.Enabled = $false
    $script:Progress.Style = 'Marquee'
    [System.Windows.Forms.Application]::DoEvents()
}

function Clear-UiBusy {
    $script:IsBusy = $false
    $script:StartButton.Enabled = $true
    $script:StopButton.Enabled = $true
    $script:RefreshButton.Enabled = $true
    $script:Progress.Style = 'Blocks'
    $script:Progress.Value = 0
}

function Set-StatusDot {
    param([System.Drawing.Color]$Color)
    $bitmap = [System.Drawing.Bitmap]::new(16, 16)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $brush = [System.Drawing.SolidBrush]::new($Color)
    $graphics.FillEllipse($brush, 2, 2, 12, 12)
    $brush.Dispose()
    $graphics.Dispose()
    $script:StatusPicture.Image = $bitmap
}

function Update-Status {
    if ($script:IsBusy) { return }
    try {
        $status = Get-HermesLabStatus
        $script:LastStatus = $status

        if ($status.Ready) {
            Set-StatusDot ([System.Drawing.Color]::FromArgb(35, 160, 80))
            $script:StatusLabel.Text = 'Hermes is connected'
            $script:StatusPill.Text = 'CONNECTED'
            $script:StatusPill.BackColor = [System.Drawing.Color]::FromArgb(35, 160, 80)
            $script:NotifyIcon.Text = 'Hermes Lab: connected'
            $script:OpenButton.Enabled = $true
        } elseif ($status.WslRunning) {
            Set-StatusDot ([System.Drawing.Color]::FromArgb(230, 160, 30))
            $script:StatusLabel.Text = 'WSL running, Hermes partial'
            $script:StatusPill.Text = 'PARTIAL'
            $script:StatusPill.BackColor = [System.Drawing.Color]::FromArgb(215, 144, 28)
            $script:NotifyIcon.Text = 'Hermes Lab: partial'
            $script:OpenButton.Enabled = $status.DashboardOnline
        } else {
            Set-StatusDot ([System.Drawing.Color]::FromArgb(180, 60, 60))
            $script:StatusLabel.Text = 'Hermes off / WSL stopped'
            $script:StatusPill.Text = 'STOPPED'
            $script:StatusPill.BackColor = [System.Drawing.Color]::FromArgb(180, 60, 60)
            $script:NotifyIcon.Text = 'Hermes Lab: stopped'
            $script:OpenButton.Enabled = $false
        }

        $script:WslValue.Text = if ($status.WslRunning) { 'running' } else { 'stopped' }
        $script:DashboardValue.Text = if ($status.DashboardOnline) { 'online' } else { 'offline' }
        $script:GatewayValue.Text = $status.Gateway
        $script:AuthValue.Text = $status.CodexAuth
        $script:CheckedValue.Text = $status.CheckedAt.ToString('HH:mm:ss')

        if ($null -ne $script:LastReady -and $script:LastReady -ne $status.Ready) {
            if ($status.Ready) {
                Show-Balloon 'Hermes connected' 'Dashboard and Codex OAuth are online.'
            } else {
                Show-Balloon 'Hermes disconnected' 'Hermes is stopped or partially disconnected.'
            }
        }
        $script:LastReady = $status.Ready
    } catch {
        Set-StatusDot ([System.Drawing.Color]::FromArgb(180, 60, 60))
        $script:StatusLabel.Text = 'Status check failed'
        $script:StatusPill.Text = 'CHECK FAILED'
        $script:StatusPill.BackColor = [System.Drawing.Color]::FromArgb(180, 60, 60)
        $script:NotifyIcon.Text = 'Hermes Lab: check failed'
        $script:CheckedValue.Text = (Get-Date).ToString('HH:mm:ss')
    }
}

function New-UiLabel {
    param(
        [string]$Text,
        [int]$X,
        [int]$Y,
        [int]$Width,
        [int]$Height = 24,
        [int]$Size = 10,
        [System.Drawing.FontStyle]$Style = [System.Drawing.FontStyle]::Regular,
        [System.Drawing.Color]$Color = [System.Drawing.Color]::FromArgb(39, 48, 64)
    )
    $label = [System.Windows.Forms.Label]::new()
    $label.Location = [System.Drawing.Point]::new($X, $Y)
    $label.Size = [System.Drawing.Size]::new($Width, $Height)
    $label.Text = $Text
    $label.Font = [System.Drawing.Font]::new('Segoe UI', $Size, $Style)
    $label.ForeColor = $Color
    $label.BackColor = [System.Drawing.Color]::Transparent
    return $label
}

function New-CardPanel {
    param(
        [int]$X,
        [int]$Y,
        [int]$Width,
        [int]$Height
    )
    $panel = [System.Windows.Forms.Panel]::new()
    $panel.Location = [System.Drawing.Point]::new($X, $Y)
    $panel.Size = [System.Drawing.Size]::new($Width, $Height)
    $panel.BackColor = [System.Drawing.Color]::White
    $panel.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
    return $panel
}

function Set-ActionButtonStyle {
    param(
        [System.Windows.Forms.Button]$Button,
        [System.Drawing.Color]$BackColor,
        [System.Drawing.Color]$ForeColor
    )
    $Button.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
    $Button.FlatAppearance.BorderSize = 0
    $Button.BackColor = $BackColor
    $Button.ForeColor = $ForeColor
    $Button.Font = [System.Drawing.Font]::new('Segoe UI', 9, [System.Drawing.FontStyle]::Bold)
    $Button.Cursor = [System.Windows.Forms.Cursors]::Hand
}

$script:Form = [System.Windows.Forms.Form]::new()
$script:Form.Text = 'Hermes Lab Controller'
$script:Form.Size = [System.Drawing.Size]::new(540, 430)
$script:Form.StartPosition = 'CenterScreen'
$script:Form.FormBorderStyle = 'FixedDialog'
$script:Form.MaximizeBox = $false
$script:Form.Font = [System.Drawing.Font]::new('Segoe UI', 10)
$script:Form.BackColor = [System.Drawing.Color]::FromArgb(246, 248, 251)

$headerPanel = New-CardPanel -X 18 -Y 18 -Width 486 -Height 104
$script:Form.Controls.Add($headerPanel)

$titleLabel = New-UiLabel -Text 'Hermes Lab' -X 22 -Y 16 -Width 220 -Height 28 -Size 15 -Style ([System.Drawing.FontStyle]::Bold)
$headerPanel.Controls.Add($titleLabel)

$subtitleLabel = New-UiLabel -Text 'Local WSL control center' -X 22 -Y 47 -Width 280 -Height 22 -Size 9 -Color ([System.Drawing.Color]::FromArgb(95, 105, 120))
$headerPanel.Controls.Add($subtitleLabel)

$script:StatusPicture = [System.Windows.Forms.PictureBox]::new()
$script:StatusPicture.Location = [System.Drawing.Point]::new(22, 76)
$script:StatusPicture.Size = [System.Drawing.Size]::new(24, 24)
$headerPanel.Controls.Add($script:StatusPicture)

$script:StatusLabel = [System.Windows.Forms.Label]::new()
$script:StatusLabel.Location = [System.Drawing.Point]::new(50, 73)
$script:StatusLabel.Size = [System.Drawing.Size]::new(285, 26)
$script:StatusLabel.Font = [System.Drawing.Font]::new('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
$script:StatusLabel.ForeColor = [System.Drawing.Color]::FromArgb(39, 48, 64)
$script:StatusLabel.BackColor = [System.Drawing.Color]::Transparent
$script:StatusLabel.Text = 'Checking status...'
$headerPanel.Controls.Add($script:StatusLabel)

$script:StatusPill = [System.Windows.Forms.Label]::new()
$script:StatusPill.Location = [System.Drawing.Point]::new(350, 22)
$script:StatusPill.Size = [System.Drawing.Size]::new(110, 26)
$script:StatusPill.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
$script:StatusPill.Font = [System.Drawing.Font]::new('Segoe UI', 8, [System.Drawing.FontStyle]::Bold)
$script:StatusPill.ForeColor = [System.Drawing.Color]::White
$script:StatusPill.BackColor = [System.Drawing.Color]::FromArgb(115, 124, 139)
$script:StatusPill.Text = 'CHECKING'
$headerPanel.Controls.Add($script:StatusPill)

$detailsPanel = New-CardPanel -X 18 -Y 136 -Width 486 -Height 154
$script:Form.Controls.Add($detailsPanel)

$detailsTitle = New-UiLabel -Text 'Runtime status' -X 18 -Y 14 -Width 180 -Height 24 -Size 10 -Style ([System.Drawing.FontStyle]::Bold)
$detailsPanel.Controls.Add($detailsTitle)

$labels = @(
    @('WSL Ubuntu', 'WslValue'),
    @('Dashboard', 'DashboardValue'),
    @('Gateway', 'GatewayValue'),
    @('Codex auth', 'AuthValue'),
    @('Checked at', 'CheckedValue')
)

$y = 44
foreach ($row in $labels) {
    $label = New-UiLabel -Text $row[0] -X 22 -Y $y -Width 130 -Height 22 -Size 9 -Color ([System.Drawing.Color]::FromArgb(95, 105, 120))
    $detailsPanel.Controls.Add($label)

    $value = [System.Windows.Forms.Label]::new()
    $value.Location = [System.Drawing.Point]::new(170, $y)
    $value.Size = [System.Drawing.Size]::new(285, 22)
    $value.Text = '-'
    $value.Font = [System.Drawing.Font]::new('Segoe UI', 9, [System.Drawing.FontStyle]::Bold)
    $value.ForeColor = [System.Drawing.Color]::FromArgb(39, 48, 64)
    $value.BackColor = [System.Drawing.Color]::Transparent
    Set-Variable -Name $row[1] -Scope Script -Value $value
    $detailsPanel.Controls.Add($value)
    $y += 22
}

$actionsPanel = New-CardPanel -X 18 -Y 304 -Width 486 -Height 78
$script:Form.Controls.Add($actionsPanel)

$script:Progress = [System.Windows.Forms.ProgressBar]::new()
$script:Progress.Location = [System.Drawing.Point]::new(18, 14)
$script:Progress.Size = [System.Drawing.Size]::new(450, 8)
$actionsPanel.Controls.Add($script:Progress)

$script:StartButton = [System.Windows.Forms.Button]::new()
$script:StartButton.Location = [System.Drawing.Point]::new(18, 34)
$script:StartButton.Size = [System.Drawing.Size]::new(96, 30)
$script:StartButton.Text = 'Start'
Set-ActionButtonStyle -Button $script:StartButton -BackColor ([System.Drawing.Color]::FromArgb(35, 160, 80)) -ForeColor ([System.Drawing.Color]::White)
$script:StartButton.Add_Click({ Start-HermesLab })
$actionsPanel.Controls.Add($script:StartButton)

$script:StopButton = [System.Windows.Forms.Button]::new()
$script:StopButton.Location = [System.Drawing.Point]::new(124, 34)
$script:StopButton.Size = [System.Drawing.Size]::new(96, 30)
$script:StopButton.Text = 'Stop'
Set-ActionButtonStyle -Button $script:StopButton -BackColor ([System.Drawing.Color]::FromArgb(180, 60, 60)) -ForeColor ([System.Drawing.Color]::White)
$script:StopButton.Add_Click({ Stop-HermesLab })
$actionsPanel.Controls.Add($script:StopButton)

$script:OpenButton = [System.Windows.Forms.Button]::new()
$script:OpenButton.Location = [System.Drawing.Point]::new(230, 34)
$script:OpenButton.Size = [System.Drawing.Size]::new(116, 30)
$script:OpenButton.Text = 'Dashboard'
Set-ActionButtonStyle -Button $script:OpenButton -BackColor ([System.Drawing.Color]::FromArgb(42, 102, 190)) -ForeColor ([System.Drawing.Color]::White)
$script:OpenButton.Add_Click({ Open-Dashboard })
$actionsPanel.Controls.Add($script:OpenButton)

$script:RefreshButton = [System.Windows.Forms.Button]::new()
$script:RefreshButton.Location = [System.Drawing.Point]::new(356, 34)
$script:RefreshButton.Size = [System.Drawing.Size]::new(112, 30)
$script:RefreshButton.Text = 'Refresh'
Set-ActionButtonStyle -Button $script:RefreshButton -BackColor ([System.Drawing.Color]::FromArgb(229, 234, 241)) -ForeColor ([System.Drawing.Color]::FromArgb(39, 48, 64))
$script:RefreshButton.Add_Click({ Update-Status })
$actionsPanel.Controls.Add($script:RefreshButton)

$footer = New-UiLabel -Text 'Local only: 127.0.0.1:9119. Close hides to tray.' -X 24 -Y 389 -Width 470 -Height 22 -Size 8 -Color ([System.Drawing.Color]::FromArgb(115, 124, 139))
$script:Form.Controls.Add($footer)

$script:NotifyIcon = [System.Windows.Forms.NotifyIcon]::new()
$script:NotifyIcon.Icon = [System.Drawing.SystemIcons]::Application
$script:NotifyIcon.Visible = $true
$script:NotifyIcon.Text = 'Hermes Lab'

$menu = [System.Windows.Forms.ContextMenuStrip]::new()
[void]$menu.Items.Add('Open', $null, { $script:Form.Show(); $script:Form.WindowState = 'Normal'; $script:Form.Activate() })
[void]$menu.Items.Add('Start Hermes', $null, { Start-HermesLab })
[void]$menu.Items.Add('Stop Hermes', $null, { Stop-HermesLab })
[void]$menu.Items.Add('Open Dashboard', $null, { Open-Dashboard })
[void]$menu.Items.Add('Open Lab Folder', $null, { Open-LabFolder })
[void]$menu.Items.Add('Exit Controller', $null, {
    $script:ExitRequested = $true
    $script:NotifyIcon.Visible = $false
    $script:Form.Close()
})
$script:NotifyIcon.ContextMenuStrip = $menu
$script:NotifyIcon.Add_DoubleClick({ $script:Form.Show(); $script:Form.WindowState = 'Normal'; $script:Form.Activate() })

$timer = [System.Windows.Forms.Timer]::new()
$timer.Interval = $script:Config.RefreshSeconds * 1000
$timer.Add_Tick({ Update-Status })

$script:Form.Add_Shown({
    Update-Status
    $timer.Start()
    if ($StartMinimized) {
        $script:Form.WindowState = 'Minimized'
        $script:Form.Hide()
    }
})

$script:Form.Add_Resize({
    if ($script:Form.WindowState -eq 'Minimized') {
        $script:Form.Hide()
    }
})

$script:Form.Add_FormClosing({
    if (-not $script:ExitRequested -and $_.CloseReason -eq [System.Windows.Forms.CloseReason]::UserClosing) {
        $_.Cancel = $true
        $script:Form.Hide()
        Show-Balloon 'Hermes Lab' 'Still running in the tray. Use Exit Controller to quit completely.'
    }
})

Set-StatusDot ([System.Drawing.Color]::Gray)
[System.Windows.Forms.Application]::EnableVisualStyles()
[System.Windows.Forms.Application]::Run($script:Form)
