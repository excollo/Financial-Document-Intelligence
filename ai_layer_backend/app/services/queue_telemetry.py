import time
import os
from typing import Dict, Any

import redis

from app.core.config import settings
from app.core.logging import get_logger
from app.services.metrics import metrics

logger = get_logger(__name__)

AGE_SET_PREFIX = "celery:queue:enqueued_at"
ENTRY_TTL_SECONDS = int(os.environ.get("QUEUE_TELEMETRY_ENTRY_TTL_SECONDS", "1800"))


class QueueTelemetryService:
    def __init__(self) -> None:
        self._redis = None

    def _client(self):
        if self._redis is None:
            self._redis = redis.from_url(settings.CELERY_BROKER_URL, socket_connect_timeout=2, socket_timeout=2)
        return self._redis

    def mark_enqueued(self, queue_name: str, job_id: str) -> None:
        try:
            self._prune_stale(queue_name)
            now_ms = int(time.time() * 1000)
            self._client().zadd(f"{AGE_SET_PREFIX}:{queue_name}", {job_id: now_ms})
        except Exception as exc:
            logger.warning("queue telemetry enqueue mark failed", queue_name=queue_name, job_id=job_id, error=str(exc))

    def mark_dequeued(self, queue_name: str, job_id: str) -> None:
        try:
            self._client().zrem(f"{AGE_SET_PREFIX}:{queue_name}", job_id)
        except Exception as exc:
            logger.warning("queue telemetry dequeue mark failed", queue_name=queue_name, job_id=job_id, error=str(exc))

    def _prune_stale(self, queue_name: str) -> None:
        cutoff_ms = int((time.time() - ENTRY_TTL_SECONDS) * 1000)
        self._client().zremrangebyscore(f"{AGE_SET_PREFIX}:{queue_name}", 0, cutoff_ms)

    def snapshot(self, queue_name: str) -> Dict[str, Any]:
        client = self._client()
        self._prune_stale(queue_name)
        depth = int(client.llen(queue_name) or 0)
        oldest = client.zrange(f"{AGE_SET_PREFIX}:{queue_name}", 0, 0, withscores=True)
        oldest_ts_ms = int(oldest[0][1]) if oldest else 0
        age_seconds = max(0, int((time.time() * 1000 - oldest_ts_ms) / 1000)) if oldest_ts_ms else 0
        metrics.emit("queue_depth", depth, {"queue_name": queue_name, "source": "redis_broker"})
        metrics.emit("queue_age_seconds", age_seconds, {"queue_name": queue_name, "source": "redis_broker"})
        return {"queue_name": queue_name, "queue_depth": depth, "queue_age_seconds": age_seconds}


queue_telemetry_service = QueueTelemetryService()
