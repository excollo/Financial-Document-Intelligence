import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# ============================================================================
# ENVIRONMENT LOADER
# ============================================================================
from dotenv import load_dotenv, find_dotenv
# Explicitly find .env relative to this project structure
load_dotenv(find_dotenv())

def load_key_vault_secrets():
    vault_uri = "https://fdi-keyvault.vault.azure.net/"
    # Now this will correctly pick up APP-ENV from .env (as APP_ENV)
    app_env = os.getenv("APP_ENV") or os.getenv("APP_ENV") or "sandbox"
    use_kv = os.getenv("USE_KEYVAULT", "false").lower() == "true"
    
    if use_kv:
        try:
            from azure.identity import DefaultAzureCredential
            from azure.keyvault.secrets import SecretClient
            
            print(f"🔐 Connecting to Key Vault: {vault_uri}")
            credential = DefaultAzureCredential()
            client = SecretClient(vault_url=vault_uri, credential=credential)
            
            secrets = client.list_properties_of_secrets()
            count = 0
            for secret_prop in secrets:
                if secret_prop.enabled:
                    retrieved_secret = client.get_secret(secret_prop.name)
                    # Set environment variable safely
                    os.environ[secret_prop.name] = retrieved_secret.value
                    count += 1
            print(f"✅ Loaded {count} secrets from Key Vault")
        except Exception as e:
            print(f"❌ Failed to load secrets from Key Vault: {str(e)}")

# Run before settings are imported to ensure variables are available
load_key_vault_secrets()

from app.core.config import settings
from app.core.logging import get_logger
from app.db.mongo import mongodb
from app.api import jobs, chat, onboarding, health, news_monitor

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan manager.
    Handles startup and shutdown events.
    """
    # Startup
    logger.info(
        "Starting AI Python Platform",
        environment=settings.APP_ENV,
        version=settings.APP_VERSION
    )
    
    # Connect to MongoDB
    await mongodb.connect()
    
    yield
    
    # Shutdown
    logger.info("Shutting down AI Python Platform")
    await mongodb.disconnect()


# Create FastAPI app
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="""
    ## AI Python Platform API
    Scalable AI pipeline execution layer designed to replace n8n workflows.
    
    ### Features:
    * **Data Ingestion**: Clean, chunk, embed, and upsert documents to Pinecone.
    * **Asynchronous Processing**: All heavy lifting is handled by Celery workers.
    * **Structured Logging**: JSON logs with job tracking.
    """,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# Configure CORS (adjust for your Node.js backend)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # TODO: Configure specific origins in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Health check endpoint
@app.get("/health")
async def health_check():
    """
    Health check endpoint.
    Returns application status and environment.
    """
    return {
        "status": "healthy",
        "environment": settings.APP_ENV,
        "version": settings.APP_VERSION,
        "service": "ai-python-platform"
    }


# Include routers
app.include_router(jobs.router)
app.include_router(chat.router)
app.include_router(onboarding.router, prefix="/onboarding", tags=["Onboarding"])
app.include_router(news_monitor.router)
app.include_router(health.router)


# Root endpoint
@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "message": "AI Python Platform API",
        "version": settings.APP_VERSION,
        "environment": settings.APP_ENV,
        "docs": "/docs" if settings.DEBUG else "disabled"
    }


if __name__ == "__main__":
    import uvicorn
    
    uvicorn.run(
        "app.main:app",
        host=settings.API_HOST,
        port=settings.API_PORT,
        reload=settings.DEBUG,
        workers=1 if settings.DEBUG else settings.API_WORKERS,
    )
