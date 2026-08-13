#!/bin/bash

# Default to port 4444 if PORT is not set
echo -ne "\033]0;RAILWAY_SERVER\007"
PORT="${PORT:-4444}"

# --- Render Secret Files Workaround ---
# Render mounts secret files into /etc/secrets. 
# We need to copy them to the local folders where the app expects them.
mkdir -p json_config
cp /etc/secrets/weekly_report_config.json json_config/ 2>/dev/null || true
cp /etc/secrets/scheduled_jobs.json ./ 2>/dev/null || true
# --------------------------------------

echo "Starting app on port $PORT..."
exec uvicorn app.main:app --host 0.0.0.0 --port "$PORT"
