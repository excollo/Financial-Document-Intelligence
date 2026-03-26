# AI Python Platform 🚀

Production-ready Python AI execution layer that replaces n8n workflows. This platform is designed to be called by an existing Node.js backend and runs scalable AI pipelines for documents, news, and summaries.

## 📋 Overview

The AI Python Platform is a high-fidelity **AI Intelligence Layer** that processes complex financial documents (DRHPs/RHPs). It operates as a FastAPI-based microservice, handling workloads asynchronously via a **task-distributed system** (Celery + Redis).

### Key Features

- ✅ **4-Agent Pipeline**: Sophisticated multi-agent flow (Extraction → Valuation → Synthesis → Validation).
- ✅ **Financial Precision**: Specialized Python logic for decimal math and dilution analysis.
- ✅ **Domain-Aware RAG**: Fund-specific SOPs and checklists integrated into the AI generation.
- ✅ **Async Task Queue**: Handles long-running summarization (2-5 mins) without blocking APIs.
- ✅ **Structured Logging**: JSON-based logs with full job tracking for observability.

### 🏗️ Architecture & Request Flow

1. **Submission**: Node.js backend POSTs a job to `/jobs/summary` or `/jobs/comparison`.
2. **Queuing**: FastAPI enqueues the task in **Redis** and returns a `job_id` (HTTP 202).
3. **Execution**: A **Celery Worker** picks up the task and runs the 4-Agent Pipeline:
   - **Agent 1 (Extraction)**: High-precision table and text parsing.
   - **Agent 2 (Valuation)**: Calculation of premium rounds and investment math.
   - **Agent 3 (Synthesis)**: Content generation using project-specific SOPs.
   - **Agent 4 (Validation)**: Automated consistency and compliance checking.
4. **Persistence**: The worker updates the status in **MongoDB** and notifies the Node.js backend.
5. **Polling**: The Node.js backend polls `GET /jobs/{job_id}` for the final result.

---

## 📁 Project Structure

```
ai-python-platform/
├── app/
│   ├── main.py                  # FastAPI entrypoint
│   │
│   ├── api/
│   │   └── jobs.py               # Job intake endpoints
│   │
│   ├── workers/
│   │   ├── celery_app.py         # Celery configuration
│   │   └── document_pipeline.py  # AI pipeline tasks
│   │
│   ├── services/
│   │   ├── extraction.py         # Text extraction
│   │   ├── chunking.py           # Text chunking
│   │   └── embedding.py          # Vector embeddings
│   │
│   ├── core/
│   │   ├── config.py             # Environment config
│   │   └── logging.py            # Structured logging
│   │
│   └── db/
│       └── mongo.py              # MongoDB connection
│
├── docker/
│   ├── api.Dockerfile            # API container
│   └── worker.Dockerfile         # Worker container
│
├── requirements.txt
├── .env.example
└── README.md
```

## 🚀 Getting Started

### Prerequisites

- Python 3.11+
- Redis
- MongoDB
- (Optional) Docker

### Local Setup

1. **Clone and navigate to project**
   ```bash
   cd ai-python-platform
   ```

2. **Create virtual environment**
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

4. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your settings
   ```

5. **Start Redis** (if not running)
   ```bash
   redis-server
   ```

6. **Start MongoDB** (if not running)
   ```bash
   mongod
   ```

### Running the Application

#### Option 1: Local Development

**Terminal 1 - Start API**
```bash
python3 -m app.main
# API available at http://localhost:8000
```

**Terminal 2 - Start Celery Worker**
```bash
celery -A app.workers.celery_app worker --loglevel=info
```

#### Option 2: Docker

**Build images**
```bash
docker build -f docker/api.Dockerfile -t ai-platform-api .
docker build -f docker/worker.Dockerfile -t ai-platform-worker .
```

**Run with docker-compose** (create docker-compose.yml first)
```bash
docker-compose up
```

## 🔌 API Endpoints

### Health Check
```http
GET /health
```

**Response:**
```json
{
  "status": "healthy",
  "environment": "sandbox",
  "version": "1.0.0"
}
```

### Submit Document Job
```http
POST /jobs/document
Content-Type: application/json

{
  "file_url": "https://example.com/document.pdf",
  "file_type": "pdf",
  "metadata": {
    "source": "user_upload"
  }
}
```

**Response (HTTP 202):**
```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "accepted",
  "message": "Document processing job enqueued successfully"
}
```

### Submit News Job
```http
POST /jobs/news
Content-Type: application/json

{
  "article_url": "https://example.com/article",
  "metadata": {}
}
```

### Submit Summary Job
```http
POST /jobs/summary
Content-Type: application/json

{
  "text": "Long text to summarize...",
  "summary_type": "brief"
}
```

### Check Job Status
```http
GET /jobs/{job_id}
```

**Response:**
```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "state": "SUCCESS",
  "result": {
    "chunk_count": 5,
    "char_count": 1234,
    "execution_time": 2.5
  }
}
```

## 🔧 Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `APP_ENV` | Environment (sandbox/dev/prod) | `sandbox` |
| `DEBUG` | Debug mode | `false` |
| `API_PORT` | API port | `8000` |
| `REDIS_HOST` | Redis host | `localhost` |
| `REDIS_PORT` | Redis port | `6379` |
| `MONGO_URI` | MongoDB connection string | `mongodb://localhost:27017` |
| `LOG_LEVEL` | Logging level | `INFO` |

See `.env.example` for complete configuration.

## 📊 Logging

All logs are structured JSON with the following fields:

```json
{
  "timestamp": "2024-01-15T10:30:00Z",
  "level": "info",
  "event": "job_start",
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "pipeline": "document_pipeline",
  "environment": "prod",
  "execution_time": 2.5
}
```

## 🐳 Docker Deployment

### Build for Production
```bash
docker build -f docker/api.Dockerfile -t ai-platform-api:latest .
docker build -f docker/worker.Dockerfile -t ai-platform-worker:latest .
```

### Push to Registry
```bash
docker tag ai-platform-api:latest <registry>/ai-platform-api:latest
docker push <registry>/ai-platform-api:latest

docker tag ai-platform-worker:latest <registry>/ai-platform-worker:latest
docker push <registry>/ai-platform-worker:latest
```

## ☁️ Azure Container Apps Deployment

1. **Create Azure resources**
   - Container Apps Environment
   - Redis Cache
   - CosmosDB (MongoDB API) or MongoDB Atlas

2. **Configure environment variables** in Azure Container Apps

3. **Deploy API container**
   ```bash
   az containerapp create \
     --name ai-platform-api \
     --resource-group <rg> \
     --environment <env> \
     --image <registry>/ai-platform-api:latest \
     --target-port 8000 \
     --ingress external
   ```

4. **Deploy Worker container**
   ```bash
   az containerapp create \
     --name ai-platform-worker \
     --resource-group <rg> \
     --environment <env> \
     --image <registry>/ai-platform-worker:latest \
     --ingress internal
   ```

## 🔄 Celery Worker Management

### Start Worker
```bash
celery -A app.workers.celery_app worker --loglevel=info
```

### Monitor Tasks
```bash
celery -A app.workers.celery_app events
```

### Purge Queue (Development only)
```bash
celery -A app.workers.celery_app purge
```

## 🧪 Testing

From your Node.js backend:

```javascript
const response = await fetch('http://localhost:8000/jobs/document', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    file_url: 'https://example.com/doc.pdf',
    file_type: 'pdf'
  })
});

const { job_id } = await response.json();

// Poll for result
const statusResponse = await fetch(`http://localhost:8000/jobs/${job_id}`);
const status = await statusResponse.json();
```

## 📝 Development Workflow

1. **Make code changes** in `app/`
2. **Test locally** with hot reload (DEBUG=true)
3. **Commit changes** to Git
4. **Build Docker images** for deployment
5. **Deploy to environment** (sandbox → dev → prod)

## 🛠️ Troubleshooting

### Workers not processing tasks
- Check Redis connection
- Verify Celery broker URL
- Check worker logs

### API not responding
- Check FastAPI logs
- Verify port 8000 is not in use
- Check MongoDB connection

### MongoDB connection failed
- Ensure MongoDB is running
- Check `MONGO_URI` configuration
- Verify network connectivity

## 📚 Next Steps

- [ ] Implement actual AI models (embeddings, summarization)
- [ ] Add authentication/API keys for Node.js backend
- [ ] Set up monitoring (Prometheus, Grafana)
- [ ] Add rate limiting
- [ ] Implement result webhooks
- [ ] Add comprehensive tests

## 📄 License

Proprietary - Internal Use Only

---

**Built with ❤️ for scalable AI workloads**