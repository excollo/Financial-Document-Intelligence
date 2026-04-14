# Production Worker Dockerfile
# Optimized for high-fidelity document processing (Ghostscript, Poppler, OpenCV)
FROM python:3.11-bullseye

# Set working directory
WORKDIR /app

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    C_FORCE_ROOT=true

# ✅ Install system dependencies 
# Critical for document AI (Camelot, pdf2image, OpenCV)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgtk-3-0 \
    ghostscript \
    poppler-utils \
    python3-tk \
    libxml2-dev \
    libxslt1-dev \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Python requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ✅ Copy ALL source code 
# This ensures package structure (app.*) and .env paths remain consistent with API
COPY . .

# Recommended: Run as root for Azure App Service stability 
# or ensure non-root has explicit permissions to /app
# USER 1000

# Default Celery startup command
# Note: In production, it is recommended to override this in Azure App Service 
# Startup Command settings to use --pool=solo for better CPU/Memory stability.
CMD ["celery", "-A", "app.workers.celery_app", "worker", "--loglevel=info", "--pool=solo", "--concurrency=1"]
