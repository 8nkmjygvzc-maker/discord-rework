@echo off
rem Startet den Web-Dev-Server (Vite). Stellt sicher, dass Node im PATH ist,
rem auch wenn das aufrufende Programm den Benutzer-PATH noch nicht kennt.
set "PATH=%LOCALAPPDATA%\Programs\nodejs;%PATH%"
cd /d "%~dp0.."
call npm run dev -w @parley/web
