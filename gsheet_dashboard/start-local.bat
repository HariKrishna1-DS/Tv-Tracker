@echo off
setlocal
cd /d "%~dp0"
set "DASHBOARD_URL=http://127.0.0.1:8510"
powershell.exe -NoProfile -Command "try { $health = Invoke-RestMethod ($env:DASHBOARD_URL + '/api/health') -TimeoutSec 2 -ErrorAction Stop; $page = Invoke-WebRequest $env:DASHBOARD_URL -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop; if ($health.ready -eq $true -and $health.desktop -eq $false -and $page.Content -match '<title>Tv Tracker</title>') { exit 0 } } catch {}; exit 1"
if not errorlevel 1 (
    echo DataTrace Workspace: %DASHBOARD_URL%
    start "" "%DASHBOARD_URL%"
    exit /b 0
)
if not exist "..\.venv\Scripts\python.exe" (
    echo Run run.bat once to install the local application dependencies.
    pause
    exit /b 1
)
set "DATATRACE_DESKTOP="
set "DATATRACE_DESKTOP_TOKEN="
"..\.venv\Scripts\python.exe" server.py --host 127.0.0.1 --port 8510 --strict-port --open-browser
exit /b %errorlevel%
