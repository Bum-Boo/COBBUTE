# Hermes Lab Controller Modern

Modern Electron + React controller for the local Hermes WSL lab.

## Run

```powershell
.\Start-HermesControl.cmd
```

## Features

- Glass-style status dashboard.
- System tray menu.
- WSL Ubuntu running/stopped status.
- Hermes dashboard online/offline status.
- Hermes Gateway active/inactive status.
- Codex OAuth connection status.
- Start/stop controls.
- Local-only dashboard access at `http://127.0.0.1:9119`.

## Safety

- No public ports.
- No firewall edits.
- No cloud API keys.
- No Codex execution.
- Stop action terminates only the `Ubuntu` WSL distro.
