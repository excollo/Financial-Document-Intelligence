import hashlib
import os
import time
import redis

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

WINDOW_SECONDS = int(os.environ.get("ALERT_AGG_WINDOW_SECONDS", "300"))
BURST_THRESHOLD = int(os.environ.get("ALERT_AGG_BURST_THRESHOLD", "5"))


class AlertAggregator:
    def __init__(self):
        self._redis = None

    def _client(self):
        if self._redis is None:
            self._redis = redis.from_url(settings.CELERY_BROKER_URL, socket_connect_timeout=2, socket_timeout=2)
        return self._redis

    def record_alert(self, *, alert_type: str, metric: str, severity: str, service: str) -> None:
        try:
            signature = f"{service}:{severity}:{alert_type}:{metric}"
            key_hash = hashlib.sha1(signature.encode("utf-8")).hexdigest()
            key = f"alert:agg:{key_hash}"
            count = int(self._client().incr(key))
            if count == 1:
                self._client().expire(key, WINDOW_SECONDS)

            payload = {
                "type": "alert_aggregate",
                "service": service,
                "severity": severity,
                "alert_type": alert_type,
                "metric": metric,
                "alert_count_window": count,
                "window_seconds": WINDOW_SECONDS,
                "ts": time.time(),
            }
            if count >= BURST_THRESHOLD:
                logger.warning("alert_burst_detected", threshold=BURST_THRESHOLD, **payload)
            else:
                logger.info("alert_count_window", **payload)
        except Exception as exc:
            logger.warning("alert aggregation failed", error=str(exc), metric=metric, alert_type=alert_type)


alert_aggregator = AlertAggregator()
