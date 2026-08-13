:<<"::WINDOWS_ONLY"
@echo off
goto :WINDOWS
::WINDOWS_ONLY

# Mac/Linux script
echo -ne "\033]0;CROPIN_NGROK\007"
echo "Initializing Remote Tunnel..."
echo ""
echo "The public URL will appear below."
echo "Keep this window OPEN to maintain remote access."
echo ""
cd "$(dirname "$0")/.."
PORT=$(grep "SERVER_PORT" app/script_configs.py | cut -d'=' -f2 | tr -d ' ')
if [ -z "$PORT" ]; then PORT=4444; fi
ngrok http $PORT
read -p "Press any key to close..."
exit 0

:WINDOWS
@echo off
title CROPIN_NGROK
echo Initializing Remote Tunnel...
echo.
echo The public URL will appear below.
echo Keep this window OPEN to maintain remote access.
echo.
pushd %~dp0\..\
for /f "tokens=2 delims==" %%I in ('findstr "SERVER_PORT" app\script_configs.py') do set PORT=%%I
set PORT=%PORT: =%
if "%PORT%"=="" set PORT=4444
ngrok http %PORT%
popd
if "%~1"=="--no-pause" exit /b
pause
