import asyncio
import time
import traceback
import threading
import os
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
from app.services.metrics import metrics
from app.services.execution_claim import execution_claim_service
from app.services.job_state_guard import is_terminal_job

logger = get_logger(__name__)


def _start_claim_heartbeat(task_name: str, job_id: str, claim_id: str, scope: str):
    lease_seconds = int(os.environ.get("EXECUTION_CLAIM_LEASE_SECONDS", "3600"))
    interval = int(max(5, min(60, lease_seconds / 3)))
    stop_event = threading.Event()

    def _runner():
        while not stop_event.wait(interval):
            try:
                renewed = asyncio.run(
                    execution_claim_service.renew_claim(task_name, job_id, claim_id, scope=scope)
                )
                if not renewed:
                    logger.warning(
                        "Execution claim heartbeat failed; claim not renewed",
                        task_name=task_name,
                        job_id=job_id,
                        scope=scope,
                    )
                    return
            except Exception as exc:
                logger.warning(
                    "Execution claim heartbeat error",
                    task_name=task_name,
                    job_id=job_id,
                    scope=scope,
                    error=str(exc),
                )
                return

    thread = threading.Thread(target=_runner, daemon=True)
    thread.start()
    return stop_event


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
    
    logger.info("Celery: Starting document ingestion task", job_id=job_id, trace_id=job_id)
    metrics.emit_worker_memory({"job_id": job_id, "task": "process_document"})
    metadata = metadata or {}
    domain_scope = str(metadata.get("domainId") or "global")
    if asyncio.run(is_terminal_job(job_id, metadata.get("domainId"))):
        logger.warning("Skipping process_document because job already terminal", job_id=job_id, scope=domain_scope)
        return {"status": "duplicate_ignored", "job_id": job_id}
    claimed, claim_id = asyncio.run(
        execution_claim_service.try_claim("process_document", job_id, scope=domain_scope)
    )
    if not claimed:
        logger.warning("Skipping duplicate process_document execution", job_id=job_id, scope=domain_scope)
        return {"status": "duplicate_ignored", "job_id": job_id}
    heartbeat = _start_claim_heartbeat("process_document", job_id, claim_id, domain_scope)
    started = time.time()
    
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
        metrics.emit("job_runtime_ms", int((time.time() - started) * 1000), {"job_id": job_id, "task": "process_document"})
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
                workspace_id=(metadata or {}).get("workspaceId"),
                domain_id=(metadata or {}).get("domainId"),
                error={"message": str(e), "stack": traceback.format_exc()}
            )
        else:
            logger.warning(
                "Task failed but will retry; skipping terminal failed callback",
                job_id=job_id,
                current_retry=current_retry,
                max_retries=self.max_retries,
            )
        metrics.emit(
            "retry_count",
            current_retry,
            {"job_id": job_id, "classification": metrics.classify_error(e), "task": "process_document"},
        )
        raise
    finally:
        heartbeat.set()
        asyncio.run(
            execution_claim_service.release_claim(
                "process_document",
                job_id,
                claim_id,
                scope=domain_scope,
            )
        )


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
    metrics.emit_worker_memory({"job_id": job_id, "task": "generate_summary"})
    metadata = metadata or {}
    domain_scope = str((metadata or {}).get("domainId") or "global")
    if asyncio.run(is_terminal_job(job_id, (metadata or {}).get("domainId"))):
        logger.warning("Skipping generate_summary because job already terminal", job_id=job_id, scope=domain_scope)
        return {"status": "duplicate_ignored", "job_id": job_id}
    claimed, claim_id = asyncio.run(
        execution_claim_service.try_claim("generate_summary", job_id, scope=domain_scope)
    )
    if not claimed:
        logger.warning("Skipping duplicate generate_summary execution", job_id=job_id, scope=domain_scope)
        return {"status": "duplicate_ignored", "job_id": job_id}
    heartbeat = _start_claim_heartbeat("generate_summary", job_id, claim_id, domain_scope)
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
            authorization=metadata.get("authorization", ""),
            workspace_id=metadata.get("workspaceId", ""),
            domain_id=metadata.get("domainId", ""),
        )
        
        execution_time = time.time() - start_time
        metrics.emit("stage_duration_ms", int(execution_time * 1000), {"job_id": job_id, "stage_name": "summary", "status": "success"})
        metrics.emit("job_runtime_ms", int(execution_time * 1000), {"job_id": job_id, "task": "generate_summary"})
        
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
        metrics.emit("stage_duration_ms", int(execution_time * 1000), {"job_id": job_id, "stage_name": "summary", "status": "failed"})
        log_job_error(bound_logger, job_id, e, execution_time)
        
        # Notify Backend of Failure
        backend_notifier.update_summary_status(
            job_id=job_id,
            status="failed",
            namespace=namespace,
            error={"message": str(e), "stack": traceback.format_exc(), "timestamp": str(time.time())},
            authorization=metadata.get("authorization", ""),
            workspace_id=metadata.get("workspaceId", ""),
            domain_id=metadata.get("domainId", ""),
        )
        raise
    finally:
        heartbeat.set()
        asyncio.run(
            execution_claim_service.release_claim(
                "generate_summary",
                job_id,
                claim_id,
                scope=domain_scope,
            )
        )
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
    metrics.emit_worker_memory({"job_id": job_id, "task": "generate_comparison"})
    metadata = metadata or {}
    domain_scope = str(metadata.get("domainId") or "global")
    if asyncio.run(is_terminal_job(job_id, metadata.get("domainId"))):
        logger.warning("Skipping generate_comparison because job already terminal", job_id=job_id, scope=domain_scope)
        return {"status": "duplicate_ignored", "job_id": job_id}
    claimed, claim_id = asyncio.run(
        execution_claim_service.try_claim("generate_comparison", job_id, scope=domain_scope)
    )
    if not claimed:
        logger.warning("Skipping duplicate generate_comparison execution", job_id=job_id, scope=domain_scope)
        return {"status": "duplicate_ignored", "job_id": job_id}
    heartbeat = _start_claim_heartbeat("generate_comparison", job_id, claim_id, domain_scope)
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
                status="completed",
                authorization=authorization,
                workspace_id=metadata.get("workspaceId", ""),
                domain_id=domain_id,
            )
        else:
            raise Exception(result.get("message", "Comparison failed"))

        execution_time = time.time() - start_time
        metrics.emit("stage_duration_ms", int(execution_time * 1000), {"job_id": job_id, "stage_name": "comparison", "status": "success"})
        metrics.emit("job_runtime_ms", int(execution_time * 1000), {"job_id": job_id, "task": "generate_comparison"})
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
        metrics.emit("stage_duration_ms", int(execution_time * 1000), {"job_id": job_id, "stage_name": "comparison", "status": "failed"})
        log_job_error(bound_logger, job_id, e, execution_time)
        
        # Notify Backend of Failure
        backend_notifier.update_report_status(
            job_id=job_id,
            namespace=drhp_namespace,
            status="failed",
            error={"message": str(e), "stack": traceback.format_exc(), "timestamp": str(time.time())},
            authorization=authorization,
            workspace_id=metadata.get("workspaceId", ""),
            domain_id=domain_id,
        )
        raise
    finally:
        heartbeat.set()
        asyncio.run(
            execution_claim_service.release_claim(
                "generate_comparison",
                job_id,
                claim_id,
                scope=domain_scope,
            )
        )
