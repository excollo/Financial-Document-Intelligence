# Deployment Checklist

## Pre-Deployment

### Code Quality
- [ ] All Python files have proper docstrings
- [ ] No hardcoded credentials in code
- [ ] Environment variables properly configured
- [ ] Dependencies listed in requirements.txt
- [ ] .gitignore includes .env and sensitive files

### Testing
- [ ] Health endpoint responds correctly
- [ ] Can submit jobs via API
- [ ] Celery workers processing tasks
- [ ] MongoDB connection working
- [ ] Redis connection working
- [ ] Job status endpoint returns results

### Configuration
- [ ] `.env` file created from `.env.example`
- [ ] `APP_ENV` set to correct environment (sandbox/dev/prod)
- [ ] Redis credentials configured
- [ ] MongoDB connection string updated
- [ ] Log level appropriate for environment
- [ ] CORS origins configured for Node.js backend

## Docker Build

### Images
- [ ] API Dockerfile builds successfully
- [ ] Worker Dockerfile builds successfully
- [ ] Images tagged with version/environment
- [ ] Images pushed to container registry

### Build Commands
```bash
# Build API
docker build -f docker/api.Dockerfile -t ai-platform-api:v1.0.0 .

# Build Worker
docker build -f docker/worker.Dockerfile -t ai-platform-worker:v1.0.0 .

# Test locally
docker-compose up
```

## Azure Container Apps Deployment

### Prerequisites
- [ ] Azure subscription active
- [ ] Resource group created
- [ ] Container Apps Environment created
- [ ] Azure Redis Cache provisioned
- [ ] MongoDB (CosmosDB or Atlas) configured
- [ ] Container registry accessible

### Environment Variables (Azure)
Set these in Azure Container Apps configuration:

**Required:**
- [ ] `APP_ENV=prod`
- [ ] `REDIS_HOST=<azure-redis-host>`
- [ ] `REDIS_PASSWORD=<azure-redis-password>`
- [ ] `MONGO_URI=<mongodb-connection-string>`
- [ ] `LOG_LEVEL=INFO`

**Optional:**
- [ ] `API_WORKERS=4`
- [ ] `MAX_CHUNK_SIZE=1000`
- [ ] `EMBEDDING_DIMENSION=768`

### Deployment Steps

1. **Deploy API Container**
```bash
az containerapp create \
  --name ai-platform-api \
  --resource-group <resource-group> \
  --environment <container-apps-env> \
  --image <registry>/ai-platform-api:v1.0.0 \
  --target-port 8000 \
  --ingress external \
  --min-replicas 2 \
  --max-replicas 10 \
  --cpu 1.0 \
  --memory 2.0Gi \
  --env-vars \
    APP_ENV=prod \
    REDIS_HOST=<redis-host> \
    REDIS_PASSWORD=secretref:redis-password \
    MONGO_URI=secretref:mongo-uri
```

2. **Deploy Worker Container**
```bash
az containerapp create \
  --name ai-platform-worker \
  --resource-group <resource-group> \
  --environment <container-apps-env> \
  --image <registry>/ai-platform-worker:v1.0.0 \
  --ingress internal \
  --min-replicas 2 \
  --max-replicas 20 \
  --cpu 2.0 \
  --memory 4.0Gi \
  --env-vars \
    APP_ENV=prod \
    REDIS_HOST=<redis-host> \
    REDIS_PASSWORD=secretref:redis-password \
    MONGO_URI=secretref:mongo-uri
```

### Verification
- [ ] API health endpoint accessible
- [ ] API docs disabled in production
- [ ] Workers processing tasks
- [ ] Logs visible in Azure Monitor
- [ ] Metrics being collected
- [ ] Auto-scaling configured

## Post-Deployment

### Monitoring
- [ ] Set up Application Insights
- [ ] Configure log analytics
- [ ] Create alerts for errors
- [ ] Monitor worker queue depth
- [ ] Track API response times

### Security
- [ ] Rotate Redis password
- [ ] Rotate MongoDB credentials
- [ ] Enable Azure Key Vault integration
- [ ] Configure managed identity
- [ ] Review network security groups
- [ ] Enable HTTPS only

### Integration
- [ ] Update Node.js backend with API URL
- [ ] Test end-to-end workflow
- [ ] Configure webhooks (if needed)
- [ ] Set up API rate limiting
- [ ] Document API endpoints for backend team

## Rollback Plan

### If Deployment Fails
1. Check logs: `az containerapp logs show --name ai-platform-api`
2. Verify environment variables
3. Test containers locally first
4. Rollback to previous version:
   ```bash
   az containerapp update \
     --name ai-platform-api \
     --image <registry>/ai-platform-api:v0.9.0
   ```

## Environment-Specific Notes

### Sandbox
- Purpose: Testing and development
- Auto-scaling: Minimal (1-2 replicas)
- Log level: DEBUG
- Resources: Shared/minimal

### Dev
- Purpose: Pre-production testing
- Auto-scaling: Moderate (2-5 replicas)
- Log level: INFO
- Resources: Moderate

### Prod
- Purpose: Production workloads
- Auto-scaling: Aggressive (2-20 replicas)
- Log level: WARNING
- Resources: Production-grade
- Monitoring: Full observability

## Performance Tuning

### API
- [ ] Adjust `API_WORKERS` based on load
- [ ] Configure connection pooling
- [ ] Enable caching if needed
- [ ] Review timeout settings

### Workers
- [ ] Set `--concurrency` based on CPU cores
- [ ] Adjust `max-tasks-per-child` for memory
- [ ] Configure task time limits
- [ ] Monitor queue depth

### Redis
- [ ] Configure maxmemory policy
- [ ] Enable persistence if needed
- [ ] Set appropriate connection limits

### MongoDB
- [ ] Create indexes on frequently queried fields
- [ ] Configure connection pool size
- [ ] Enable query profiling
- [ ] Monitor slow queries

## Sign-Off

### Development Team
- [ ] Code reviewed and approved
- [ ] Tests passing
- [ ] Documentation updated
- Approved by: _______________ Date: ___________

### DevOps Team
- [ ] Infrastructure provisioned
- [ ] Secrets configured
- [ ] Monitoring configured
- Approved by: _______________ Date: ___________

### Product Team
- [ ] Feature requirements met
- [ ] Integration tested
- [ ] Ready for production
- Approved by: _______________ Date: ___________

---

**Deployment Date:** ___________
**Deployment Version:** v1.0.0
**Deployed By:** ___________
**Rollback Version:** ___________
