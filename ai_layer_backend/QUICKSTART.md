# Quick Start Guide

## 🚀 5-Minute Setup

### 1. Install Dependencies

```bash
# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install Mac/Python 3.14 specific fixes
brew install redis
brew services start redis

# Install packages
pip install -r requirements.txt
```

### 2. Start Infrastructure

**Terminal 1 - API (Synchronous Layer)**
```bash
python3 -m app.main
```

**Terminal 2 - Workers (Asynchronous Layer - News/Summary)**
```bash
celery -A app.workers.celery_app worker --loglevel=info --pool=solo
```

### 3. Verify Setup

```bash
# Test health endpoint
curl http://localhost:8000/health
```

---

## 🐳 Docker Deployment (Recommended)

If you have Docker installed, you can launch the entire stack (API, Workers, Redis) with a single command.

### 1. Build and Start
```bash
# Build images and start all services in the background
docker-compose up -d --build
```

### 2. View Logs
```bash
# View live logs for all services
docker-compose logs -f

# View logs for the API only
docker-compose logs -f api

# View logs for the Workers only
docker-compose logs -f worker
```

### 3. Update Code
If you make changes to the Python code, you MUST rebuild to see the changes:
```bash
# Rebuild and restart the containers
docker-compose up -d --build
```

### 4. Stop and Clean
```bash
# Stop all containers
docker-compose stop

# Stop and REMOVE all containers, networks, and orphaned services
docker-compose down --remove-orphans
```

---

## 4. Test Ingestion (Synchronous)

The Ingestion layer is now **synchronous**, meaning you get the results immediately!

```bash
# Submit a document job (Wait for response)
curl -X POST http://localhost:8000/jobs/document \
  -H "Content-Type: application/json" \
  -d '{
    "file_url": "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
    "file_type": "pdf",
    "metadata": {
      "doc_type": "drhp",
      "filename": "testing_manual.pdf"
    }
  }'

# Response: {"status": "success", "message": "Document processed...", "details": {...}}
```

## 🔗 Integration with Node.js Backend

```javascript
// Example: Submit job from Node.js
const axios = require('axios');

async function submitDocumentJob(fileUrl, fileType) {
  const response = await axios.post('http://localhost:8000/jobs/document', {
    file_url: fileUrl,
    file_type: fileType,
    metadata: {
      user_id: '123',
      source: 'upload'
    }
  });
  
  return response.data.job_id;
}

async function checkJobStatus(jobId) {
  const response = await axios.get(`http://localhost:8000/jobs/${jobId}`);
  return response.data;
}

// Usage
const jobId = await submitDocumentJob('https://example.com/doc.pdf', 'pdf');
console.log('Job submitted:', jobId);

// Poll for result
const status = await checkJobStatus(jobId);
console.log('Job status:', status);
```

## 📊 Available Pipelines

### 1. Document Processing
**Endpoint:** `POST /jobs/document`

Processes documents (PDF, DOCX, TXT):
- Extracts text
- Chunks into manageable pieces
- Generates embeddings
- Stores in MongoDB

### 2. News Article Processing
**Endpoint:** `POST /jobs/news`

Processes news articles:
- Fetches article content
- Extracts key information
- Stores in MongoDB

### 3. Text Summarization
**Endpoint:** `POST /jobs/summary`

Generates summaries:
- Takes input text
- Creates summary (brief/detailed)
- Returns summarized content

## 🌍 Environment Configuration

```bash
# Copy template
cp .env.example .env

# Edit configuration
nano .env
```

**Key variables:**
- `APP_ENV` - Environment (sandbox/dev/prod)
- `REDIS_HOST` - Redis connection
- `MONGO_URI` - MongoDB connection
- `LOG_LEVEL` - Logging verbosity

## 🐛 Troubleshooting

### Workers not starting
```bash
# Check Celery can connect to Redis
celery -A app.workers.celery_app inspect ping
```

### API not responding
```bash
# Check if port 8000 is available
lsof -i :8000

# View API logs
tail -f logs/api.log
```

### MongoDB connection error
```bash
# Test MongoDB connection
mongosh --eval "db.adminCommand('ping')"
```

## 📚 Documentation

- See `README.md` for complete documentation
- API docs: `http://localhost:8000/docs` (when DEBUG=true)
- Architecture details in README

## ✅ Next Steps

1. ✅ Platform scaffolded and ready
2. ⬜ Configure `.env` for your environment
3. ⬜ Test with sample jobs
4. ⬜ Integrate with Node.js backend
5. ⬜ Deploy to Azure Container Apps

---

**Need help?** Check README.md or contact the platform team.
