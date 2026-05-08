@echo off
title QA Agent Family — Control Panel
setlocal

set ROOT=%~dp0
:: Strip trailing backslash
if "%ROOT:~-1%"=="\" set ROOT=%ROOT:~0,-1%

cls
echo.
echo  ================================================
echo   QA Agent Family
echo  ================================================
echo.

:: ── Docker check ──────────────────────────────────────────────────
docker info >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Docker Desktop is not running.
    echo  Please start Docker Desktop first and try again.
    pause
    exit /b 1
)

:: ── Write temp launcher scripts (avoids quotes-in-quotes issues) ──
(
    echo @echo off
    echo title QA Agent - Backend
    echo cd /d "%ROOT%"
    echo node dashboard\backend\server.js
) > "%TEMP%\qa_backend.bat"

(
    echo @echo off
    echo title QA Agent - Frontend
    echo cd /d "%ROOT%\dashboard\dashboard-app"
    echo npm run dev
) > "%TEMP%\qa_frontend.bat"

:: ── Qdrant ────────────────────────────────────────────────────────
echo  [1/3] Starting Qdrant...
docker ps --filter "name=qdrant" --filter "status=running" | findstr qdrant >nul 2>&1
if errorlevel 1 (
    docker start qdrant >nul 2>&1
    if errorlevel 1 (
        docker run -d --name qdrant -p 6333:6333 ^
            -v "%ROOT%\artifacts\rag\qdrant_storage:/qdrant/storage" ^
            qdrant/qdrant >nul 2>&1
    )
)
echo        Qdrant  http://localhost:6333

:: ── Backend ───────────────────────────────────────────────────────
echo  [2/3] Starting backend...
start "QA_AGENT_BACKEND" cmd /k "%TEMP%\qa_backend.bat"
timeout /t 2 /nobreak >nul
echo        Backend http://localhost:5000

:: ── Frontend ──────────────────────────────────────────────────────
echo  [3/3] Starting frontend...
start "QA_AGENT_FRONTEND" cmd /k "%TEMP%\qa_frontend.bat"
timeout /t 5 /nobreak >nul
echo        UI      http://localhost:5173

:: ── Open browser ──────────────────────────────────────────────────
start "" "http://localhost:5173"

echo.
echo  ================================================
echo   All services are running.
echo.
echo   Press any key to STOP everything and exit.
echo  ================================================
echo.
pause >nul

:: ── Shutdown ──────────────────────────────────────────────────────
echo.
echo  Stopping all services...

taskkill /FI "WINDOWTITLE eq QA_AGENT_BACKEND" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq QA_AGENT_FRONTEND" /T /F >nul 2>&1

:: Belt-and-suspenders: kill any leftover node on port 5000 / vite on 5173
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":5000 "') do taskkill /PID %%p /F >nul 2>&1
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":5173 "') do taskkill /PID %%p /F >nul 2>&1

docker stop qdrant >nul 2>&1
echo        Qdrant stopped.

del "%TEMP%\qa_backend.bat" >nul 2>&1
del "%TEMP%\qa_frontend.bat" >nul 2>&1

echo.
echo  All stopped. Goodbye.
timeout /t 2 /nobreak >nul
