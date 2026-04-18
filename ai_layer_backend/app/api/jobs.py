"""
Job intake API endpoints.
Handles job submission from Node.js backend and returns job_id immediately.
All endpoints require X-Internal-Secret header (validated by require_internal_secret).
"""
from typing import Dict, Any, Optional
from fastapi import APIRouter, HTTPException, status, Depends
from pydantic import BaseModel, Field
import uuid

from app.workers.celery_app import celery_app
from app.core.logging import get_logger
from app.services.ingestion_pipeline import ingestion_pipeline
from app.middleware.internal_auth import require_internal_secret
from app.db.mongo import mongodb
from app.services.s3 import s3_service
from app.services.vector_store import vector_store_service
from app.core.config import settings

logger = get_logger(__name__)
router = APIRouter(prefix="/jobs", tags=["jobs"], dependencies=[Depends(require_internal_secret)])


# Request/Response Models
class PipelineJobRequest(BaseModel):
    """New-style document processing pipeline request."""
    job_id: str = Field(..., description="Job identifier from Node backend")
    tenant_id: str = Field(..., description="Tenant identifier")
    document_name: str = Field(..., description="Original name of the document")
    s3_input_key: str = Field(..., description="Path to input PDF in Azure Blob Storage")
    sop_config_id: Optional[str] = Field(default=None, description="Optional SOP config ID to use")


class DocumentJobRequest(BaseModel):
    """Legacy/direct document ingestion request."""
    file_url: str
    file_type: str = "drhp"
    metadata: Optional[Dict[str, Any]] = None


class NewsJobRequest(BaseModel):
    """News article processing job request."""
    article_url: str = Field(..., description="URL to news article")
    metadata: Optional[Dict[str, Any]] = Field(default=None, description="Additional metadata")


class SummaryJobRequest(BaseModel):
    """Summary generation job request."""
    namespace: str = Field(..., description="The filename/namespace in Pinecone to summarize")
    doc_type: str = Field(default="drhp", description="Type of document (drhp or rhp)")
    authorization: Optional[str] = None
    documentId: Optional[str] = None
    domainId: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = Field(default=None, description="Additional metadata")


class ComparisonJobRequest(BaseModel):
    """Comparison generation job request."""
    drhpNamespace: str
    rhpNamespace: str
    drhpDocumentId: str
    rhpDocumentId: str
    sessionId: str
    domain: Optional[str] = None
    domainId: Optional[str] = None
    authorization: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = Field(default=None, description="Additional metadata")


class JobResponse(BaseModel):
    """Job submission response."""
    job_id: str = Field(..., description="Unique job identifier")
    status: str = Field(..., description="Job status")
    message: str = Field(..., description="Response message")


class JobStatusResponse(BaseModel):
    """Job status check response."""
    job_id: str
    state: str
    result: Optional[Any] = None
    error: Optional[str] = None


# Routes
@router.post("/pipeline", response_model=JobResponse, status_code=status.HTTP_202_ACCEPTED)
async def submit_pipeline_job(request: PipelineJobRequest) -> JobResponse:
    """
    New-style single-entry document processing pipeline.
    """
    try:
        logger.info(
            "New pipeline job submitted",
            job_id=request.job_id,
            tenant_id=request.tenant_id,
            document=request.document_name
        )
        
        celery_app.send_task(
            "process_pipeline_job",
            args=[request.model_dump()],
            task_id=request.job_id
        )
        
        return JobResponse(
            job_id=request.job_id,
            status="accepted",
            message="Pipeline job enqueued successfully"
        )
    
    except Exception as e:
        logger.error("Failed to submit pipeline job", error=str(e), exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to enqueue pipeline job: {str(e)}"
        )


@router.post("/document", status_code=status.HTTP_202_ACCEPTED)
async def submit_document_job(request: DocumentJobRequest):
    """
    Asynchronous Document Ingestion.
    Returns 202 Accepted immediately and offloads work to Celery.
    """
    request_metadata = request.metadata or {}
    incoming_document_id = str(request_metadata.get("documentId") or "").strip()
    # Prefer documentId as Celery job id so backend callbacks can always resolve
    # the target document even if metadata is partially missing later.
    job_id = incoming_document_id or str(uuid.uuid4())
    
    try:
        logger.info("Enqueuing document ingestion job", job_id=job_id, file_url=request.file_url)
        
        celery_app.send_task(
            "process_document",
            args=[request.file_url, request.file_type, job_id, request_metadata],
            task_id=job_id
        )
        
        return {
            "job_id": job_id,
            "status": "accepted",
            "message": "Document ingestion job enqueued successfully"
        }
    
    except Exception as e:
        logger.error("Failed to enqueue document ingestion", job_id=job_id, error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to enqueue job: {str(e)}"
        )


@router.delete("/document", status_code=status.HTTP_200_OK)
async def delete_document(
    namespace: str,  # The filename/documentName
    doc_type: str = "drhp"
):
    """
    Comprehensive document cleanup: deletes Pinecone vectors, MongoDB results, and Azure Blob visuals.
    """
    try:
        logger.info("Starting cascading deletion", filename=namespace)
        
        # 1. MongoDB Cleanup
        # Identify the job_id from metadata if possible for S3 cleanup
        job_id = None
        try:
            if mongodb.db is None: await mongodb.connect()
            
            # --- Collection: document_metadata (TOC) ---
            meta_coll = mongodb.get_collection("document_metadata")
            doc_meta = await meta_coll.find_one({"filename": namespace})
            if doc_meta:
                job_id = doc_meta.get("job_id")
                await meta_coll.delete_one({"filename": namespace})
                logger.info("Deleted document_metadata", filename=namespace)

            # --- Collection: extraction_results (Camelot tables) ---
            results_coll = mongodb.get_collection("extraction_results")
            res_delete = await results_coll.delete_many({"filename": namespace})
            logger.info("Deleted extraction_results", count=res_delete.deleted_count)

            # --- Collection: document_processing (Ingestion status/log) ---
            proc_coll = mongodb.get_collection("document_processing")
            await proc_coll.delete_many({"filename": namespace})
            logger.info("Deleted document_processing logs")
            
        except Exception as mongo_err:
            logger.warning("MongoDB cleanup encountered issues", error=str(mongo_err))

        # 2. Pinecone Vector Deletion
        try:
            vector_store_service.delete_vectors(
                settings.PINECONE_INDEX, 
                namespace, 
                host=settings.PINECONE_INDEX_HOST
            )
            logger.info("Deleted vectors from Pinecone", namespace=namespace)
        except Exception as pc_err:
            logger.warning("Pinecone vector deletion failed", error=str(pc_err))

        # 3. Azure Blob Purge (Visuals)
        if job_id:
            try:
                visuals_prefix = f"visuals/{job_id}/"
                await s3_service.delete_prefix(visuals_prefix)
                logger.info("Deleted visuals from Azure Blob Storage", prefix=visuals_prefix)
            except Exception as s3_err:
                logger.warning("Azure visuals purge failed", error=str(s3_err))

        return {
            "status": "success",
            "message": f"All data for {namespace} has been purged across AI systems.",
            "job_id_used": job_id
        }
        
    except Exception as e:
        logger.error("Cascading deletion failed", error=str(e), filename=namespace)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/news", response_model=JobResponse, status_code=status.HTTP_202_ACCEPTED)
async def submit_news_job(request: NewsJobRequest) -> JobResponse:
    """
    Submit news article processing job.
    """
    try:
        job_id = str(uuid.uuid4())
        
        logger.info(
            "News job submitted",
            job_id=job_id,
            article_url=request.article_url
        )
        
        celery_app.send_task(
            "process_news_article",
            args=[request.article_url, job_id, request.metadata],
            task_id=job_id
        )
        
        return JobResponse(
            job_id=job_id,
            status="accepted",
            message="News processing job enqueued successfully"
        )
    
    except Exception as e:
        logger.error("Failed to submit news job", error=str(e), exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to enqueue job: {str(e)}"
        )


@router.post("/summary", response_model=JobResponse, status_code=status.HTTP_202_ACCEPTED)
async def submit_summary_job(request: SummaryJobRequest) -> JobResponse:
    """
    Submit summary generation job.
    """
    try:
        job_id = str(uuid.uuid4())
        
        # Prepare metadata - prioritize top-level fields but fallback to nested metadata
        task_metadata = request.metadata or {}
        
        # Ensure critical fields for BackendNotifier are present 
        final_auth = request.authorization or task_metadata.get("authorization")
        final_doc_id = request.documentId or task_metadata.get("documentId")
        final_domain_id = request.domainId or task_metadata.get("domainId")
        
        task_metadata.update({
            "authorization": final_auth,
            "documentId": final_doc_id,
            "domainId": final_domain_id
        })
        
        print(f"DEBUG: Entering submit_summary_job for {request.namespace}")
        logger.info(
            "Summary job submitted",
            job_id=job_id,
            namespace=request.namespace,
            doc_type=request.doc_type
        )
        
        print("DEBUG: Sending task to Celery...")
        celery_app.send_task(
            "generate_summary",
            args=[request.namespace, request.doc_type, job_id, task_metadata],
            task_id=job_id
        )
        print("DEBUG: Celery task sent successfully!")
        
        return JobResponse(
            job_id=job_id,
            status="accepted",
            message="Summary generation job enqueued successfully"
        )
    
    except Exception as e:
        logger.error("Failed to submit summary job", error=str(e), exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to enqueue job: {str(e)}"
        )


@router.post("/comparison", response_model=JobResponse, status_code=status.HTTP_202_ACCEPTED)
async def submit_comparison_job(request: ComparisonJobRequest) -> JobResponse:
    """
    Submit DRHP vs RHP comparison job.
    """
    try:
        job_id = str(uuid.uuid4())
        
        # Prepare metadata for worker
        worker_metadata = request.metadata or {}
        
        final_auth = request.authorization or worker_metadata.get("authorization")
        final_domain_id = request.domainId or worker_metadata.get("domainId")
        
        worker_metadata.update({
            "authorization": final_auth,
            "sessionId": request.sessionId,
            "drhpDocumentId": request.drhpDocumentId,
            "rhpDocumentId": request.rhpDocumentId,
            "domain": request.domain,
            "domainId": final_domain_id
        })
        
        logger.info(
            "Comparison job submitted",
            job_id=job_id,
            drhp=request.drhpNamespace,
            rhp=request.rhpNamespace
        )
        
        celery_app.send_task(
            "generate_comparison",
            args=[request.drhpNamespace, request.rhpNamespace, job_id, worker_metadata],
            task_id=job_id
        )
        
        return JobResponse(
            job_id=job_id,
            status="accepted",
            message="Comparison generation job enqueued successfully"
        )
    
    except Exception as e:
        logger.error("Failed to submit comparison job", error=str(e), exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to enqueue job: {str(e)}"
        )


@router.get("/{job_id}", response_model=JobStatusResponse)
async def get_job_status(job_id: str) -> JobStatusResponse:
    """
    Get job status and result.
    """
    try:
        # Get task result from Celery
        task_result = celery_app.AsyncResult(job_id)
        
        response = JobStatusResponse(
            job_id=job_id,
            state=task_result.state,
        )
        
        if task_result.successful():
            response.result = task_result.result
        elif task_result.failed():
            response.error = str(task_result.info)
        
        return response
    
    except Exception as e:
        logger.error("Failed to get job status", job_id=job_id, error=str(e), exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get job status: {str(e)}"
        )
