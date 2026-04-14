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

    worker_prefetch_multiplier=1,
    worker_max_tasks_per_child=100,

    task_acks_late=True,
    task_reject_on_worker_lost=True,

    broker_connection_retry_on_startup=True,
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
def task_postrun_handler(sender=None, task_id=None, task=None, **kwargs):
    logger.info(
        f"✅ Task completed: {task.name} | ID: {task_id}"
    )


@task_failure.connect
def task_failure_handler(sender=None, task_id=None, exception=None, traceback=None, **kwargs):
    logger.error(
        f"❌ Task failed: {sender.name} | ID: {task_id} | Error: {str(exception)}",
        exc_info=True
    )
