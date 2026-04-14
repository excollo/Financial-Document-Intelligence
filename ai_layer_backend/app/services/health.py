"""
Health check service for AI Python Platform.
Checks connectivity to external AI providers (OpenAI, Pinecone, Cohere).
"""
import time
from typing import Dict, Any, List
import openai
from pinecone import Pinecone
import cohere
from app.core.config import settings
from app.core.logging import get_logger
from app.core.openai_client import get_openai_client, DEPLOYMENT_MODEL

logger = get_logger(__name__)

class HealthService:
    """Service for checking the health of external AI dependencies."""

    def __init__(self):
        self.openai_client = get_openai_client()
        self.pinecone_client = Pinecone(api_key=settings.PINECONE_API_KEY)
        self.cohere_client = None
        if settings.COHERE_API_KEY:
            self.cohere_client = cohere.Client(settings.COHERE_API_KEY)

    async def check_openai(self) -> Dict[str, Any]:
        """Check Azure OpenAI / OpenAI connectivity via a minimal chat completion."""
        start_time = time.time()
        try:
            self.openai_client.chat.completions.create(
                model=DEPLOYMENT_MODEL,
                messages=[{"role": "user", "content": "ping"}],
                max_tokens=1
            )
            provider = "Azure OpenAI" if settings.USE_AZURE_OPENAI else "OpenAI"
            return {
                "status": "operational",
                "latency": round(time.time() - start_time, 3),
                "message": f"Successfully connected to {provider}"
            }
        except openai.AuthenticationError:
            return {
                "status": "error",
                "message": "Invalid OpenAI/Azure API Key",
                "error_code": "AUTH_ERROR"
            }
        except openai.RateLimitError:
            return {
                "status": "degraded",
                "message": "Rate limit exceeded or quota reached",
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

    async def get_full_status(self) -> Dict[str, Any]:
        """Aggregate all health checks."""
        openai_status = await self.check_openai()
        pinecone_status = await self.check_pinecone()
        cohere_status = await self.check_cohere()
        perplexity_status = await self.check_perplexity()
        gemini_status = await self.check_gemini()

        # Overall health logic
        overall = "operational"
        critical_services = [openai_status, pinecone_status, gemini_status]
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
            "services": {
                "openai": openai_status,
                "pinecone": pinecone_status,
                "cohere": cohere_status,
                "perplexity": perplexity_status,
                "gemini": gemini_status
            }
        }

health_service = HealthService()
