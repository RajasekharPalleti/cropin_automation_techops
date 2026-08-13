@echo off
title Cropin Server Auto-Start Setup
echo ========================================================
echo Cropin Server - Windows Auto-Start Setup
echo ========================================================
echo.
echo This script will add the Cropin Server and Ngrok to your
echo Windows Startup folder so they automatically launch
echo whenever you turn on or restart your computer.
echo.
pause

set STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set PROJECT_DIR=%~dp0

echo.
echo [1/2] Creating shortcut for Server...
powershell "$s=(New-Object -COM WScript.Shell).CreateShortcut('%STARTUP_DIR%\CropinServer.lnk'); $s.TargetPath='%PROJECT_DIR%batch_scripts\run_server.bat'; $s.WorkingDirectory='%PROJECT_DIR%'; $s.Save()"

echo [2/2] Creating shortcut for Ngrok...
powershell "$s=(New-Object -COM WScript.Shell).CreateShortcut('%STARTUP_DIR%\CropinNgrok.lnk'); $s.TargetPath='%PROJECT_DIR%batch_scripts\run_ngrok.bat'; $s.WorkingDirectory='%PROJECT_DIR%'; $s.Save()"

echo.
echo SUCCESS! 
echo The server and Ngrok will now start automatically in the background 
echo whenever Windows boots up.
echo.
echo (You can check the Startup folder by pressing Win+R and typing shell:startup)
echo.
pause
