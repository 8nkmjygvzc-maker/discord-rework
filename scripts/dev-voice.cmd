@echo off
rem Startet den Voice-SFU (mediasoup) im Watch-Modus. Stellt sicher, dass Node
rem im PATH ist, auch wenn das aufrufende Programm den Benutzer-PATH nicht kennt.
set "PATH=%LOCALAPPDATA%\Programs\nodejs;%PATH%"
cd /d "%~dp0.."
call npm run dev -w @parley/voice
