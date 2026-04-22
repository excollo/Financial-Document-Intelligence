import os
import time
import random
from typing import Dict, Any, Optional

import psutil
from app.core.logging import get_logger
from app.services.alert_aggregator import alert_aggregator

logger = get_logger(__name__)


class Metrics:
    def __init__(self) -> None:
        self.thresholds = {
            "queue_depth": float(os.environ.get("ALERT_QUEUE_DEPTH_THRESHOLD", "300")),
            "queue_age_seconds": float(os.environ.get("ALERT_QUEUE_AGE_SECONDS_THRESHOLD", "180")),
            "worker_rss_mb": float(os.environ.get("ALERT_WORKER_RSS_MB_THRESHOLD", "2048")),
            "retry_count": float(os.environ.get("ALERT_RETRY_COUNT_THRESHOLD", "3")),
            "job_runtime_ms": float(os.environ.get("ALERT_JOB_RUNTIME_MS_THRESHOLD", "900000")),
        }

    def emit(self, metric: str, value: float, tags: Optional[Dict[str, Any]] = None) -> None:
        logger.info(
            "metric",
            metric=metric,
            value=value,
            tags=tags or {},
            ts=time.time(),
        )
        threshold = self.thresholds.get(metric)
        if threshold is not None and value >= threshold:
            logger.warning(
                "alert_signal",
                signal=f"threshold_exceeded:{metric}",
                metric=metric,
                value=value,
                threshold=threshold,
                tags=tags or {},
                ts=time.time(),
            )
            alert_aggregator.record_alert(
                alert_type="threshold_exceeded",
                metric=metric,
                severity="warning",
                service="python",
            )

    def emit_worker_memory(self, tags: Optional[Dict[str, Any]] = None) -> None:
        process = psutil.Process(os.getpid())
        rss_mb = process.memory_info().rss / 1024 / 1024
        self.emit("worker_rss_mb", round(rss_mb, 2), tags or {})

    @staticmethod
    def classify_error(exc: Exception) -> str:
        transient_markers = (
            "timeout",
            "temporar",
            "connection reset",
            "rate limit",
            "503",
            "502",
            "504",
        )
        msg = str(exc).lower()
        return "transient" if any(marker in msg for marker in transient_markers) else "permanent"

    @staticmethod
    def backoff_with_jitter_seconds(retry_index: int, base: float = 1.0, cap: float = 60.0) -> float:
        exp = min(cap, base * (2 ** max(0, retry_index)))
        jitter = random.uniform(0, exp * 0.2)
        return exp + jitter


metrics = Metrics()
