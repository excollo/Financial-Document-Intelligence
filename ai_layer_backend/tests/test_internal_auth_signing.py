import hashlib
import hmac
import json
import time

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.middleware import internal_auth
from app.middleware.internal_auth import require_internal_secret


def _make_request_bytes(method: str, path: str, headers: dict, body_bytes: bytes):

    async def receive():
        return {"type": "http.request", "body": body_bytes, "more_body": False}

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": method,
        "scheme": "http",
        "path": path,
        "raw_path": path.encode("utf-8"),
        "query_string": b"",
        "headers": [(k.lower().encode("utf-8"), str(v).encode("utf-8")) for k, v in headers.items()],
        "client": ("127.0.0.1", 12345),
        "server": ("test", 80),
    }
    return Request(scope, receive), body_bytes


def _make_request(method: str, path: str, headers: dict, body: dict):
    body_bytes = json.dumps(body, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return _make_request_bytes(method, path, headers, body_bytes)


def _sign(secret: str, method: str, path: str, raw_body: bytes, timestamp: str, nonce: str) -> str:
    payload = (
        f"{method.upper()}\n{path}\n".encode("utf-8")
        + raw_body
        + f"\n{timestamp}\n{nonce}".encode("utf-8")
    )
    return hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()


@pytest.fixture(autouse=True)
def reset_internal_auth_state(monkeypatch):
    monkeypatch.setattr(internal_auth, "_redis_client", None, raising=False)
    monkeypatch.setattr(internal_auth, "_redis_init_attempted", True, raising=False)
    monkeypatch.setattr(internal_auth, "_nonce_cache", {}, raising=False)
    monkeypatch.setattr(internal_auth.settings, "INTERNAL_SECRET", "secret-123")
    monkeypatch.setattr(internal_auth.settings, "INTERNAL_CALLBACK_SIGNING_SECRET", "signing-123")
    monkeypatch.setattr(internal_auth.settings, "INTERNAL_CALLBACK_SIGNATURE_REQUIRED", True)
    monkeypatch.setattr(internal_auth.settings, "INTERNAL_CALLBACK_TIMESTAMP_TOLERANCE_SECONDS", 300)
    monkeypatch.setattr(internal_auth.settings, "INTERNAL_CALLBACK_NONCE_TTL_SECONDS", 300)
    monkeypatch.setattr(internal_auth.settings, "APP_ENV", "dev")
    yield


@pytest.mark.asyncio
async def test_missing_signature_headers_rejected():
    req, _ = _make_request(
        "POST",
        "/jobs/pipeline",
        {"X-Internal-Secret": "secret-123"},
        {"job_id": "j1"},
    )
    with pytest.raises(HTTPException) as exc:
        await require_internal_secret(req, provided_key="secret-123")
    assert exc.value.status_code == 401
    assert exc.value.detail["code"] == "MISSING_SIGNED_HEADERS"


@pytest.mark.asyncio
async def test_expired_timestamp_rejected():
    body = {"job_id": "j1"}
    timestamp = str(int(time.time()) - 1000)
    nonce = "nonce-expired"
    req, raw_body = _make_request("POST", "/jobs/pipeline", {}, body)
    signature = _sign("signing-123", "POST", "/jobs/pipeline", raw_body, timestamp, nonce)
    req, _ = _make_request(
        "POST",
        "/jobs/pipeline",
        {
            "X-Internal-Secret": "secret-123",
            "X-Timestamp": timestamp,
            "X-Nonce": nonce,
            "X-Signature": signature,
        },
        body,
    )
    with pytest.raises(HTTPException) as exc:
        await require_internal_secret(req, provided_key="secret-123")
    assert exc.value.status_code == 401
    assert exc.value.detail["code"] == "EXPIRED_TIMESTAMP"


@pytest.mark.asyncio
async def test_replayed_nonce_rejected():
    body = {"job_id": "j1"}
    timestamp = str(int(time.time()))
    nonce = "nonce-replay"
    req, raw_body = _make_request("POST", "/jobs/pipeline", {}, body)
    signature = _sign("signing-123", "POST", "/jobs/pipeline", raw_body, timestamp, nonce)

    first_req, _ = _make_request(
        "POST",
        "/jobs/pipeline",
        {
            "X-Internal-Secret": "secret-123",
            "X-Timestamp": timestamp,
            "X-Nonce": nonce,
            "X-Signature": signature,
        },
        body,
    )
    await require_internal_secret(first_req, provided_key="secret-123")

    second_req, _ = _make_request(
        "POST",
        "/jobs/pipeline",
        {
            "X-Internal-Secret": "secret-123",
            "X-Timestamp": timestamp,
            "X-Nonce": nonce,
            "X-Signature": signature,
        },
        body,
    )
    with pytest.raises(HTTPException) as exc:
        await require_internal_secret(second_req, provided_key="secret-123")
    assert exc.value.status_code == 401
    assert exc.value.detail["code"] == "REPLAYED_NONCE_OR_STORE_UNAVAILABLE"


@pytest.mark.asyncio
async def test_invalid_signature_rejected():
    body = {"job_id": "j1"}
    timestamp = str(int(time.time()))
    nonce = "nonce-invalid"
    req, _ = _make_request(
        "POST",
        "/jobs/pipeline",
        {
            "X-Internal-Secret": "secret-123",
            "X-Timestamp": timestamp,
            "X-Nonce": nonce,
            "X-Signature": "bad-signature",
        },
        body,
    )
    with pytest.raises(HTTPException) as exc:
        await require_internal_secret(req, provided_key="secret-123")
    assert exc.value.status_code == 401
    assert exc.value.detail["code"] == "INVALID_SIGNATURE"


@pytest.mark.asyncio
async def test_valid_signed_request_accepted():
    body = {"job_id": "j1"}
    timestamp = str(int(time.time()))
    nonce = "nonce-valid"
    req, raw_body = _make_request("POST", "/jobs/pipeline", {}, body)
    signature = _sign("signing-123", "POST", "/jobs/pipeline", raw_body, timestamp, nonce)
    req, _ = _make_request(
        "POST",
        "/jobs/pipeline",
        {
            "X-Internal-Secret": "secret-123",
            "X-Timestamp": timestamp,
            "X-Nonce": nonce,
            "X-Signature": signature,
        },
        body,
    )
    await require_internal_secret(req, provided_key="secret-123")


@pytest.mark.asyncio
async def test_valid_signed_binary_raw_request_accepted():
    raw_body = b"--boundary\r\ncontent-disposition: form-data; name=file\r\n\r\n\xff\x00ABC\r\n--boundary--"
    timestamp = str(int(time.time()))
    nonce = "nonce-binary-valid"
    signature = _sign("signing-123", "POST", "/onboarding/setup", raw_body, timestamp, nonce)
    req, _ = _make_request_bytes(
        "POST",
        "/onboarding/setup",
        {
            "X-Internal-Secret": "secret-123",
            "X-Timestamp": timestamp,
            "X-Nonce": nonce,
            "X-Signature": signature,
            "Content-Type": "multipart/form-data; boundary=boundary",
        },
        raw_body,
    )
    await require_internal_secret(req, provided_key="secret-123")


@pytest.mark.asyncio
async def test_signed_binary_raw_request_rejects_one_byte_tamper():
    original_body = b"--boundary\r\ncontent-disposition: form-data; name=file\r\n\r\n\xff\x00ABC\r\n--boundary--"
    tampered_body = b"--boundary\r\ncontent-disposition: form-data; name=file\r\n\r\n\xff\x00ABD\r\n--boundary--"
    timestamp = str(int(time.time()))
    nonce = "nonce-binary-tamper"
    signature = _sign("signing-123", "POST", "/onboarding/setup", original_body, timestamp, nonce)
    req, _ = _make_request_bytes(
        "POST",
        "/onboarding/setup",
        {
            "X-Internal-Secret": "secret-123",
            "X-Timestamp": timestamp,
            "X-Nonce": nonce,
            "X-Signature": signature,
            "Content-Type": "multipart/form-data; boundary=boundary",
        },
        tampered_body,
    )
    with pytest.raises(HTTPException) as exc:
        await require_internal_secret(req, provided_key="secret-123")
    assert exc.value.status_code == 401
    assert exc.value.detail["code"] == "INVALID_SIGNATURE"


@pytest.mark.asyncio
async def test_production_blocks_weak_secret_only_mode(monkeypatch):
    monkeypatch.setattr(internal_auth.settings, "APP_ENV", "prod")
    monkeypatch.setattr(internal_auth.settings, "INTERNAL_CALLBACK_SIGNATURE_REQUIRED", False)
    req, _ = _make_request(
        "POST",
        "/jobs/pipeline",
        {"X-Internal-Secret": "secret-123"},
        {"job_id": "j1"},
    )
    with pytest.raises(HTTPException) as exc:
        await require_internal_secret(req, provided_key="secret-123")
    assert exc.value.status_code == 503
    assert exc.value.detail["code"] == "WEAK_SIGNATURE_MODE_BLOCKED"
