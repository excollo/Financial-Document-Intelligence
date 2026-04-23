from types import SimpleNamespace

import pytest

from app.workers import document_pipeline as module


def test_worker_does_not_emit_failed_callback_when_pipeline_raises(monkeypatch):
    calls = []

    class _TaskSelf:
        request = SimpleNamespace(retries=3)
        max_retries = 3

    async def _raise_pipeline(*args, **kwargs):
        raise RuntimeError("forced failure")

    class _Pipeline:
        process = _raise_pipeline

    monkeypatch.setattr(
        module,
        "backend_notifier",
        SimpleNamespace(notify_status=lambda **kwargs: calls.append(kwargs)),
    )
    monkeypatch.setattr(
        module,
        "queue_telemetry_service",
        SimpleNamespace(mark_dequeued=lambda *a, **k: None),
    )
    monkeypatch.setattr(module.metrics, "emit", lambda *a, **k: None)
    async def _try_claim(*args, **kwargs):
        return True, "claim-1"

    async def _release_claim(*args, **kwargs):
        return True

    async def _not_terminal(*args, **kwargs):
        return False

    monkeypatch.setattr(module.execution_claim_service, "try_claim", _try_claim)
    monkeypatch.setattr(module.execution_claim_service, "release_claim", _release_claim)
    monkeypatch.setattr(module, "_start_claim_heartbeat", lambda *a, **k: SimpleNamespace(set=lambda: None))
    monkeypatch.setattr(module, "is_terminal_job", _not_terminal)
    monkeypatch.setitem(__import__("sys").modules, "app.services.ingestion_pipeline", SimpleNamespace(ingestion_pipeline=_Pipeline()))

    # Execute the underlying bound task function directly to avoid Celery's
    # autoretry wrapper semantics and assert callback authority behavior.
    with pytest.raises(RuntimeError):
        module.process_document._orig_run(  # type: ignore[attr-defined]
            "https://example.com/a.pdf",
            "pdf",
            "job-1",
            {"filename": "a.pdf", "workspaceId": "ws-1", "domainId": "tenant-1"},
        )

    assert calls == []
