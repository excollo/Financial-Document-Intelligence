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


class FakeSectionResultCollection:
    def __init__(self, rows):
        self.rows = rows

    def find(self, _query, _projection):
        class _Cursor:
            def __init__(self, rows):
                self._rows = rows

            async def to_list(self, length):
                return self._rows[:length]

        return _Cursor(self.rows)


class FakeDb:
    def __init__(self, rows):
        self.rows = rows

    def get_collection(self, _name):
        return FakeSectionResultCollection(self.rows)


@pytest.mark.asyncio
async def test_upload_checkpoint_requires_artifacts(monkeypatch):
    orch = PipelineOrchestrator(DummyCtx())
    from app.workers import orchestrator as module

    async def missing(_key):
        return False

    monkeypatch.setattr(module.s3_service, "file_exists", missing)
    ok = await orch._verify_checkpoint_artifacts("upload", {"resumable_metadata": {}})
    assert ok is False


@pytest.mark.asyncio
async def test_extraction_checkpoint_rejects_identity_mismatch_even_when_count_matches(monkeypatch):
    orch = PipelineOrchestrator(DummyCtx())
    orch.pdf_sections = [{"sectionName": "S1", "text": "new text"}]
    from app.workers import orchestrator as module

    monkeypatch.setattr(
        module.SectionSegmenter,
        "map_pdf_to_sop",
        lambda _pdf, _sop: {"sec-1": {"text": "new text"}},
    )
    module.mongodb.db = FakeDb([{"section_id": "sec-1"}])
    checkpoint = {
        "resumable_metadata": {
            "expected_section_ids": ["sec-1"],
            "section_identity_digest": "stale-digest",
        }
    }
    ok = await orch._verify_checkpoint_artifacts("extraction", checkpoint)
    assert ok is False


@pytest.mark.asyncio
async def test_extraction_checkpoint_rejects_wrong_persisted_sections(monkeypatch):
    orch = PipelineOrchestrator(DummyCtx())
    orch.pdf_sections = [{"sectionName": "S1", "text": "stable"}]
    from app.workers import orchestrator as module

    monkeypatch.setattr(
        module.SectionSegmenter,
        "map_pdf_to_sop",
        lambda _pdf, _sop: {"sec-1": {"text": "stable"}},
    )
    current = orch._build_extraction_checkpoint_metadata({"sec-1": {"text": "stable"}}, [{"section_id": "sec-1"}])
    module.mongodb.db = FakeDb([{"section_id": "sec-2"}])
    ok = await orch._verify_checkpoint_artifacts("extraction", {"resumable_metadata": current})
    assert ok is False


@pytest.mark.asyncio
async def test_extraction_checkpoint_invalidated_when_sop_sections_change(monkeypatch):
    orch = PipelineOrchestrator(DummyCtx())
    orch.pdf_sections = [{"sectionName": "S1", "text": "stable"}]
    from app.workers import orchestrator as module

    monkeypatch.setattr(
        module.SectionSegmenter,
        "map_pdf_to_sop",
        lambda _pdf, _sop: {"sec-1": {"text": "stable"}},
    )
    module.mongodb.db = FakeDb([{"section_id": "sec-1"}])
    checkpoint = {
        "resumable_metadata": {
            "expected_section_ids": ["sec-old"],
            "section_identity_digest": "any",
        }
    }
    ok = await orch._verify_checkpoint_artifacts("extraction", checkpoint)
    assert ok is False
