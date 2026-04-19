import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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
    
    # Diagnostic: Print all registered routes
    for route in app.routes:
        path = getattr(route, 'path', 'unknown')
        name = getattr(route, 'name', 'unknown')
        logger.info(f"Route Registered: {path} [{name}]")
    
    # Diagnostic: Masked URI check
    uri = settings.MONGODB_URI
    masked_uri = f"{uri[:15]}..." if uri else "EMPTY"
    logger.info(f"Connecting with MONGODB_URI: {masked_uri}")
    
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


# Health check routers are included below in the 'Include routers' section


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
