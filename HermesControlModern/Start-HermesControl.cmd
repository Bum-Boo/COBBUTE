@echo off
setlocal
set "APP_DIR=%~dp0"
cd /d "%APP_DIR%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "$root=(Resolve-Path $env:APP_DIR).Path.TrimEnd('\\'); Start-Process npm.cmd -ArgumentList 'start' -WorkingDirectory $root -WindowStyle Hidden"
