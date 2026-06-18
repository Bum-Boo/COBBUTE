# AI Framework Controller

Modern Electron + React controller for local Hermes and OpenClaw framework operations.

## Run

```powershell
npm install
.\Start-HermesControl.cmd
```

## First-run connection setup

The controller does **not** assume another user's local directory layout.
On a new computer, open **Settings → Hermes 연결 경로** and save the local values for that machine:

```text
WSL distro: Ubuntu
Hermes Lab Root: /home/<your-wsl-user>/<your-hermes-lab-dir>
Hermes Home: /home/<your-wsl-user>/.hermes
Dashboard URL: http://127.0.0.1:9119
Windows Scheduled Task: Hermes Dashboard 9119
Windows Lab Folder (optional): \\wsl.localhost\Ubuntu\home\<your-wsl-user>\<your-hermes-lab-dir>
```

If your Hermes profile data lives inside a lab checkout, `Hermes Home` may instead be:

```text
/home/<your-wsl-user>/<your-hermes-lab-dir>/.hermes
```

The saved values are stored in Electron `userData/settings.json` on that computer. Environment variables can still prefill defaults for managed installs:

```text
HERMES_WSL_DISTRO
HERMES_LAB_ROOT
HERMES_HOME
HERMES_DASHBOARD_URL
HERMES_DASHBOARD_TASK_NAME
HERMES_LAB_UNC
```

## Features

- Glass-style status dashboard.
- System tray menu.
- WSL distro running/stopped status.
- Hermes dashboard online/offline status.
- Hermes Gateway active/inactive status.
- Codex OAuth connection status.
- Start/stop controls.
- Per-computer Hermes connection settings.
- Local-only dashboard access at `http://127.0.0.1:9119` by default.

## Safety

- No public ports.
- No firewall edits.
- No cloud API keys.
- No Codex execution.
- Stop action terminates only the configured WSL distro, not all WSL distributions.
