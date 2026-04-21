"""
Memory management helpers for long-running pipelines.
"""

import gc
from typing import Optional

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


def maybe_collect(
    *,
    stage: str,
    batch_idx: Optional[int] = None,
    size_hint_mb: Optional[float] = None,
) -> int:
    """
    Run manual GC only when enabled and thresholds are met.
    Returns the number of collected objects.
    """
    if not settings.ENABLE_MANUAL_GC:
        return 0

    every_n_batches = max(1, settings.GC_EVERY_N_BATCHES)
    min_large_mb = settings.GC_MIN_LARGE_OBJECT_MB

    if batch_idx is not None and batch_idx % every_n_batches != 0:
        return 0

    if size_hint_mb is not None and size_hint_mb < min_large_mb:
        return 0

    collected = gc.collect()
    logger.info(
        "Manual GC executed",
        stage=stage,
        batch_idx=batch_idx,
        size_hint_mb=size_hint_mb,
        collected=collected,
    )
    return collected
