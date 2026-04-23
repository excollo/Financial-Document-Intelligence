"""
Environment-based configuration management.
Supports sandbox, dev, and prod environments.
"""
import os
from typing import Literal, Optional
from functools import lru_cache
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field, AliasChoices


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""
    
    model_config = SettingsConfigDict(
        env_file=os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), ".env"),
        env_file_encoding="utf-8",
        case_sensitive=False,  # Environment variables are usually case-insensitive
        extra="ignore",
        populate_by_name=True
    )
    
    # Environment
    APP_ENV: Literal["sandbox", "dev", "prod"] = "sandbox"
    APP_NAME: str = "AI Python Platform"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False
    
    # API Settings
    API_HOST: str = "0.0.0.0"
    API_PORT: int = 8000
    API_WORKERS: int = 4
    
    # Redis Configuration
    REDIS_HOST: str = "localhost"
    REDIS_PORT: int = 6379
    REDIS_DB: int = 0
    REDIS_PASSWORD: str = ""
    REDIS_URL: Optional[str] = None # Added for external providers like Upstash
    REDIS_TLS_CA_BUNDLE: Optional[str] = None
    
    # Celery Configuration
    CELERY_BROKER_URL: str = ""
    CELERY_RESULT_BACKEND: str = ""
    CELERY_TASK_SERIALIZER: str = "json"
    CELERY_RESULT_SERIALIZER: str = "json"
    CELERY_ACCEPT_CONTENT: list = ["json"]
    CELERY_TIMEZONE: str = "Asia/Kolkata"
    CELERY_ENABLE_UTC: bool = False
    CELERY_WORKER_CONCURRENCY: int = 1
    CELERY_WORKER_MAX_TASKS_PER_CHILD: int = 4
    CELERY_WORKER_MAX_MEMORY_PER_CHILD: int = 1200000
    CELERY_TASK_DEFAULT_QUEUE: str = "celery"
    CELERY_TASK_DEFAULT_EXCHANGE: str = "celery"
    CELERY_TASK_DEFAULT_ROUTING_KEY: str = "celery"
    
    # Azure Application Insights (Logging & Monitoring)
    APPLICATIONINSIGHTS_CONNECTION_STRING: str = ""
    
    # MongoDB Configuration
    # Accept both MONGODB_URI (preferred) and legacy MONGO_URI.
    MONGODB_URI: str = Field(default="", validation_alias=AliasChoices("MONGODB_URI", "MONGO_URI"))
    COSMOSDB_URI: Optional[str] = None
    MONGO_DB_NAME: str = "pdf-summarizer"
    
    # Logging
    LOG_LEVEL: str = "INFO"
    LOG_FORMAT: str = "json"
    
    # AI/ML Settings
    MAX_CHUNK_SIZE: int = 4800
    CHUNK_OVERLAP: int = 800
    EMBEDDING_DIMENSION: int = 3072  # text-embedding-3-large
    EMBEDDING_MODEL: str = "text-embedding-3-large"
    EXTRACTION_EXECUTOR_MODE: Literal["auto", "thread", "process"] = "auto"
    EXTRACTION_MAX_WORKERS: int = 1
    EXTRACTION_TOC_SCAN_MAX_PAGES: int = 200
    EXTRACTION_BATCH_PROGRESS_TIMEOUT_SECONDS: int = 180
    INGESTION_PARALLEL_BATCH: int = 1
    INGESTION_EXTRACTION_TIMEOUT_SECONDS: int = 1800
    ENABLE_MANUAL_GC: bool = True
    GC_EVERY_N_BATCHES: int = 2
    GC_MIN_LARGE_OBJECT_MB: float = 100.0
    
    # OpenAI
    OPENAI_API_KEY: str = ""
    SUMMARY_MODEL: str = "gpt-4.1-mini"
    
    # Pinecone
    PINECONE_API_KEY: str = ""
    PINECONE_ENVIRONMENT: str = ""
    
    # Pinecone Index settings (will be overridden by .env if provided)
    PINECONE_INDEX: str = ""
    PINECONE_INDEX_HOST: str = ""
    
    PERPLEXITY_API_KEY: Optional[str] = None
    COHERE_API_KEY: Optional[str] = None
    GEMINI_API_KEY: Optional[str] = None
    SERPER_API_KEY: Optional[str] = None
    GPT_MODEL: str = "gpt-4o-mini"
    
    # Azure Blob Storage
    AZURE_BLOB_ACCOUNT_NAME: str = ""
    AZURE_BLOB_ACCOUNT_KEY: str = ""
    AZURE_BLOB_CONTAINER_NAME: str = "drhp-files"
    AZURE_BLOB_STORAGE_CONNECTION_STRING: str = ""
    
    # Internal authentication (Node <-> Python)
    INTERNAL_SECRET: str = ""  # Shared secret for internal API calls
    INTERNAL_CALLBACK_SIGNING_SECRET: Optional[str] = None
    INTERNAL_CALLBACK_NONCE_TTL_SECONDS: int = 300
    INTERNAL_CALLBACK_TIMESTAMP_TOLERANCE_SECONDS: int = 300
    INTERNAL_CALLBACK_SIGNATURE_REQUIRED: bool = True
    NODE_BACKEND_URL: str = ""  # Node.js backend base URL
    
    # Backend callback URLs (Properties to ensure they are always derived from NODE_BACKEND_URL)
    @property
    def BACKEND_STATUS_URL(self) -> str:
        return f"{self.NODE_BACKEND_URL}/api/documents/upload-status/update"
    
    @property
    def REPORT_CREATE_URL(self) -> str:
        return f"{self.NODE_BACKEND_URL}/api/reports/create-report"
    
    @property
    def REPORT_STATUS_UPDATE_URL(self) -> str:
        return f"{self.NODE_BACKEND_URL}/api/reports/report-status/update"
    
    @property
    def CHAT_STATUS_UPDATE_URL(self) -> str:
        return f"{self.NODE_BACKEND_URL}/api/chats/chat-status/update"
    
    @property
    def SUMMARY_CREATE_URL(self) -> str:
        return f"{self.NODE_BACKEND_URL}/api/summaries/create"
    
    @property
    def SUMMARY_STATUS_UPDATE_URL(self) -> str:
        return f"{self.NODE_BACKEND_URL}/api/summaries/summary-status/update"

    @staticmethod
    def _normalize_redis_url(url: str) -> str:
        """
        Normalize Redis URL query parameters for compatibility across clients.
        In particular, redis-py expects ssl_cert_reqs values like:
        'required' | 'optional' | 'none' (not CERT_REQUIRED).
        """
        if not url:
            return url

        parts = urlsplit(url)
        if not parts.scheme:
            return url

        query_items = dict(parse_qsl(parts.query, keep_blank_values=True))
        if parts.scheme.lower() == "rediss":
            raw_ssl_value = query_items.get("ssl_cert_reqs", "").strip()
            normalized_ssl = {
                "CERT_REQUIRED": "required",
                "REQUIRED": "required",
                "required": "required",
                "CERT_OPTIONAL": "optional",
                "OPTIONAL": "optional",
                "optional": "optional",
                "CERT_NONE": "none",
                "NONE": "none",
                "none": "none",
            }.get(raw_ssl_value, "required")
            query_items["ssl_cert_reqs"] = normalized_ssl

        normalized_query = urlencode(query_items)
        return urlunsplit((parts.scheme, parts.netloc, parts.path, normalized_query, parts.fragment))



    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        # Cosmos DB (Mongo API): prefer non-SRV URI when MONGODB_URI is cosmos +srv.
        if (
            self.MONGODB_URI
            and "mongocluster.cosmos.azure.com" in self.MONGODB_URI
            and self.MONGODB_URI.startswith("mongodb+srv://")
            and self.COSMOSDB_URI
        ):
            self.MONGODB_URI = self.COSMOSDB_URI

        # Ensure NODE_BACKEND_URL doesn't have a trailing slash
        if self.NODE_BACKEND_URL.endswith("/"):
            self.NODE_BACKEND_URL = self.NODE_BACKEND_URL[:-1]
            
        # Callback URLs are now properties derived from NODE_BACKEND_URL

        # Auto-configure Redis URLs if not set
        base_redis_url = self.REDIS_URL
        if not base_redis_url:
            redis_password = f":{self.REDIS_PASSWORD}@" if self.REDIS_PASSWORD else ""
            base_redis_url = f"redis://{redis_password}{self.REDIS_HOST}:{self.REDIS_PORT}/{self.REDIS_DB}"

        if not self.CELERY_BROKER_URL:
            self.CELERY_BROKER_URL = base_redis_url
        if not self.CELERY_RESULT_BACKEND:
            self.CELERY_RESULT_BACKEND = base_redis_url

        # Normalize all Redis-related URLs to avoid runtime SSL parsing warnings.
        if self.REDIS_URL:
            self.REDIS_URL = self._normalize_redis_url(self.REDIS_URL)
        self.CELERY_BROKER_URL = self._normalize_redis_url(self.CELERY_BROKER_URL)
        self.CELERY_RESULT_BACKEND = self._normalize_redis_url(self.CELERY_RESULT_BACKEND)
    
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
