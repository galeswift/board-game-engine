@echo off
REM Starts patchwork's local Postgres (docker-compose.yml) for running the
REM app or the test suite locally - see README.md's "Running locally" /
REM "Testing" sections. Waits until Postgres is actually accepting
REM connections, not just until the container reports "running" (there's a
REM real gap between the two right after a fresh start).

cd /d "%~dp0"

echo Starting patchwork's Postgres container...
docker compose up -d
if errorlevel 1 (
  echo docker compose up failed - is Docker Desktop running?
  exit /b 1
)

echo Waiting for Postgres to accept connections...
:wait
powershell -NoProfile -Command "try { (New-Object Net.Sockets.TcpClient('localhost', 5433)).Close(); exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
  timeout /t 1 /nobreak >nul
  goto wait
)

echo Postgres is up on localhost:5433.
echo Next: npm start  (or npm test)
