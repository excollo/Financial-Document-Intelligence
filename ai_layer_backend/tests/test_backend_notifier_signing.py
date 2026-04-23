import hashlib
import hmac
import json
from urllib.parse import urlparse

from app.services.backend_notifier import BackendNotifier


def test_delete_document_sends_signed_headers(monkeypatch):
    captured = {}

    class DummyResponse:
        status_code = 200

        def raise_for_status(self):
            return None

    def fake_delete(url, data=None, headers=None, timeout=None):
        captured["url"] = url
        captured["data"] = data
        captured["headers"] = headers
        captured["timeout"] = timeout
        return DummyResponse()

    monkeypatch.setattr("app.services.backend_notifier.requests.delete", fake_delete)
    monkeypatch.setattr("app.services.backend_notifier.settings.NODE_BACKEND_URL", "http://node.test")
    monkeypatch.setattr("app.services.backend_notifier.settings.INTERNAL_SECRET", "secret-123")
    monkeypatch.setattr(
        "app.services.backend_notifier.settings.INTERNAL_CALLBACK_SIGNING_SECRET", "signing-123"
    )

    ok = BackendNotifier.delete_document("doc-123", "ws-1", "tenant-1")
    assert ok is True
    assert captured["url"] == "http://node.test/api/documents/internal/doc-123"
    assert json.loads(captured["data"]) == {
        "documentId": "doc-123",
        "workspaceId": "ws-1",
        "domainId": "tenant-1",
    }
    assert "X-Internal-Secret" in captured["headers"]
    assert "X-Timestamp" in captured["headers"]
    assert "X-Nonce" in captured["headers"]
    assert "X-Signature" in captured["headers"]


def test_delete_document_signature_matches_node_contract(monkeypatch):
    captured = {}

    class DummyResponse:
        status_code = 200

        def raise_for_status(self):
            return None

    def fake_delete(url, data=None, headers=None, timeout=None):
        captured["url"] = url
        captured["data"] = data
        captured["headers"] = headers
        return DummyResponse()

    monkeypatch.setattr("app.services.backend_notifier.requests.delete", fake_delete)
    monkeypatch.setattr("app.services.backend_notifier.settings.NODE_BACKEND_URL", "http://node.test")
    monkeypatch.setattr("app.services.backend_notifier.settings.INTERNAL_SECRET", "secret-123")
    monkeypatch.setattr(
        "app.services.backend_notifier.settings.INTERNAL_CALLBACK_SIGNING_SECRET", "signing-123"
    )

    BackendNotifier.delete_document("doc-999", "ws-9", "tenant-9")

    method = "DELETE"
    path = urlparse(captured["url"]).path
    timestamp = captured["headers"]["X-Timestamp"]
    nonce = captured["headers"]["X-Nonce"]
    body = captured["data"]
    signing_payload = f"{method}\n{path}\n{body}\n{timestamp}\n{nonce}"
    expected = hmac.new(
        b"signing-123",
        signing_payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    assert captured["headers"]["X-Signature"] == expected
