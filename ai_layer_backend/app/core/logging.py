"""
Structured JSON logging configuration.
Includes job_id, pipeline name, environment, and execution time tracking.
"""
import sys
import logging
from typing import Any, Optional
import structlog
from pythonjsonlogger import jsonlogger

from app.core.config import settings


def setup_logging() -> None:
    """
    Configure structured logging with JSON output.
    Includes context processors for job tracking and execution metrics.
    """
    # Determine log level
    log_level = getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO)
    
    # Configure standard library logging
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=log_level,
    )
    
    # Configure structlog processors
    processors = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
    ]
    
    # Add JSON renderer for production, console for dev
    if settings.LOG_FORMAT == "json" or settings.is_production:
        processors.append(structlog.processors.JSONRenderer())
    else:
        processors.append(structlog.dev.ConsoleRenderer())
    
    # Configure structlog
    structlog.configure(
        processors=processors,
        wrapper_class=structlog.stdlib.BoundLogger,
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str = __name__) -> structlog.BoundLogger:
    """
    Get a configured logger instance.
    
    Args:
        name: Logger name (typically __name__)
    
    Returns:
        Configured structlog logger
    """
    return structlog.get_logger(name)


def log_job_start(
    logger: structlog.BoundLogger,
    job_id: str,
    pipeline: str,
    **kwargs: Any
) -> structlog.BoundLogger:
    """
    Log job start with context.
    
    Args:
        logger: Logger instance
        job_id: Unique job identifier
        pipeline: Pipeline name
        **kwargs: Additional context
    
    Returns:
        Logger bound with job context
    """
    bound_logger = logger.bind(
        job_id=job_id,
        pipeline=pipeline,
        environment=settings.APP_ENV,
        **kwargs
    )
    bound_logger.info(event="Job started", job_id_arg=job_id, pipeline_arg=pipeline)
    return bound_logger


def log_job_complete(
    logger: structlog.BoundLogger,
    job_id: str,
    execution_time: float,
    status: str = "success",
    total_tokens: Optional[int] = None,
    input_tokens: Optional[int] = None,
    output_tokens: Optional[int] = None,
    **kwargs: Any
) -> None:
    """
    Log job completion with metrics.
    
    Args:
        logger: Logger instance
        job_id: Unique job identifier
        execution_time: Job execution time in seconds
        status: Job status (success/failed)
        total_tokens: Total tokens used (optional)
        input_tokens: Input tokens used (optional)
        output_tokens: Output tokens used (optional)
        **kwargs: Additional context
    """
    log_data = {
        "event": "Job completed",
        "job_id": job_id,
        "execution_time": execution_time,
        "status": status,
        **kwargs
    }
    
    if total_tokens is not None:
        log_data["total_tokens"] = total_tokens
    if input_tokens is not None:
        log_data["input_tokens"] = input_tokens
    if output_tokens is not None:
        log_data["output_tokens"] = output_tokens
        
    logger.info(**log_data)


def log_job_error(
    logger: structlog.BoundLogger,
    job_id: str,
    error: Exception,
    execution_time: Optional[float] = None,
    **kwargs: Any
) -> None:
    """
    Log job error with exception details.
    
    Args:
        logger: Logger instance
        job_id: Unique job identifier
        error: Exception that occurred
        execution_time: Job execution time in seconds (if available)
        **kwargs: Additional context
    """
    logger.error(
        event="Job failed",
        job_id=job_id,
        error=str(error),
        error_type=type(error).__name__,
        execution_time=execution_time,
        exc_info=True,
        **kwargs
    )


# Initialize logging on module import
setup_logging()
