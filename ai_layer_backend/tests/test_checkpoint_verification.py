import pytest

from app.workers.orchestrator import PipelineOrchestrator


class DummyCtx:
    job_id = "job-1"
    tenant_id = "tenant-1"
    sop_config = {"sections": []}
    document_name = "doc.pdf"
    s3_input_key = "raw/doc.pdf"

    async def update_status(self, **kwargs):
        return None


@pytest.mark.asyncio
async def test_upload_checkpoint_requires_artifacts(monkeypatch):
    orch = PipelineOrchestrator(DummyCtx())
    from app.workers import orchestrator as module

    async def missing(_key):
        return False

    monkeypatch.setattr(module.s3_service, "file_exists", missing)
    ok = await orch._verify_checkpoint_artifacts("upload", {"resumable_metadata": {}})
    assert ok is False
