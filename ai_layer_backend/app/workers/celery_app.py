"""
Celery application configuration.
Production-ready config with ENV fallback + debug logging.
"""

import os
import time
from celery import Celery
from celery.signals import task_prerun, task_postrun, task_failure
from celery.schedules import crontab

from app.core.logging import get_logger

logger = get_logger(__name__)

from app.core.config import settings

# ✅ Use settings (loads from .env automatically via Pydantic)
BROKER_URL = settings.CELERY_BROKER_URL
RESULT_BACKEND = settings.CELERY_RESULT_BACKEND

if not BROKER_URL:
    raise ValueError("❌ CELERY_BROKER_URL or REDIS_URL is not set in settings!")

logger.info(f"Using Celery Broker: {BROKER_URL.split('@')[-1] if '@' in BROKER_URL else BROKER_URL}")

# ✅ Startup Diagnostic: Verify Redis connectivity (Non-blocking)
def check_redis_connectivity():
    import redis
    try:
        # Use a very short timeout for the initial boot check
        r = redis.from_url(BROKER_URL, socket_connect_timeout=2, socket_timeout=2)
        r.ping()
        logger.info("📡 Redis Connectivity: SUCCESS")
    except Exception as e:
        logger.warning(f"📡 Redis Connectivity: PENDING (Worker will retry automatically) - {str(e)}")

# Run check but don't let it crash the boot
if os.environ.get("SKIP_REDIS_CHECK") != "true":
    check_redis_connectivity()

# ✅ Create Celery app
celery_app = Celery(
    "ai_platform_workers",
    broker=BROKER_URL,
    backend=RESULT_BACKEND,
)

# ✅ Basic Config (safe defaults)
celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,

    task_track_started=True,
    task_time_limit=3600,
    task_soft_time_limit=3300,
    task_default_queue=settings.CELERY_TASK_DEFAULT_QUEUE,
    task_default_exchange=settings.CELERY_TASK_DEFAULT_EXCHANGE,
    task_default_routing_key=settings.CELERY_TASK_DEFAULT_ROUTING_KEY,

    worker_concurrency=settings.CELERY_WORKER_CONCURRENCY,
    worker_prefetch_multiplier=1,
    worker_max_tasks_per_child=settings.CELERY_WORKER_MAX_TASKS_PER_CHILD,
    worker_max_memory_per_child=settings.CELERY_WORKER_MAX_MEMORY_PER_CHILD,

    # Hotfix: avoid endless re-queue loop when worker is OOM-killed (SIGKILL).
    # We'll fail the task instead of auto-replaying the same heavy job forever.
    task_acks_late=False,
    task_reject_on_worker_lost=False,

    # Connection and Transport Resilience
    broker_connection_retry_on_startup=True,
    broker_connection_timeout=10,  # Don't wait forever
    broker_transport_options={
        "socket_timeout": 5,      # Timeout for individual operations
        "socket_connect_timeout": 5, # Timeout for initial connection
        "visibility_timeout": 3600,  # 1 hour
        "retry_on_timeout": True,
    },
)

# ✅ Auto-discover tasks
import app.workers.document_pipeline
import app.workers.news_tasks
import app.workers.pipeline_tasks

celery_app.autodiscover_tasks(['app.workers'])

# ✅ Scheduled tasks
celery_app.conf.beat_schedule = {
    'daily-news-monitor-8am': {
        'task': 'run_daily_news_monitor',
        'schedule': crontab(hour=8, minute=0),
    },
}

# ==========================================
# SIGNALS (LOGGING)
# ==========================================

@task_prerun.connect
def task_prerun_handler(sender=None, task_id=None, task=None, **kwargs):
    logger.info(
        f"🚀 Task started: {task.name} | ID: {task_id}"
    )


@task_postrun.connect
def task_postrun_handler(sender=None, task_id=None, task=None, state=None, **kwargs):
    # task_postrun fires for SUCCESS/RETRY/FAILURE; log status explicitly to avoid false positives.
    if state == "SUCCESS":
        logger.info(f"✅ Task completed: {task.name} | ID: {task_id}")
    elif state == "RETRY":
        logger.warning(f"🔁 Task retry scheduled: {task.name} | ID: {task_id}")
    else:
        logger.warning(f"ℹ️ Task finished with state={state}: {task.name} | ID: {task_id}")


@task_failure.connect
def task_failure_handler(sender=None, task_id=None, exception=None, traceback=None, **kwargs):
    logger.error(
        f"❌ Task failed: {sender.name} | ID: {task_id} | Error: {str(exception)}",
        exc_info=True
    )
