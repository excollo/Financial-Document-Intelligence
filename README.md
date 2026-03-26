# Financial Document Intelligence (FDI) Monorepo

The **Financial Document Intelligence** platform is an enterprise-grade solution for analyzing and extracting tabular and unstructured data from sensitive financial documents (like RHP, DRHP, Investment Reports). It leverages high-fidelity AI models, OCR, and a robust microservices architecture.

---

## 🏗️ Monorepo Architecture

This project is structured as a monorepo containing three core services and a shared infrastructure layer:

| Service | Technology | Core Responsibility |
| :--- | :--- | :--- |
| [**Frontend**](./frontend) | React + Vite + Tailwind CSS | Interactive UI, Document visualization, Chat interfaces. |
| [**Node Backend**](./node_backend) | Node.js + TypeScript + Express | API Gateway, Auth, Document metadata management, Orchestration. |
| [**AI Layer Service**](./ai_layer_backend) | Python + FastAPI + Celery | High-performance AI processing, PDF Parsing, OCR, and Ingestion. |
| **Infrastructure** | MongoDB + Redis | Data persistence and asynchronous task queuing. |

---

## 📂 Detailed Service Descriptions

### 1. Frontend ([./frontend](./frontend))
A high-performance search and analysis interface built with React.
*   **Key Features**:
    *   **Document Workspace**: Manage folders, directories, and document uploads.
    *   **AI Chat Panel**: Context-aware chat with financial documents using vector embeddings.
    *   **Multi-tenant Dashboard**: Support for multiple domains and team collaboration.
    *   **Admin Tools**: System health monitoring and user management.
*   **Tech Stack**: Vite, TypeScript, Tailwind CSS, shadcn/ui.

### 2. Node Backend ([./node_backend](./node_backend))
The central brain of the platform handling business logic and authorization.
*   **Key Features**:
    *   **Authentication & RBAC**: Secure login with JWT and workspace-level permissions.
    *   **Document Management**: CRUD operations for documents, directories, and shares.
    *   **Task Orchestration**: Communicates with the AI Layer via REST and message hooks.
    *   **Data Models**: Includes User, Workspace, Document, Summary, Job, and NewsArticle.
*   **Tech Stack**: Node.js, TypeScript, Express, Mongoose (MongoDB).

### 3. AI Layer Backend ([./ai_layer_backend](./ai_layer_backend))
The computational engine focused on complex data extraction.
*   **Key Features**:
    *   **Document Ingestion**: Advanced PDF parsing (Camelot, pdfplumber, pdf2image).
    *   **LLM Engine**: Integration with OpenAI, Google Gemini, and Cohere.
    *   **Background Tasks**: Long-running AI jobs managed via Celery and Redis.
    *   **OCR & Table Extraction**: Specialized processing for high-fidelity table recovery.
*   **Tech Stack**: Python 3.11+, FastAPI, Celery, Pytorch/Numpy, LangChain.

---

## 🚀 Development & Deployment

### Unified Quick Start
Using the root-level orchestration, you can start the entire stack in seconds:
```bash
docker-compose up --build
```

### Local Environment Configuration
Each service uses its own `.env` file for configuration. Standard keys include:
*   `MONGO_URI`: Connection string for MongoDB.
*   `REDIS_URL`: Connection string for Redis broker.
*   `OPENAI_API_KEY`, `GEMINI_API_KEY`: Keys for AI services.
*   `AI_SERVICE_URL`: URL where the Node service can find the Python backend.

---

## 🧪 Testing
The monorepo includes automated testing at every level:

| Service | Test Command (Local) | Docker Target Stage |
| :--- | :--- | :--- |
| **Frontend** | `npm test` | `frontend-test` |
| **Node Backend** | `npm test` | `node-backend-test` |
| **AI Backend** | `pytest` | `ai-backend-test` |

---

## 🔄 CI/CD Pipeline
Every push to `main`, `develop`, or `sandbox` triggers a GitHub Action that builds and verifies all three services. The pipeline configuration is located in [`.github/workflows/ci-cd.yml`](./.github/workflows/ci-cd.yml).

### Branching Guide:
- **`main`**: Production deployments.
- **`develop`**: Daily development and staging.
- **`sandbox`**: Testing and experimental features.

---

**Built with ❤️ by the FDI Team.**
