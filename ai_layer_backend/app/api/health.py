"""
Health check routes for AI Python Platform.
"""
from fastapi import APIRouter
from app.services.health import health_service

router = APIRouter(prefix="/health", tags=["Health"])

@router.get("/detailed")
async def get_detailed_health():
    """Returns a detailed health report."""
    return await health_service.get_full_status()

@router.get("/")
@router.get("")
async def get_basic_health_v2():
    """Simple health check for load balancers."""
    return {"status": "operational", "service": "ai-python-platform-router"}
