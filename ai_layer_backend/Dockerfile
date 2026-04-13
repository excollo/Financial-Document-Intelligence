# Use Python 3.11 full image (not slim) for OpenCV + Camelot system dependency compatibility
FROM python:3.11-bullseye AS ai-backend

WORKDIR /app

# ✅ System dependencies required for:
# - camelot-py: ghostscript (lattice mode)
# - opencv (cv2): libglib2.0-0, libGL, libgthread-2.0 (via libglib2.0-0)
# - pdf2image: poppler-utils
# - pdfplumber: libxml2, libxslt
# - python-tk: python3-tk
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

# Environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8001

# Install Python requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code
COPY . .

# Expose API port
EXPOSE 8001

# Start command (Uvicorn for FastAPI)
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
