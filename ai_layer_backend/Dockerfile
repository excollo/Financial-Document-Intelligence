# Use Python 3.11 slim base image
FROM python:3.11-slim AS ai-backend

WORKDIR /app

# System dependencies for OpenCV, Camelot, and Ghostscript
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    ghostscript \
    python3-tk \
    && rm -rf /var/lib/apt/lists/*

# Environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8001

# Install requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code
COPY . .

# Expose API port
EXPOSE 8001

# Start command (Uvicorn for FastAPI)
# Use app.main:app because the project structure has an 'app' package
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
