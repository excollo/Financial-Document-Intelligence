"""
Environment-based configuration management.
Supports sandbox, dev, and prod environments.
"""
import os
from typing import Literal, Optional
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""
    
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore"
    )
    
    # Environment
    APP_ENV: Literal["sandbox", "dev", "prod"] = "sandbox"
    APP_NAME: str = "AI Python Platform"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False
    
    # API Settings
    API_HOST: str = "0.0.0.0"
    API_PORT: int = 8001
    API_WORKERS: int = 4
    
    # Redis Configuration
    REDIS_HOST: str = "localhost"
    REDIS_PORT: int = 6379
    REDIS_DB: int = 0
    REDIS_PASSWORD: str = ""
    REDIS_URL: Optional[str] = None # Added for external providers like Upstash
    
    # Celery Configuration
    CELERY_BROKER_URL: str = ""
    CELERY_RESULT_BACKEND: str = ""
    CELERY_TASK_SERIALIZER: str = "json"
    CELERY_RESULT_SERIALIZER: str = "json"
    CELERY_ACCEPT_CONTENT: list = ["json"]
    CELERY_TIMEZONE: str = "Asia/Kolkata"
    CELERY_ENABLE_UTC: bool = False
    
    # Azure Application Insights (Logging & Monitoring)
    API_APPINSIGHTS_CONNECTION_STRING: str = ""
    
    # MongoDB Configuration
    MONGO_URI: str = "mongodb+srv://sonuv:Sonu12345@cluster0.makyp.mongodb.net/"
    MONGO_DB_NAME: str = "pdf-summarizer"
    
    # Logging
    LOG_LEVEL: str = "INFO"
    LOG_FORMAT: str = "json"
    
    # AI/ML Settings
    MAX_CHUNK_SIZE: int = 4800
    CHUNK_OVERLAP: int = 800
    EMBEDDING_DIMENSION: int = 3072  # text-embedding-3-large
    EMBEDDING_MODEL: str = "text-embedding-3-large"
    
    # OpenAI
    OPENAI_API_KEY: str = ""
    SUMMARY_MODEL: str = "gpt-4.1-mini"
    
    # Pinecone
    PINECONE_API_KEY: str = ""
    PINECONE_ENVIRONMENT: str = "us-east-1"
    
    # Pinecone Index settings (will be overridden by .env if provided)
    PINECONE_INDEX: str ="drhp-test" #"drhp-summarizer"
    PINECONE_INDEX_HOST: str ="https://drhp-test-w5m6qxe.svc.aped-4627-b74a.pinecone.io"    # "https://drhp-summarizer-y8firn8.svc.aped-4627-b74a.pinecone.io"
    
    PERPLEXITY_API_KEY: Optional[str] = None
    COHERE_API_KEY: Optional[str] = None
    GEMINI_API_KEY: Optional[str] = None
    SERPER_API_KEY: Optional[str] = None
    GPT_MODEL: str = "gpt-4o-mini"
    
    # Internal authentication (Node <-> Python)
    INTERNAL_SECRET: str = ""  # Shared secret for internal API calls
    NODE_BACKEND_URL: str = "http://localhost:5000"  # Node.js backend base URL
    
    # Backend callback URLs (initialized in __init__)
    BACKEND_STATUS_URL: str = ""
    REPORT_CREATE_URL: str = ""
    REPORT_STATUS_UPDATE_URL: str = ""
    CHAT_STATUS_UPDATE_URL: str = ""
    SUMMARY_CREATE_URL: str = ""
    SUMMARY_STATUS_UPDATE_URL: str = ""

    # Cloudflare R2 / S3 Configuration
    R2_ACCESS_KEY_ID: str = ""
    R2_SECRET_ACCESS_KEY: str = ""
    R2_BUCKET_NAME: str = "drhp-files"
    CLOUDFLARE_URI: str = "https://0656c3a93c4bf3f9004bdca37344b55d.r2.cloudflarestorage.com"
    S3_REGION: str = "auto"

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        # Ensure NODE_BACKEND_URL doesn't have a trailing slash
        if self.NODE_BACKEND_URL.endswith("/"):
            self.NODE_BACKEND_URL = self.NODE_BACKEND_URL[:-1]
            
        # Initialize callback URLs
        self.BACKEND_STATUS_URL = f"{self.NODE_BACKEND_URL}/api/documents/upload-status/update"
        self.REPORT_CREATE_URL = f"{self.NODE_BACKEND_URL}/api/reports/create-report"
        self.REPORT_STATUS_UPDATE_URL = f"{self.NODE_BACKEND_URL}/api/reports/report-status/update"
        self.CHAT_STATUS_UPDATE_URL = f"{self.NODE_BACKEND_URL}/api/chats/chat-status/update"
        self.SUMMARY_CREATE_URL = f"{self.NODE_BACKEND_URL}/api/summaries/create"
        self.SUMMARY_STATUS_UPDATE_URL = f"{self.NODE_BACKEND_URL}/api/summaries/summary-status/update"

        # Auto-configure Redis URLs if not set
        base_redis_url = self.REDIS_URL
        if not base_redis_url:
            redis_password = f":{self.REDIS_PASSWORD}@" if self.REDIS_PASSWORD else ""
            base_redis_url = f"redis://{redis_password}{self.REDIS_HOST}:{self.REDIS_PORT}/{self.REDIS_DB}"

        if not self.CELERY_BROKER_URL:
            self.CELERY_BROKER_URL = base_redis_url
        if not self.CELERY_RESULT_BACKEND:
            self.CELERY_RESULT_BACKEND = base_redis_url
    
    @property
    def is_production(self) -> bool:
        """Check if running in production environment."""
        return self.APP_ENV == "prod"
    
    @property
    def is_development(self) -> bool:
        """Check if running in development environment."""
        return self.APP_ENV == "dev"
    
    @property
    def is_sandbox(self) -> bool:
        """Check if running in sandbox environment."""
        return self.APP_ENV == "sandbox"


@lru_cache()
def get_settings() -> Settings:
    """
    Get cached settings instance.
    Uses lru_cache to ensure settings are loaded only once.
    """
    return Settings()


# Global settings instance
settings = get_settings()
