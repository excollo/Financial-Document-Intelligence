# Financial Document Intelligence (FDI) Monorepo

Welcome to the **Financial Document Intelligence** monorepo. This platform is designed to process, analyze, and extract insights from complex financial documents (like RHP/DRHP) using advanced AI/ML models.

## 🏗️ Architecture Overview

The system is architected as a set of decoupled services coordinated through a monorepo structure:

| Service | Technology | Role |
| :--- | :--- | :--- |
| **Frontend** | React + Vite + Tailwind CSS | User interface for document management & AI interaction. |
| **Node Backend** | Node.js + TypeScript + Express | Core API Gateway, authentication, and task orchestration. |
| **AI Layer** | Python + FastAPI + Celery | Heavy processing: ingestion, LLM analysis, and extraction. |
| **Infrastructure** | MongoDB + Redis | Data persistence and message queuing for background tasks. |

---

## 🚀 Getting Started

### Prerequisites
*   [Docker](https://www.docker.com/get-started) & [Docker Compose](https://docs.docker.com/compose/install/)
*   Git

### Quick Start (Local Development)
Run the entire platform with a single command:
```bash
docker-compose up --build
```
This will start:
*   **Frontend**: [http://localhost](http://localhost)
*   **Node API**: [http://localhost:5000](http://localhost:5000)
*   **AI Service**: [http://localhost:8000](http://localhost:8000)
*   **MongoDB**: `mongodb://localhost:27017`
*   **Redis**: `redis://localhost:6379`

---

## 🛠️ Development Guide

### Monorepo Structure
```text
.
├── ai_layer_backend/   # Python/FastAPI AI Processing Service
├── frontend/           # React/Vite Frontend Application
├── node_backend/       # Core Node.js/TS Backend API
├── Dockerfile          # Unified multi-stage Dockerfile
├── docker-compose.yml  # Root orchestration
└── .github/workflows/  # CI/CD Pipeline (GitHub Actions)
```

### Running Tests
We use a unified testing approach via Docker stages:

```bash
# Test Frontend
docker build --target frontend-test .

# Test Node Backend
docker build --target node-backend-test .

# Test AI Backend
docker build --target ai-backend-test .
```

---

## 🔄 CI/CD & Deployment

### Branching Strategy
*   **`main`**: Production-ready code.
*   **`develop`**: Integration branch for new features.
*   **`sandbox`**: Experimental features and testing environment.

### Pipeline
Every push to the branches above triggers the **GitHub Actions CI/CD Pipeline**, which:
1.  Sets up a secure build environment.
2.  Builds all three services using the unified Docker targets.
3.  Verifies the integrity of the build before tagging and deployment.

---

## 📝 Troubleshooting

*   **Permissions**: If you encounter 403 Forbidden errors when pushing to GitHub, ensure your `gh auth` is configured or use a Personal Access Token (PAT).
*   **Docker Issues**: If a service fails to start, check logs using `docker-compose logs <service-name>`.
*   **Database**: Ensure `MONGO_URI` in `.env` or `docker-compose.yml` matches your local environment.

---

**Built with ❤️ for Financial Intelligence.**
