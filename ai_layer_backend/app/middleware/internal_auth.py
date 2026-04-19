"""
Internal authentication middleware for the Python FastAPI backend.

Validates the X-Internal-Secret header on all Python API endpoints.
Only the Node.js backend should call these endpoints, and it must
provide the shared INTERNAL_SECRET to authenticate.

Usage in routers:
    from app.middleware.internal_auth import require_internal_secret
    
    @router.post("/pipeline")
    async def submit_pipeline(request: Request, _=Depends(require_internal_secret)):
        ...
"""
from fastapi import Request, HTTPException, Depends
from fastapi.security import APIKeyHeader
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

internal_secret_header = APIKeyHeader(name="X-Internal-Secret", auto_error=False)

async def require_internal_secret(
    request: Request,
    provided_key: str = Depends(internal_secret_header)
) -> None:
    """
    FastAPI dependency that validates the X-Internal-Secret header.
    
    Raises HTTPException 403 if the secret is missing or invalid.
    Raises HTTPException 503 if INTERNAL_SECRET is not configured.
    """
    print(f"DEBUG: Auth middleware hit for path: {request.url.path}")
    expected = getattr(settings, "INTERNAL_SECRET", None)
    
    if not expected:
        logger.error("INTERNAL_SECRET not configured — all internal endpoints are disabled")
        raise HTTPException(
            status_code=503,
            detail={
                "error": "Internal endpoints not configured",
                "code": "INTERNAL_SECRET_MISSING",
            },
        )
    
    # Use key from header (via APIKeyHeader) or from the request itself as fallback
    provided = provided_key or request.headers.get("x-internal-secret", "")
    
    if not provided or provided != expected:
        logger.warning(
            "Invalid internal secret attempt",
            path=str(request.url.path),
            ip=request.client.host if request.client else "unknown",
        )
        raise HTTPException(
            status_code=403,
            detail={
                "error": "Invalid or missing internal secret",
                "code": "INVALID_INTERNAL_SECRET",
            },
        )
    
    # Valid — request is from Node.js backend
    return None
