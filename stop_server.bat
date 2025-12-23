@echo off
echo Stopping Server on port 4444...
for /f "tokens=5" %%a in ('netstat -aon ^| find ":4444" ^| find "LISTENING"') do taskkill /f /pid %%a
echo Server stopped.
pause
