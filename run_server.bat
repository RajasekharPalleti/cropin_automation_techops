:<<"::WINDOWS_ONLY"
@echo off
goto :WINDOWS
::WINDOWS_ONLY

# Mac/Linux script
echo "Starting Cropin Automation Server..."
echo "Open http://127.0.0.1:4444 in your browser."
python3 -m app.main
read -p "Press any key to close..."
exit 0

:WINDOWS
echo Starting Cropin Automation Server...
echo Open http://127.0.0.1:4444 in your browser.
python -m app.main
pause
