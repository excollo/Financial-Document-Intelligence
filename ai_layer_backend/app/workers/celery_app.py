"""
Celery application configuration.
Configures Celery with Redis backend and task autodiscovery.
"""
import time
from celery import Celery
from celery.signals import task_prerun, task_postrun, task_failure
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

# Create Celery app
celery_app = Celery(
    "ai_platform_workers",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
)

# Configure Celery
celery_app.conf.update(
    task_serializer=settings.CELERY_TASK_SERIALIZER,
    result_serializer=settings.CELERY_RESULT_SERIALIZER,
    accept_content=settings.CELERY_ACCEPT_CONTENT,
    timezone=settings.CELERY_TIMEZONE,
    enable_utc=settings.CELERY_ENABLE_UTC,
    task_track_started=True,
    task_time_limit=3600,  # 1 hour max
    task_soft_time_limit=3300,  # 55 minutes soft limit
    worker_prefetch_multiplier=1,
    worker_max_tasks_per_child=100,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    # SSL/TLS Support for Secure Redis (Upstash)
    broker_use_ssl={'ssl_cert_reqs': 'none'} if settings.CELERY_BROKER_URL.startswith('rediss://') else None,
    redis_backend_use_ssl={'ssl_cert_reqs': 'none'} if settings.CELERY_RESULT_BACKEND.startswith('rediss://') else None,
)

# Auto-discover tasks
# Import tasks explicitly to ensure they are registered
import app.workers.document_pipeline
import app.workers.news_tasks
import app.workers.pipeline_tasks

celery_app.autodiscover_tasks(['app.workers'])

# Schedule for Daily News Monitor (12 PM Daily)
from celery.schedules import crontab
celery_app.conf.beat_schedule = {
    'daily-news-monitor-8am': {
        'task': 'run_daily_news_monitor',
        'schedule': crontab(hour=8, minute=0),
    },
}


@task_prerun.connect
def task_prerun_handler(sender=None, task_id=None, task=None, args=None, kwargs=None, **extra):
    """Log task start."""
    logger.info(
        event="Task started",
        task_id=task_id,
        task_name=task.name,
        environment=settings.APP_ENV
    )


@task_postrun.connect
def task_postrun_handler(sender=None, task_id=None, task=None, args=None, kwargs=None, retval=None, **extra):
    """Log task completion."""
    logger.info(
        event="Task completed",
        task_id=task_id,
        task_name=task.name
    )


@task_failure.connect
def task_failure_handler(sender=None, task_id=None, exception=None, args=None, kwargs=None, traceback=None, einfo=None, **extra):
    """Log task failure and notify backend."""
    from app.services.backend_notifier import backend_notifier
    
    error_msg = str(exception)
    logger.error(
        event="Task failed",
        task_id=task_id,
        task_name=sender.name,
        error=error_msg,
        error_type=type(exception).__name__,
        exc_info=True
    )
    
    # Attempt to extract job_id and namespace/filename from args/kwargs
    # generate_summary(namespace, doc_type, job_id, metadata) -> args[0] is namespace, args[2] is job_id
    # process_document(file_url, file_type, job_id, metadata) -> args[2] is job_id, metadata.filename or args[4]
    
    job_id = kwargs.get('job_id') if kwargs else None
    namespace = kwargs.get('namespace') if kwargs else None
    metadata = kwargs.get('metadata', {}) if kwargs else {}
    
    if not job_id and args and len(args) >= 3:
        # For generate_summary and process_document, job_id is usually at index 2
        job_id = args[2]
        
    if not namespace and args and len(args) >= 1:
        # For generate_summary, namespace is at index 0
        namespace = args[0]
        
    if not namespace and metadata:
        namespace = metadata.get('filename') or metadata.get('namespace')

    if job_id:
        error_data = {
            "message": f"Task {sender.name} failed: {error_msg}",
            "stack": str(traceback) if traceback else None,
            "timestamp": str(time.time())
        }
        
        # Decide which status endpoint to use based on task name
        if sender.name == "generate_summary":
            backend_notifier.update_summary_status(
                job_id=job_id,
                namespace=namespace or "unknown",
                status="failed",
                error=error_data
            )
        elif sender.name == "generate_comparison":
            backend_notifier.update_report_status(
                job_id=job_id,
                namespace=namespace or "unknown",
                status="failed",
                error=error_data
            )
        else:
            # Default to document status update
            backend_notifier.notify_status(
                job_id=job_id,
                status="failed",
                namespace=namespace or "document",
                error=error_data
            )
