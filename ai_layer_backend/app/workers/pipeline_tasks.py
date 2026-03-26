"""
Celery task for the new document processing pipeline.
"""
import asyncio
from typing import Dict, Any
from app.workers.celery_app import celery_app
from app.workers.job_context import JobContext
from app.workers.orchestrator import PipelineOrchestrator
from app.core.logging import get_logger
from app.db.mongo import mongodb

logger = get_logger(__name__)


@celery_app.task(name="process_pipeline_job", bind=True)
def process_pipeline_job(self, job_data: Dict[str, Any]):
    """
    Entry point for the document processing pipeline.
    Wraps the async orchestrator in a synchronous Celery task.
    """
    job_id = job_data.get('job_id')
    tenant_id = job_data.get('tenant_id')
    sop_config_id = job_data.get('sop_config_id')
    
    logger.info("Process pipeline job task started", job_id=job_id, tenant_id=tenant_id)
    
    # Run the async orchestrator
    return asyncio.run(_run_orchestrator(job_data))


async def _run_orchestrator(job_data: Dict[str, Any]):
    """Helper to run the pipeline orchestrator within an event loop."""
    job_id = job_data['job_id']
    tenant_id = job_data['tenant_id']
    
    # Ensure MongoDB async connection
    if mongodb.db is None:
        await mongodb.connect()
    
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
