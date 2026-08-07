Option Explicit
Dim shell, appDir, command
Set shell = CreateObject("WScript.Shell")
appDir = "C:\Users\Hojun\Desktop\Bumboo\AGENTS\HermesControlModern"
command = "cmd.exe /c cd /d " & Chr(34) & appDir & Chr(34) & " && " & Chr(34) & appDir & "\Start-HermesControl-Minimized.cmd" & Chr(34)
shell.Run command, 0, False
