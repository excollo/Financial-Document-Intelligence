import asyncio
import time
import traceback
from typing import Dict, Any, Optional
from celery import Task

from app.workers.celery_app import celery_app
from app.services.extraction import extraction_service
from app.services.chunking import chunking_service
from app.services.embedding import embedding_service
from app.services.vector_store import vector_store_service
from app.services.backend_notifier import backend_notifier
from app.db.mongo import mongodb
from app.core.config import settings
from app.core.logging import get_logger, log_job_start, log_job_complete, log_job_error

logger = get_logger(__name__)


@celery_app.task(bind=True, name="process_document", autoretry_for=(Exception,), retry_backoff=True, max_retries=3)
def process_document(
    self,
    file_url: str,
    file_type: str,
    job_id: str,
    metadata: Dict[str, Any] = None
) -> Dict[str, Any]:
    """
    Asynchronous Document Ingestion Task.
    Uses IngestionPipeline service for high-fidelity extraction (Tables + TOC).
    """
    from app.services.ingestion_pipeline import ingestion_pipeline
    import asyncio
    
    logger.info("Celery: Starting document ingestion task", job_id=job_id)
    metadata = metadata or {}
    
    try:
        # Run the async pipeline service in the sync Celery worker
        current_retry = int(getattr(self.request, "retries", 0))
        pipeline_metadata = {
            **metadata,
            "_celery_current_retry": current_retry,
            "_celery_max_retries": int(self.max_retries),
        }
        result = asyncio.run(ingestion_pipeline.process(
            file_url=file_url,
            file_type=file_type,
            job_id=job_id,
            metadata=pipeline_metadata
        ))
        
        logger.info("Celery: Document ingestion task successful", job_id=job_id)
        return result
    
    except Exception as e:
        logger.error("Celery: Document ingestion task FAILED", job_id=job_id, error=str(e))
        # Avoid premature "failed" status on transient retries.
        # Autoretry will rerun the task until max_retries is reached.
        current_retry = int(getattr(self.request, "retries", 0))
        if current_retry >= int(self.max_retries):
            backend_notifier.notify_status(
                job_id=job_id,
                status="failed",
                namespace=metadata.get("filename", "document.pdf") if metadata else "document.pdf",
                error={"message": str(e), "stack": traceback.format_exc()}
            )
        else:
            logger.warning(
                "Task failed but will retry; skipping terminal failed callback",
                job_id=job_id,
                current_retry=current_retry,
                max_retries=self.max_retries,
            )
        raise


@celery_app.task(name="process_news_article")
def process_news_article(
    article_url: str,
    job_id: str,
    metadata: Dict[str, Any] = None
) -> Dict[str, Any]:
    """
    Process news article pipeline.
    
    Args:
        article_url: URL to news article
        job_id: Unique job identifier
        metadata: Additional metadata
    
    Returns:
        Dict containing processing results
    """
    start_time = time.time()
    bound_logger = log_job_start(logger, job_id, "news_article_pipeline", article_url=article_url)
    
    try:
        # Placeholder implementation
        bound_logger.info("Processing news article", url=article_url)
        
        result = {
            "job_id": job_id,
            "status": "success",
            "article_url": article_url,
            "execution_time": time.time() - start_time
        }
        
        log_job_complete(bound_logger, job_id, result["execution_time"])
        return result
    
    except Exception as e:
        execution_time = time.time() - start_time
        log_job_error(bound_logger, job_id, e, execution_time)
        raise


@celery_app.task(name="generate_summary", bind=True)
def generate_summary(
    self,
    namespace: str,
    doc_type: str,
    job_id: str,
    metadata: Dict[str, Any] = None
) -> Dict[str, Any]:
    """
    Generate a full RHP/DRHP summary using the 2-stage agent pipeline.
    """
    from app.services.summarization.pipeline import summary_pipeline
    
    start_time = time.time()
    bound_logger = log_job_start(
        logger,
        job_id,
        "summary_generation",
        namespace=namespace,
        doc_type=doc_type
    )
    
    async def _run_summary():
        # Fetch Fund Configuration
        from app.services.fund_service import fund_service
        domain_id = metadata.get("domainId")
        fund_config = await fund_service.get_fund_config(domain_id) if domain_id else {}
        
        # Select correct index based on doc_type (Single Index Strategy)
        index_name = settings.PINECONE_INDEX
        host = settings.PINECONE_INDEX_HOST
        
        # Run the async pipeline with fund config
        return await summary_pipeline.generate_summary(
            namespace=namespace,
            domain_id=domain_id,
            doc_type=doc_type,
            tenant_config=fund_config,
            metadata=metadata,
            index_name=index_name,
            host=host
        )
    
    try:
        # Run in a single async context
        result = asyncio.run(_run_summary())
        
        # Notify Backend of Success - First create the record
        if result.get("status") == "success":
            # Use markdown if html is not provided (pipeline returns markdown)
            content = result.get("html") or result.get("markdown", "")
            
            created = backend_notifier.create_summary(
                title=f"Summary: {namespace}",
                content=content,
                document_id=metadata.get("documentId", ""),
                domain=metadata.get("domain", ""),
                domain_id=metadata.get("domainId", ""),
                workspace_id=metadata.get("workspaceId", ""),
                authorization=metadata.get("authorization", "")
            )
            if not created:
                logger.error("Failed to create summary in backend, check backend logs", namespace=namespace)
            else:
                logger.info("Summary created successfully in backend", namespace=namespace)
        
        # Then update the status to trigger UI refresh
        pipeline_status = result.get("status", "error")
        job_status = "completed" if pipeline_status == "success" else "failed"
        
        backend_notifier.update_summary_status(
            job_id=job_id,
            status=job_status,
            namespace=namespace,
            authorization=metadata.get("authorization", "")
        )
        
        execution_time = time.time() - start_time
        
        # Extract usage metrics
        usage = result.get("usage", {})
        input_tokens = usage.get("input", 0)
        output_tokens = usage.get("output", 0)
        total_tokens = input_tokens + output_tokens
        
        log_job_complete(
            bound_logger, 
            job_id, 
            execution_time, 
            total_tokens=total_tokens,
            input_tokens=input_tokens,
            output_tokens=output_tokens
        )
        
        return {
            "job_id": job_id,
            "status": "success",
            "namespace": namespace,
            "duration": execution_time,
            "result": result
        }
    
    except Exception as e:
        execution_time = time.time() - start_time
        log_job_error(bound_logger, job_id, e, execution_time)
        
        # Notify Backend of Failure
        backend_notifier.update_summary_status(
            job_id=job_id,
            status="failed",
            namespace=namespace,
            error={"message": str(e), "stack": traceback.format_exc(), "timestamp": str(time.time())},
            authorization=metadata.get("authorization", "")
        )
        raise
@celery_app.task(name="generate_comparison", bind=True)
def generate_comparison(
    self,
    drhp_namespace: str,
    rhp_namespace: str,
    job_id: str,
    metadata: Dict[str, Any] = None
) -> Dict[str, Any]:
    """
    Generate a comparison report between DRHP and RHP.
    """
    from app.services.comparison.pipeline import comparison_pipeline
    
    start_time = time.time()
    metadata = metadata or {}
    authorization = metadata.get("authorization", "")
    session_id = metadata.get("sessionId", "")
    drhp_id = metadata.get("drhpDocumentId", "")
    rhp_id = metadata.get("rhpDocumentId", "")
    domain = metadata.get("domain", "")
    domain_id = metadata.get("domainId", "")
    
    bound_logger = log_job_start(
        logger,
        job_id,
        "comparison_generation",
        drhp=drhp_namespace,
        rhp=rhp_namespace
    )
    
    try:
        # 1. Run Pipeline
        # Create specialized filters for DRHP and RHP to match n8n logic
        drhp_filter = {"type": "DRHP"}
        if domain_id: drhp_filter["domainId"] = domain_id
        if drhp_id: drhp_filter["documentId"] = drhp_id
        
        rhp_filter = {"type": "RHP"}
        if domain_id: rhp_filter["domainId"] = domain_id
        if rhp_id: rhp_filter["documentId"] = rhp_id
        
        result = asyncio.run(comparison_pipeline.compare(
            drhp_namespace=drhp_namespace,
            rhp_namespace=rhp_namespace,
            drhp_filter=drhp_filter,
            rhp_filter=rhp_filter
        ))
        
        if result["status"] == "success":
            # 2. Create Report in Backend
            backend_notifier.create_report(
                drhp_namespace=drhp_namespace,
                drhp_id=drhp_id,
                title=f"Comparison: {drhp_namespace} vs {rhp_namespace}",
                content=result["html"],
                session_id=session_id,
                rhp_namespace=rhp_namespace,
                rhp_id=rhp_id,
                domain=domain,
                domain_id=domain_id,
                workspace_id=metadata.get("workspaceId", ""),
                authorization=authorization
            )
            
            # 3. Update Status
            backend_notifier.update_report_status(
                job_id=job_id,
                namespace=drhp_namespace,
                status="success",
                authorization=authorization
            )
        else:
            raise Exception(result.get("message", "Comparison failed"))

        execution_time = time.time() - start_time
        log_job_complete(bound_logger, job_id, execution_time)
        
        return {
            "job_id": job_id,
            "status": "success",
            "duration": execution_time,
            "markdown": result.get("markdown"),
            "html": result.get("html"),
            "usage": result.get("usage")
        }
    
    except Exception as e:
        execution_time = time.time() - start_time
        log_job_error(bound_logger, job_id, e, execution_time)
        
        # Notify Backend of Failure
        backend_notifier.update_report_status(
            job_id=job_id,
            namespace=drhp_namespace,
            status="failed",
            error={"message": str(e), "stack": traceback.format_exc(), "timestamp": str(time.time())},
            authorization=authorization
        )
        raise
