# ==========================================
# BASE IMAGES
# ==========================================
FROM node:20-alpine AS node-base
WORKDIR /app
RUN apk add --no-cache libc6-compat

FROM python:3.11-slim AS python-base
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# ==========================================
# FRONTEND BUILDER
# ==========================================
FROM node-base AS frontend-builder
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ .
RUN npm run build

# FRONTEND TESTER
FROM node-base AS frontend-test
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ .
ENV CI=true
RUN npm test -- --watchAll=false

# FRONTEND RUNNER (NGINX)
FROM nginx:alpine AS frontend
COPY --from=frontend-builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

# ==========================================
# NODE BACKEND BUILDER
# ==========================================
FROM node-base AS node-backend-builder
COPY node_backend/package*.json ./
RUN npm install
COPY node_backend/ .
RUN npm run build

# NODE BACKEND TESTER
FROM node-base AS node-backend-test
COPY node_backend/package*.json ./
RUN npm install
COPY node_backend/ .
ENV CI=true
RUN npm test

# NODE BACKEND RUNNER
FROM node-base AS node-backend
COPY --from=node-backend-builder /app/dist ./dist
COPY --from=node-backend-builder /app/package*.json ./
RUN npm install --only=production
EXPOSE 5000
CMD ["npm", "start"]

# ==========================================
# AI LAYER BACKEND (PYTHON)
# ==========================================
FROM python:3.11-slim AS ai-backend

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# ✅ FIXED SYSTEM DEPENDENCIES (IMPORTANT)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender1 \
    ghostscript \
    python3-tk \
    libxml2 \
    libxslt1.1 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY ai_layer_backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY ai_layer_backend/ .

# ==========================================
# AI BACKEND TESTER
# ==========================================
FROM ai-backend AS ai-backend-test
RUN pip install pytest pytest-asyncio httpx
RUN pytest tests/

# ==========================================
# FINAL RUNNER (DEFAULT API)
# ==========================================
FROM ai-backend AS final

EXPOSE 8000

# Default API command (ACA overrides for worker)
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
