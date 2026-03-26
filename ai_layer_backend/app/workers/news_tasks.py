from app.workers.celery_app import celery_app
from app.services.news_monitor import run_monitor
from app.core.logging import get_logger

logger = get_logger(__name__)

@celery_app.task(name="run_daily_news_monitor")
def run_daily_news_monitor():
    """Daily news monitor task."""
    logger.info("Celery: Starting run_daily_news_monitor task")
    try:
        run_monitor()
        logger.info("Celery: Completed run_daily_news_monitor task")
    except Exception as e:
        logger.error(f"Celery: Failed run_daily_news_monitor task: {e}")
        raise
