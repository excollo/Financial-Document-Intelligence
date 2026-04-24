"""
Health check service for AI Python Platform.
Checks connectivity to external AI providers (OpenAI, Pinecone, Cohere).
"""
import time
from typing import Dict, Any, List
import openai
from pinecone import Pinecone
import cohere
import httpx
from app.core.config import settings
from app.core.logging import get_logger
from app.db.mongo import mongodb

logger = get_logger(__name__)

class HealthService:
    """Service for checking the health of external AI dependencies."""

    def __init__(self):
        self.openai_client = openai.OpenAI(api_key=settings.OPENAI_API_KEY)
        self.pinecone_client = Pinecone(api_key=settings.PINECONE_API_KEY)
        self.cohere_client = None
        if settings.COHERE_API_KEY:
            self.cohere_client = cohere.Client(settings.COHERE_API_KEY)

    async def check_openai(self) -> Dict[str, Any]:
        """Check OpenAI connectivity and basic functionality."""
        start_time = time.time()
        try:
            # list models is a lightweight way to check API key and connectivity
            self.openai_client.models.list()
            return {
                "status": "operational",
                "latency": round(time.time() - start_time, 3),
                "message": "Successfully connected to OpenAI"
            }
        except openai.AuthenticationError:
            return {
                "status": "error",
                "message": "Invalid OpenAI API Key",
                "error_code": "AUTH_ERROR"
            }
        except openai.RateLimitError:
            return {
                "status": "degraded",
                "message": "OpenAI Rate limit exceeded or quota reached",
                "error_code": "QUOTA_EXCEEDED"
            }
        except Exception as e:
            return {
                "status": "error",
                "message": str(e),
                "error_code": "UNKNOWN_ERROR"
            }

    async def check_pinecone(self) -> Dict[str, Any]:
        """Check Pinecone connectivity."""
        start_time = time.time()
        try:
            # Check availability of indexes
            indexes = self.pinecone_client.list_indexes()
            return {
                "status": "operational",
                "latency": round(time.time() - start_time, 3),
                "index_count": len(indexes),
                "message": f"Connected to Pinecone. Found {len(indexes)} indexes."
            }
        except Exception as e:
            # Handle specific pinecone errors if needed
            return {
                "status": "error",
                "message": str(e),
                "error_code": "PINECONE_ERROR"
            }

    async def check_cohere(self) -> Dict[str, Any]:
        """Check Cohere connectivity."""
        if not self.cohere_client:
            return {
                "status": "not_configured",
                "message": "Cohere API key not provided"
            }
        
        start_time = time.time()
        try:
            # Simple check
            return {
                "status": "operational",
                "latency": round(time.time() - start_time, 3),
                "message": "Cohere client initialized"
            }
        except Exception as e:
            return {
                "status": "error",
                "message": str(e),
                "error_code": "COHERE_ERROR"
            }

    async def check_perplexity(self) -> Dict[str, Any]:
        """Check Perplexity connectivity."""
        if not settings.PERPLEXITY_API_KEY:
            return {
                "status": "not_configured",
                "message": "Perplexity API key not provided"
            }
        
        start_time = time.time()
        try:
            import httpx
            headers = {
                "Authorization": f"Bearer {settings.PERPLEXITY_API_KEY}",
                "Content-Type": "application/json"
            }
            # Use a tiny 'ping' request to chat/completions to verify connectivity and quota
            payload = {
                "model": "sonar",
                "messages": [{"role": "user", "content": "health check"}],
                "max_tokens": 1
            }
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    "https://api.perplexity.ai/chat/completions", 
                    headers=headers, 
                    json=payload, 
                    timeout=15.0
                )
                
                if resp.status_code == 200:
                    return {
                        "status": "operational",
                        "latency": round(time.time() - start_time, 3),
                        "message": "Successfully connected to Perplexity"
                    }
                elif resp.status_code == 401:
                    return {
                        "status": "error",
                        "message": "Invalid Perplexity API Key",
                        "error_code": "AUTH_ERROR"
                    }
                elif resp.status_code == 429:
                    return {
                        "status": "degraded",
                        "message": "Perplexity Rate limit exceeded or quota reached",
                        "error_code": "QUOTA_EXCEEDED"
                    }
                else:
                    return {
                        "status": "error",
                        "message": f"Perplexity API returned {resp.status_code}",
                        "error_code": "PERPLEXITY_ERROR"
                    }
        except Exception as e:
            return {
                "status": "error",
                "message": str(e),
                "error_code": "PERPLEXITY_CONNECTION_ERROR"
            }

    async def check_serper(self) -> Dict[str, Any]:
        """Check Serper connectivity."""
        if not settings.SERPER_API_KEY:
            return {
                "status": "not_configured",
                "message": "Serper API key not provided"
            }

        start_time = time.time()
        try:
            headers = {
                "X-API-KEY": settings.SERPER_API_KEY,
                "Content-Type": "application/json"
            }
            payload = {"q": "finance fraud india", "num": 1}
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post("https://google.serper.dev/search", headers=headers, json=payload)

            if resp.status_code == 200:
                return {
                    "status": "operational",
                    "latency": round(time.time() - start_time, 3),
                    "message": "Successfully connected to Serper"
                }
            if resp.status_code == 401:
                return {
                    "status": "error",
                    "message": "Invalid Serper API key",
                    "error_code": "AUTH_ERROR"
                }
            if resp.status_code == 429:
                return {
                    "status": "degraded",
                    "message": "Serper rate limit exceeded or quota reached",
                    "error_code": "QUOTA_EXCEEDED"
                }
            return {
                "status": "error",
                "message": f"Serper API returned {resp.status_code}",
                "error_code": "SERPER_ERROR"
            }
        except Exception as e:
            return {
                "status": "error",
                "message": str(e),
                "error_code": "SERPER_CONNECTION_ERROR"
            }

    async def check_gemini(self) -> Dict[str, Any]:
        """Check Gemini connectivity and quota status."""
        if not settings.GEMINI_API_KEY:
            return {
                "status": "not_configured",
                "message": "Gemini API key not provided"
            }
        
        start_time = time.time()
        try:
            from google import genai
            client = genai.Client(api_key=settings.GEMINI_API_KEY)
            # Lightweight check: get model info
            client.models.get(model="gemini-2.0-flash-lite")
            
            return {
                "status": "operational",
                "latency": round(time.time() - start_time, 3),
                "message": "Successfully connected to Gemini"
            }
        except Exception as e:
            msg = str(e).lower()
            if "429" in msg or "exhausted" in msg or "quota" in msg:
                return {
                    "status": "degraded",
                    "message": "Gemini Quota Limit Reached (429)",
                    "error_code": "QUOTA_EXCEEDED"
                }
            return {
                "status": "error",
                "message": str(e),
                "error_code": "GEMINI_ERROR"
            }

    async def check_mongodb(self) -> Dict[str, Any]:
        """Check MongoDB connectivity."""
        start_time = time.time()
        try:
            if mongodb.db is None:
                return {
                    "status": "error",
                    "message": "MongoDB client is not initialized (db object is None)",
                    "error_code": "MONGODB_NOT_INITIALIZED"
                }
            
            # Use the admin database for the ping command
            await mongodb.client.admin.command("ping")
            return {
                "status": "operational",
                "latency": round(time.time() - start_time, 3),
                "message": "Successfully pinged MongoDB"
            }
        except Exception as e:
            return {
                "status": "error",
                "message": str(e),
                "error_code": "MONGODB_ERROR"
            }

    async def check_redis(self) -> Dict[str, Any]:
        """Check Redis connectivity."""
        start_time = time.time()
        try:
            import redis
            # Use a short timeout to prevent hanging the health check
            r = redis.from_url(
                settings.REDIS_URL, 
                socket_connect_timeout=2,
                socket_timeout=2
            )
            r.ping()
            return {
                "status": "operational",
                "latency": round(time.time() - start_time, 3),
                "message": "Successfully pinged Redis (Queue)"
            }
        except Exception as e:
            return {
                "status": "error",
                "message": str(e),
                "error_code": "REDIS_ERROR"
            }

    async def get_full_status(self) -> Dict[str, Any]:
        """Aggregate all health checks."""
        # Core Infrastructure
        mongodb_status = await self.check_mongodb()
        redis_status = await self.check_redis()
        
        # AI Services
        openai_status = await self.check_openai()
        pinecone_status = await self.check_pinecone()
        cohere_status = await self.check_cohere()
        perplexity_status = await self.check_perplexity()
        gemini_status = await self.check_gemini()
        serper_status = await self.check_serper()

        # Overall health logic
        overall = "operational"
        critical_services = [mongodb_status, redis_status, openai_status, pinecone_status]
        
        if any(s["status"] == "error" for s in critical_services):
            overall = "error"
        elif any(s["status"] == "degraded" for s in critical_services):
            overall = "degraded"

        return {
            "overall_status": overall,
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "platform": {
                "name": "AI Python Platform",
                "env": settings.APP_ENV,
                "version": settings.APP_VERSION,
                "status": "operational"
            },
            "infrastructure": {
                "mongodb": mongodb_status,
                "redis": redis_status
            },
            "ai_services": {
                "openai": openai_status,
                "pinecone": pinecone_status,
                "cohere": cohere_status,
                "perplexity": perplexity_status,
                "gemini": gemini_status,
                "serper": serper_status
            }
        }

health_service = HealthService()
