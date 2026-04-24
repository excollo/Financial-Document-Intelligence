"""
Celery application configuration.
Production-ready config with ENV fallback + debug logging.
"""

import os
import time
from typing import Optional
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse
from celery import Celery
from celery.signals import task_prerun, task_postrun, task_failure
from celery.schedules import crontab
from kombu import Queue

from app.core.logging import get_logger
from app.core.config import settings
from app.workers.redis_tls import build_rediss_ssl_options

logger = get_logger(__name__)

# Handle accidental "KEY=value" strings in env var values.
def _strip_env_assignment_prefix(url: Optional[str]) -> Optional[str]:
    if not url:
        return url
    value = url.strip()
    for prefix in ("CELERY_BROKER_URL=", "CELERY_RESULT_BACKEND=", "REDIS_URL="):
        if value.startswith(prefix):
            logger.warning("Detected malformed Redis/Celery URL with assignment prefix; normalizing value")
            return value[len(prefix):].strip()
    return value


# Ensure rediss URLs include ssl_cert_reqs so Celery/redis backend can initialize.
def _normalize_rediss_url(url: Optional[str]) -> Optional[str]:
    if not url:
        return url

    url = _strip_env_assignment_prefix(url)
    if not url or not url.startswith("rediss://"):
        return url

    parsed = urlparse(url)
    query = parse_qs(parsed.query, keep_blank_values=True)
    if "ssl_cert_reqs" in query:
        return url
    return urlunparse(parsed._replace(query=urlencode(query, doseq=True)))


_raw_broker = (settings.CELERY_BROKER_URL or "").strip() or os.getenv("CELERY_BROKER_URL") or os.getenv("REDIS_URL")
_raw_backend = (settings.CELERY_RESULT_BACKEND or "").strip() or os.getenv("CELERY_RESULT_BACKEND") or _raw_broker

BROKER_URL = _normalize_rediss_url(_raw_broker or None)
RESULT_BACKEND = _normalize_rediss_url(_raw_backend or None)

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
    task_queues=(
        Queue("heavy_jobs"),
        Queue("light_jobs"),
    ),
    task_routes={
        "process_pipeline_job": {"queue": "heavy_jobs"},
        "process_document": {"queue": "heavy_jobs"},
        "generate_summary": {"queue": "light_jobs"},
        "generate_comparison": {"queue": "light_jobs"},
        "process_news_article": {"queue": "light_jobs"},
    },
)

_broker_ssl_options = build_rediss_ssl_options(
    url=BROKER_URL,
    is_production=settings.is_production,
    ca_bundle_path=settings.REDIS_TLS_CA_BUNDLE,
)
if _broker_ssl_options:
    celery_app.conf.broker_use_ssl = _broker_ssl_options
_backend_ssl_options = build_rediss_ssl_options(
    url=RESULT_BACKEND,
    is_production=settings.is_production,
    ca_bundle_path=settings.REDIS_TLS_CA_BUNDLE,
)
if _backend_ssl_options:
    celery_app.conf.redis_backend_use_ssl = _backend_ssl_options
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
