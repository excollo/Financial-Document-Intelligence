@echo off
echo Starting AI Python Platform Services...

:: 1. Check/Start Redis
echo Checking for Redis...
redis-cli ping >nul 2>&1
if %errorlevel% equ 0 (
    echo Redis is running.
) else (
    echo Redis is NOT running. Attempting to start...
    net start Redis
    if %errorlevel% neq 0 (
        echo Could not start Redis service automatically.
        echo Please ensure Redis is installed and running.
    ) else (
        echo Redis started successfully.
    )
)

:: 2. Activate Virtual Environment
if exist "venv\Scripts\activate.bat" (
    echo Activating Virtual Environment...
    call venv\Scripts\activate.bat
) else (
    echo Warning: Virtual environment not found at venv.
)

:: 3. Start Celery Worker (in new window)
echo Starting Celery Worker...
start "Celery Worker" cmd /k "python -m celery -A app.workers.celery_app worker --loglevel=info --pool=solo"

:: 4. Start FastAPI Server
echo Starting FastAPI Server...
python -m app.main
