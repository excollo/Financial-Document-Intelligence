from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends
from pydantic import BaseModel
from typing import List, Optional
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
        # Run synchronously to allow frontend to wait for completion
        result = run_monitor(domain_id=request.domainId)
        
        if result.get("success"):
            return {
                "message": result.get("message", "Instant news crawl completed successfully"),
                "domainId": request.domainId,
                "status": "completed",
                "article_count": result.get("article_count", 0),
                "errors": result.get("errors")
            }
        else:
            error_detail = result.get("error") or "News crawl failed or domain not found"
            if result.get("errors"):
                error_detail += " - Errors: " + "; ".join(result.get("errors"))
            raise HTTPException(status_code=500, detail=error_detail)
            
    except Exception as e:
        logger.error(f"Error during instant news crawl: {e}")
        raise HTTPException(status_code=500, detail=str(e))

