"""
Health check routes for AI Python Platform.
"""
from fastapi import APIRouter
from app.services.health import health_service

router = APIRouter(prefix="/health", tags=["Health"])

@router.get("/detailed")
async def get_detailed_health():
    """
    Returns a detailed health report of all external dependencies.
    Used by the Node.js backend to aggregate system health.
    """
    return await health_service.get_full_status()

@router.get("/basic")
async def get_basic_health():
    """
    Simple health check for load balancers.
    """
    return {"status": "operational", "service": "ai-python-platform"}
