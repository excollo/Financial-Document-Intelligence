from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool
from app.services.news_monitor import run_monitor
from app.middleware.internal_auth import require_internal_secret
import logging

router = APIRouter(prefix="/news-monitor", tags=["News Monitor"], dependencies=[Depends(require_internal_secret)])
logger = logging.getLogger(__name__)

class InstantCrawlRequest(BaseModel):
    domainId: str

@router.post("/trigger")
async def trigger_instant_crawl(request: InstantCrawlRequest):
    """
    Triggers an instant news crawl for a specific domain.
    """
    if not request.domainId:
        raise HTTPException(status_code=400, detail="domainId is required")
    
    logger.info(f"Instant News Monitor trigger received for domain: {request.domainId}")
    
    try:
        # Heavy work off the asyncio event loop (RSS + Serper + GPT can take minutes)
        result = await run_in_threadpool(run_monitor, request.domainId)
        
        if result.get("success"):
            return {
                "message": result.get("message", "Instant news crawl completed successfully"),
                "domainId": request.domainId,
                "status": "completed",
                "article_count": result.get("article_count", 0),
                "errors": result.get("errors")
            }
        error_detail = result.get("error") or "News crawl failed or domain not found"
        if result.get("errors"):
            error_detail += " - Errors: " + "; ".join(result.get("errors"))
        # Domain missing in Mongo is a client/config issue, not a server bug
        status = 404 if result.get("code") == "DOMAIN_NOT_FOUND" else 500
        raise HTTPException(status_code=status, detail=error_detail)
            
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error during instant news crawl")
        raise HTTPException(status_code=500, detail=str(e))

