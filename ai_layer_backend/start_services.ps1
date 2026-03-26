# Startup Script for AI Python Platform (Windows)

Write-Host "Starting AI Python Platform Services..." -ForegroundColor Cyan

# 1. Check for Redis
Write-Host "Checking for Redis..." -ForegroundColor Yellow
$redisRunning = $false
try {
    # Try to ping local redis
    $ping = redis-cli ping
    if ($ping -eq "PONG") {
        Write-Host "Redis is already running." -ForegroundColor Green
        $redisRunning = $true
    }
} catch {
    # Redis-cli might not be in path
}

if (-not $redisRunning) {
    Write-Host "Redis does not appear to be running." -ForegroundColor Red
    Write-Host "Attempting to start default Redis service (if installed)..."
    try {
        Start-Service -Name "Redis" -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
        if ((Get-Service "Redis").Status -eq "Running") {
             Write-Host "Redis Service Started." -ForegroundColor Green
        } else {
             Write-Host "Could not start Redis Service. Please ensure Redis is installed and running manually." -ForegroundColor Red
             Write-Host "Download Redis for Windows here: https://github.com/microsoftarchive/redis/releases" -ForegroundColor Gray
        }
    } catch {
        Write-Host "Could not find Redis service." -ForegroundColor Red
    }
}

# 2. Check Virtual Environment
if (Test-Path ".\venv\Scripts\activate.ps1") {
    Write-Host "Activating Virtual Environment..." -ForegroundColor Green
    . .\venv\Scripts\activate.ps1
} else {
    Write-Host "Warning: Virtual environment not found at .\venv." -ForegroundColor Yellow
}

# 3. Start Celery Worker (Background Update)
Write-Host "Starting Celery Worker..." -ForegroundColor Cyan
# Using python -m celery to avoid path issues
Start-Process -FilePath "powershell" -ArgumentList "-NoExit", "-Command", "python -m celery -A app.workers.celery_app worker --loglevel=info --pool=solo"
Write-Host "Celery Worker process launched in new window." -ForegroundColor Green

# 4. Start FastAPI Backend (Foreaound)
Write-Host "Starting FastAPI Server..." -ForegroundColor Cyan
python -m app.main
