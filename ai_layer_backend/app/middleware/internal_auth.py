"""
Internal signed-request authentication for Python ingress.
"""
import hashlib
import hmac
import secrets
import time
from threading import Lock

from fastapi import Request, HTTPException, Depends
from fastapi.security import APIKeyHeader

from app.core.config import settings
from app.core.logging import get_logger

try:
    from redis.asyncio import Redis
except Exception:  # pragma: no cover
    Redis = None

logger = get_logger(__name__)

internal_secret_header = APIKeyHeader(name="X-Internal-Secret", auto_error=False)

HEADER_SECRET = "x-internal-secret"
HEADER_TIMESTAMP = "x-timestamp"
HEADER_NONCE = "x-nonce"
HEADER_SIGNATURE = "x-signature"

_redis_client = None
_redis_init_attempted = False
_nonce_cache = {}
_nonce_cache_lock = Lock()


def _signature_required() -> bool:
    if settings.is_production:
        return True
    return bool(settings.INTERNAL_CALLBACK_SIGNATURE_REQUIRED)


async def _get_redis_client():
    global _redis_client, _redis_init_attempted
    if _redis_init_attempted:
        return _redis_client
    _redis_init_attempted = True
    if not settings.REDIS_URL or Redis is None:
        return None
    try:
        _redis_client = Redis.from_url(settings.REDIS_URL)
        await _redis_client.ping()
        return _redis_client
    except Exception as exc:
        logger.warning("Redis nonce store unavailable", error=str(exc))
        _redis_client = None
        return None


async def _check_and_store_nonce(nonce: str) -> bool:
    redis_client = await _get_redis_client()
    ttl_seconds = int(settings.INTERNAL_CALLBACK_NONCE_TTL_SECONDS or 300)

    if redis_client:
        try:
            result = await redis_client.set(
                f"internal_callback_nonce:{nonce}",
                "1",
                ex=ttl_seconds,
                nx=True,
            )
            return bool(result)
        except Exception:
            pass

    if settings.is_production:
        return False

    now = int(time.time())
    with _nonce_cache_lock:
        expired_keys = [key for key, expiry in _nonce_cache.items() if expiry <= now]
        for key in expired_keys:
            _nonce_cache.pop(key, None)
        if nonce in _nonce_cache:
            return False
        _nonce_cache[nonce] = now + ttl_seconds
    return True


def _build_signing_payload(method: str, path: str, raw_body: bytes, timestamp: str, nonce: str) -> bytes:
    prefix = f"{method.upper()}\n{path}\n".encode("utf-8")
    suffix = f"\n{timestamp}\n{nonce}".encode("utf-8")
    return prefix + raw_body + suffix


async def require_internal_secret(
    request: Request,
    provided_key: str = Depends(internal_secret_header),
) -> None:
    expected = getattr(settings, "INTERNAL_SECRET", None)
    signing_secret = settings.INTERNAL_CALLBACK_SIGNING_SECRET or settings.INTERNAL_SECRET

    if not expected or not signing_secret:
        logger.error("Internal auth secrets not configured — internal endpoints are disabled")
        raise HTTPException(
            status_code=503,
            detail={
                "error": "Internal endpoints not configured",
                "code": "INTERNAL_SECRET_MISSING",
            },
        )

    if settings.is_production and not bool(settings.INTERNAL_CALLBACK_SIGNATURE_REQUIRED):
        raise HTTPException(
            status_code=503,
            detail={
                "error": "Weak signature mode blocked in production",
                "code": "WEAK_SIGNATURE_MODE_BLOCKED",
            },
        )

    provided = provided_key or request.headers.get(HEADER_SECRET, "")
    if not provided or provided != expected:
        logger.warning(
            "Invalid internal secret attempt",
            path=str(request.url.path),
            ip=request.client.host if request.client else "unknown",
        )
        raise HTTPException(
            status_code=403,
            detail={
                "error": "Invalid or missing internal secret",
                "code": "INVALID_INTERNAL_SECRET",
            },
        )

    timestamp = request.headers.get(HEADER_TIMESTAMP, "")
    nonce = request.headers.get(HEADER_NONCE, "")
    signature = request.headers.get(HEADER_SIGNATURE, "")

    if not timestamp or not nonce or not signature:
        if not _signature_required():
            return None
        raise HTTPException(
            status_code=401,
            detail={"error": "Missing signed headers", "code": "MISSING_SIGNED_HEADERS"},
        )

    try:
        timestamp_value = int(timestamp)
    except Exception:
        raise HTTPException(
            status_code=401,
            detail={"error": "Invalid timestamp", "code": "INVALID_TIMESTAMP"},
        )

    age_seconds = abs(int(time.time()) - timestamp_value)
    if age_seconds > int(settings.INTERNAL_CALLBACK_TIMESTAMP_TOLERANCE_SECONDS or 300):
        raise HTTPException(
            status_code=401,
            detail={"error": "Expired timestamp", "code": "EXPIRED_TIMESTAMP"},
        )

    nonce_ok = await _check_and_store_nonce(nonce)
    if not nonce_ok:
        raise HTTPException(
            status_code=401,
            detail={
                "error": "Replayed nonce or nonce store unavailable",
                "code": "REPLAYED_NONCE_OR_STORE_UNAVAILABLE",
            },
        )

    raw_body_bytes = await request.body()
    signing_payload = _build_signing_payload(
        request.method,
        request.url.path,
        raw_body_bytes,
        timestamp,
        nonce,
    )
    expected_signature = hmac.new(
        signing_secret.encode("utf-8"),
        signing_payload,
        hashlib.sha256,
    ).hexdigest()

    if not secrets.compare_digest(expected_signature, signature):
        raise HTTPException(
            status_code=401,
            detail={"error": "Invalid signature", "code": "INVALID_SIGNATURE"},
        )

    return None
