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
# Using CI=true to ensure non-interactive test run
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
# Install dependencies for canvas/sharp if needed (omitted for now since not in package.json)
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
FROM python-base AS ai-backend
# System dependencies for camelot/opencv
RUN apt-get update && apt-get install -y \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    ghostscript \
    python3-tk \
    libxml2 \
    libxslt1-dev \
    && rm -rf /var/lib/apt/lists/*

COPY ai_layer_backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY ai_layer_backend/ .

# AI BACKEND TESTER
FROM ai-backend AS ai-backend-test
RUN pip install pytest pytest-asyncio httpx
RUN pytest tests/

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
