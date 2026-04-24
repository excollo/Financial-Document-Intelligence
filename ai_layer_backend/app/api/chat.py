"""
API endpoints for real-time chat.
All endpoints require X-Internal-Secret header.
"""
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Request, Depends
from pydantic import BaseModel, Field
from app.services.chat.service import chat_service
from app.core.logging import get_logger
from app.middleware.internal_auth import require_internal_secret

logger = get_logger(__name__)
router = APIRouter(prefix="/chats", tags=["chats"], dependencies=[Depends(require_internal_secret)])

import uuid
import traceback
from app.db.mongo import mongodb
from app.services.backend_notifier import backend_notifier

class ChatRequest(BaseModel):
    message: str = Field(..., description="The user's question")
    namespace: str = Field(..., description="The document filename/namespace")
    document_type: str = Field(..., description="DRHP or RHP")
    documentId: Optional[str] = None
    domainId: Optional[str] = None
    history: Optional[List[Dict[str, str]]] = Field(default=None, description="Previous chat history")
    authorization: Optional[str] = None

class ChatResponse(BaseModel):
    status: str
    output: str
    usage: Optional[Dict[str, int]] = None
    duration: float
    job_id: str

@router.post("/query", response_model=ChatResponse)
async def chat_query(request: ChatRequest, req: Request):
    """
    Real-time chat endpoint for document analysis.
    """
    job_id = str(uuid.uuid4())
    logger.info("Executing real-time chat", job_id=job_id, namespace=request.namespace)
    
    try:
        # Build Metadata Filter for Tenant Isolation
        metadata_filter = {}
        if request.domainId:
            metadata_filter["domainId"] = request.domainId
        if request.documentId:
            metadata_filter["documentId"] = request.documentId
            
        # 1. Execute Chat
        result = await chat_service.chat(
            message=request.message,
            namespace=request.namespace,
            document_type=request.document_type,
            history=request.history,
            metadata_filter=metadata_filter if metadata_filter else None
        )
        
        if result["status"] == "error":
            raise Exception(result["message"])
            
        # 2. Log to MongoDB (Async)
        try:
            collection = mongodb.get_collection("chat_interactions")
            await collection.insert_one({
                "job_id": job_id,
                "namespace": request.namespace,
                "document_type": request.document_type,
                "message": request.message,
                "output": result["output"],
                "usage": result.get("usage"),
                "duration": result.get("duration"),
                "timestamp": datetime.now(timezone.utc)
            })
        except Exception as mongo_err:
            logger.warning("Failed to log chat to MongoDB", error=str(mongo_err))

        return {
            "status": "success",
            "output": result["output"],
            "usage": result.get("usage"),
            "duration": result.get("duration"),
            "job_id": job_id
        }
        
    except Exception as e:
        logger.error("Chat API failed", job_id=job_id, error=str(e))
        
        # Notify Backend of Failure (Replicates n8n "Send Error to Backend8")
        backend_notifier.update_chat_status(
            job_id=job_id,
            namespace=request.namespace,
            status="failed",
            error={
                "message": str(e),
                "stack": traceback.format_exc()
            },
            authorization=request.authorization
        )
        
        raise HTTPException(status_code=500, detail=str(e))
