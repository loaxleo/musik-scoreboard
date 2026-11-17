@echo off
rem Richtet sync.py so ein, dass es bei jedem Windows-Login unsichtbar startet, und startet es sofort.
cd /d "%~dp0"

set "PYW="
for /f "delims=" %%P in ('where pythonw 2^>nul') do if not defined PYW set "PYW=%%P"
if not defined PYW (
  echo pythonw.exe wurde nicht gefunden. Ist Python installiert?
  pause
  exit /b 1
)

rem Laufende Instanzen beenden, damit nicht zwei gleichzeitig pushen
taskkill /f /im pythonw.exe >nul 2>&1

set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "VBS=%STARTUP%\musik-scoreboard-sync.vbs"
> "%VBS%" echo CreateObject("WScript.Shell"^).Run """%PYW%"" ""%~dp0sync.py""", 0, False

start "" "%PYW%" "%~dp0sync.py"

echo.
echo Fertig. sync.py laeuft jetzt unsichtbar im Hintergrund
echo und startet ab sofort bei jedem Login automatisch.
echo Protokoll: %~dp0sync.log
echo.
pause
