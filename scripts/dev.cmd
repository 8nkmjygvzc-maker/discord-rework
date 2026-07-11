@echo off
rem Startet ALLES fuer die lokale Entwicklung mit einem Befehl:
rem shared bauen, Infrastruktur sicherstellen (Docker oder portabel),
rem Migrationen anwenden, dann API + Voice-SFU + Web parallel.
set "PATH=%LOCALAPPDATA%\Programs\nodejs;%PATH%"
cd /d "%~dp0.."
call npm run dev
