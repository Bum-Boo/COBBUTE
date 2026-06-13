# Hermes Lab Controller

Small Windows tray GUI for the local Hermes/WSL lab.

## Features

- Shows WSL Ubuntu running state.
- Shows Hermes dashboard state.
- Shows Hermes Gateway state.
- Shows OpenAI Codex OAuth connection state.
- Starts Hermes dashboard through the existing scheduled task.
- Stops Hermes dashboard/Gateway and terminates only the Ubuntu WSL distro.
- Sends tray notifications when Hermes becomes connected or disconnected.

## Run

```powershell
.\Start-HermesControl.cmd
```

Startup shortcut:

```text
%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Hermes Lab Controller.lnk
```

Desktop shortcut:

```text
%USERPROFILE%\Desktop\Hermes Lab Controller.lnk
```

Optional environment overrides:

```text
HERMES_WSL_DISTRO=Ubuntu
HERMES_LAB_ROOT=$HOME/hermes-lab
HERMES_HOME=$HOME/hermes-lab/.hermes
HERMES_DASHBOARD_URL=http://127.0.0.1:9119
HERMES_DASHBOARD_TASK_NAME=Hermes Dashboard 9119
```

## Buttons

- `Start`: starts WSL Ubuntu and Hermes dashboard through the existing scheduled task.
- `Stop`: stops Hermes dashboard/Gateway, then terminates only the Ubuntu WSL distro.
- `Dashboard`: opens the dashboard URL.
- `Refresh`: refreshes current status.

Close button hides the window to the tray. Use tray menu `Exit Controller` to quit the controller itself.

Dashboard URL:

```text
http://127.0.0.1:9119
```

## Safety

- Does not open public ports.
- Does not modify Windows firewall.
- Does not add API keys.
- Does not run Codex.
- Stops only the `Ubuntu` WSL distro, not all WSL distributions.
