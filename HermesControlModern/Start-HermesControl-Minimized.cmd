@echo off
setlocal
set "APP_DIR=%~dp0"
cd /d "%APP_DIR%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "$root=(Resolve-Path $env:APP_DIR).Path.TrimEnd('\'); $existing=Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'electron.exe' -and $_.CommandLine -and $_.CommandLine.Contains($root) }; if ($existing) { exit 0 }; Start-Process npm.cmd -ArgumentList 'start -- --minimized' -WorkingDirectory $root -WindowStyle Hidden"
