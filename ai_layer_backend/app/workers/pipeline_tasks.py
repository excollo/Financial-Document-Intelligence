"""
Celery task for the new document processing pipeline.
"""
import asyncio
import time
import os
from typing import Dict, Any
from app.workers.celery_app import celery_app
from app.workers.job_context import JobContext
from app.workers.orchestrator import PipelineOrchestrator
from app.core.logging import get_logger
from app.db.mongo import mongodb
from app.services.metrics import metrics
from app.services.queue_telemetry import queue_telemetry_service
from app.services.execution_claim import execution_claim_service
from app.services.job_state_guard import is_terminal_job

logger = get_logger(__name__)


@celery_app.task(name="process_pipeline_job", bind=True, max_retries=3)
def process_pipeline_job(self, job_data: Dict[str, Any]):
    """
    Entry point for the document processing pipeline.
    Wraps the async orchestrator in a synchronous Celery task.
    """
    job_id = job_data.get('job_id')
    tenant_id = job_data.get('tenant_id')
    queue_name = job_data.get("queue_name") or "heavy_jobs"
    queue_telemetry_service.mark_dequeued(queue_name, job_id)
    queue_telemetry_service.snapshot("heavy_jobs")
    queue_telemetry_service.snapshot("light_jobs")
    logger.info("Process pipeline job task started", job_id=job_id, tenant_id=tenant_id, trace_id=job_id)
    metrics.emit_worker_memory({"job_id": job_id})
    start = time.time()
    try:
        # Run the async orchestrator
        return asyncio.run(_run_orchestrator(job_data))
    except Exception as exc:
        current_retry = int(getattr(self.request, "retries", 0))
        classification = metrics.classify_error(exc)
        metrics.emit("retry_count", current_retry, {"job_id": job_id, "classification": classification})
        if classification == "transient" and current_retry < int(self.max_retries):
            countdown = metrics.backoff_with_jitter_seconds(current_retry)
            raise self.retry(exc=exc, countdown=countdown)
        raise
    finally:
        metrics.emit("job_runtime_ms", int((time.time() - start) * 1000), {"job_id": job_id})


async def _run_orchestrator(job_data: Dict[str, Any]):
    """Helper to run the pipeline orchestrator within an event loop."""
    job_id = job_data['job_id']
    tenant_id = job_data['tenant_id']
    
    # Ensure MongoDB async connection
    if mongodb.db is None:
        await mongodb.connect()
    if await is_terminal_job(job_id, tenant_id):
        logger.warning("Skipping process_pipeline_job because job already terminal", job_id=job_id, tenant_id=tenant_id)
        return {"status": "duplicate_ignored", "job_id": job_id}

    claimed, worker_claim_id = await execution_claim_service.try_claim(
        task_name="process_pipeline_job",
        job_id=job_id,
        scope=tenant_id,
    )
    if not claimed:
        jobs_collection = mongodb.get_collection("jobs")
        existing = await jobs_collection.find_one(
            {"id": job_id, "tenant_id": tenant_id},
            {"status": 1},
        )
        logger.warning(
            "Skipping duplicate execution because claim failed",
            job_id=job_id,
            status=(existing or {}).get("status"),
            existing_claim=(existing or {}).get("execution_claimed_by"),
            claim_expires_at=(existing or {}).get("claim_expires_at"),
        )
        if existing and existing.get("status") in {"completed", "completed_with_errors"}:
            logger.warning("Skipping duplicate execution for already terminal job", job_id=job_id)
        return {"status": "duplicate_ignored", "job_id": job_id}
    
    async def _renew_loop():
        interval = int(max(5, min(60, int(int(os.environ.get("EXECUTION_CLAIM_LEASE_SECONDS", "3600")) / 3))))
        while True:
            await asyncio.sleep(interval)
            renewed = await execution_claim_service.renew_claim(
                task_name="process_pipeline_job",
                job_id=job_id,
                claim_id=worker_claim_id,
                scope=tenant_id,
            )
            if not renewed:
                logger.warning("Execution claim renewal failed; claim may have expired", job_id=job_id)
                return

    renew_task = asyncio.create_task(_renew_loop())

    # 1. Fetch SopConfig from MongoDB
    sop_config = None
    try:
        collection = mongodb.get_collection("sopconfigs") # Mongoose pluralizes SopConfig -> sopconfigs
        
        sop_config_id = job_data.get('sop_config_id')
        if sop_config_id:
            logger.info(f"Fetching specific SOP config: {sop_config_id}", job_id=job_id)
            # Find by id (UUID) or _id if it's an ObjectId string
            sop_config = await collection.find_one({"id": sop_config_id, "tenant_id": tenant_id})
        else:
            logger.info(f"Fetching active SOP config for tenant: {tenant_id}", job_id=job_id)
            sop_config = await collection.find_one({"tenant_id": tenant_id, "is_active": True})
            
        if not sop_config:
            logger.warning(f"No SOP config found for tenant {tenant_id}. Using defaults.", job_id=job_id)

    except Exception as e:
        logger.error(f"Failed to fetch SOP config: {e}", job_id=job_id)

    # 2. Initialize Context and Orchestrator
    ctx = JobContext(
        job_id=job_id,
        tenant_id=tenant_id,
        workspace_id=str(job_data.get("workspace_id") or job_data.get("workspaceId") or ""),
        domain_id=str(job_data.get("domain_id") or job_data.get("domainId") or tenant_id),
        sop_config=sop_config,
        document_name=job_data.get('document_name'),
        s3_input_key=job_data.get('s3_input_key')
    )
    
    orchestrator = PipelineOrchestrator(ctx)
    
    # 3. Execute
    try:
        await orchestrator.run()
        return {"status": "success", "job_id": job_id}
    except Exception as e:
        # Errors are handled within orchestrator.run() and reported to Node.
        # We re-raise to signal Celery task failure.
        raise e
    finally:
        renew_task.cancel()
        try:
            await renew_task
        except asyncio.CancelledError:
            pass
        await execution_claim_service.release_claim(
            task_name="process_pipeline_job",
            job_id=job_id,
            claim_id=worker_claim_id,
            scope=tenant_id,
        )
