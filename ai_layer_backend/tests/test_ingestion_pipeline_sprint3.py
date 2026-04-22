import asyncio
import os
import tempfile

import pytest

from app.services.ingestion_pipeline import IngestionPipeline
from app.services.s3 import AzureStorageService


class _FakeDownloadResponse:
    def __init__(self, chunks, raise_err=None):
        self._chunks = chunks
        self._raise_err = raise_err

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def raise_for_status(self):
        if self._raise_err:
            raise self._raise_err

    def iter_content(self, chunk_size=1024 * 1024):
        for item in self._chunks:
            if isinstance(item, Exception):
                raise item
            yield item


def test_compute_section_offsets_is_exact_and_collision_free():
    pipeline = IngestionPipeline()
    sections = [
        {"text": "a " * 7000, "sectionName": "S1"},
        {"text": "b " * 5000, "sectionName": "S2"},
        {"text": "short", "sectionName": "S3"},
    ]
    offsets = pipeline._compute_section_offsets(sections)

    expected_first_count = len(pipeline.chunking.split_text(sections[0]["text"]))
    expected_second_count = len(pipeline.chunking.split_text(sections[1]["text"]))

    assert offsets[0] == 0
    assert offsets[1] == expected_first_count
    assert offsets[2] == expected_first_count + expected_second_count


def test_ingestion_download_tempfile_is_cleaned_on_stream_failure(monkeypatch, tmp_path):
    pipeline = IngestionPipeline()
    target_path = tmp_path / "ingestion-temp.pdf"

    def _fake_mkstemp(suffix=".pdf"):
        fd = os.open(str(target_path), os.O_CREAT | os.O_RDWR)
        return fd, str(target_path)

    def _fake_get(*args, **kwargs):
        return _FakeDownloadResponse([b"partial", RuntimeError("stream broke")])

    monkeypatch.setattr(tempfile, "mkstemp", _fake_mkstemp)
    monkeypatch.setattr("app.services.ingestion_pipeline.requests.get", _fake_get)

    with pytest.raises(RuntimeError):
        asyncio.run(
            pipeline.process(
                file_url="https://example.com/file.pdf",
                file_type="pdf",
                job_id="job-1",
                metadata={"filename": "x.pdf"},
            )
        )

    assert not target_path.exists()


def test_ingestion_fails_fast_when_any_section_fails(monkeypatch):
    pipeline = IngestionPipeline()

    # Download path setup
    monkeypatch.setattr(
        "app.services.ingestion_pipeline.requests.get",
        lambda *args, **kwargs: _FakeDownloadResponse([b"ok-bytes"]),
    )

    # Extraction setup
    async def _fake_get_toc(_path):
        return []

    async def _fake_extract(_path, job_id=None, table_callback=None, provided_toc=None):
        return {
            "sections": [
                {"sectionName": "ok-section", "text": "a " * 6000},
                {"sectionName": "bad-section", "text": "b " * 6000},
            ],
            "tables": [],
        }

    monkeypatch.setattr(pipeline.extraction, "get_toc", _fake_get_toc)
    monkeypatch.setattr(pipeline.extraction, "extract_sections_from_pdf", _fake_extract)

    # Minimal mongo stubs for metadata write path
    class _Collection:
        def update_one(self, *args, **kwargs):
            return None

        def insert_one(self, *args, **kwargs):
            return None

    class _MongoStub:
        sync_db = object()

        @staticmethod
        def get_sync_collection(_name):
            return _Collection()

    monkeypatch.setattr("app.services.ingestion_pipeline.mongodb", _MongoStub())

    # Ensure no external notify side effect during expected failure
    monkeypatch.setattr("app.services.ingestion_pipeline.backend_notifier.notify_status", lambda *a, **k: None)

    async def _fake_process_section(section, *args, **kwargs):
        if section.get("sectionName") == "bad-section":
            raise RuntimeError("forced section failure")
        return 1

    monkeypatch.setattr(pipeline, "_process_section", _fake_process_section)

    with pytest.raises(RuntimeError):
        asyncio.run(
            pipeline.process(
                file_url="https://example.com/file.pdf",
                file_type="pdf",
                job_id="job-2",
                metadata={"filename": "y.pdf", "_celery_current_retry": 0, "_celery_max_retries": 1},
            )
        )


def test_section_failure_does_not_emit_completed_callback(monkeypatch):
    pipeline = IngestionPipeline()
    callback_calls = []

    monkeypatch.setattr(
        "app.services.ingestion_pipeline.requests.get",
        lambda *args, **kwargs: _FakeDownloadResponse([b"ok-bytes"]),
    )

    async def _fake_get_toc(_path):
        return []

    async def _fake_extract(_path, job_id=None, table_callback=None, provided_toc=None):
        return {
            "sections": [{"sectionName": "bad-section", "text": "b " * 6000}],
            "tables": [],
        }

    monkeypatch.setattr(pipeline.extraction, "get_toc", _fake_get_toc)
    monkeypatch.setattr(pipeline.extraction, "extract_sections_from_pdf", _fake_extract)
    monkeypatch.setattr(
        "app.services.ingestion_pipeline.backend_notifier.notify_status",
        lambda **kwargs: callback_calls.append(kwargs),
    )

    class _Collection:
        def update_one(self, *args, **kwargs):
            return None

        def insert_one(self, *args, **kwargs):
            return None

    class _MongoStub:
        sync_db = object()

        @staticmethod
        def get_sync_collection(_name):
            return _Collection()

    monkeypatch.setattr("app.services.ingestion_pipeline.mongodb", _MongoStub())
    monkeypatch.setattr(
        "app.services.ingestion_pipeline.vector_store_service.delete_vectors",
        lambda *args, **kwargs: None,
    )

    async def _always_fail(*args, **kwargs):
        raise RuntimeError("forced section failure")

    monkeypatch.setattr(pipeline, "_process_section", _always_fail)

    with pytest.raises(RuntimeError):
        asyncio.run(
            pipeline.process(
                file_url="https://example.com/file.pdf",
                file_type="pdf",
                job_id="job-cb-1",
                metadata={"filename": "y.pdf", "_celery_current_retry": 0, "_celery_max_retries": 2},
            )
        )

    assert not any(call.get("status") == "completed" for call in callback_calls)


def test_terminal_attempt_emits_failed_callback_with_section_error_context(monkeypatch):
    pipeline = IngestionPipeline()
    callback_calls = []
    cleanup_calls = []

    monkeypatch.setattr(
        "app.services.ingestion_pipeline.requests.get",
        lambda *args, **kwargs: _FakeDownloadResponse([b"ok-bytes"]),
    )

    async def _fake_get_toc(_path):
        return []

    async def _fake_extract(_path, job_id=None, table_callback=None, provided_toc=None):
        return {
            "sections": [{"sectionName": "bad-section", "text": "b " * 6000}],
            "tables": [],
        }

    monkeypatch.setattr(pipeline.extraction, "get_toc", _fake_get_toc)
    monkeypatch.setattr(pipeline.extraction, "extract_sections_from_pdf", _fake_extract)
    monkeypatch.setattr(
        "app.services.ingestion_pipeline.backend_notifier.notify_status",
        lambda **kwargs: callback_calls.append(kwargs),
    )

    class _Collection:
        def update_one(self, *args, **kwargs):
            return None

        def insert_one(self, *args, **kwargs):
            return None

    class _MongoStub:
        sync_db = object()

        @staticmethod
        def get_sync_collection(_name):
            return _Collection()

    monkeypatch.setattr("app.services.ingestion_pipeline.mongodb", _MongoStub())
    monkeypatch.setattr(
        "app.services.ingestion_pipeline.vector_store_service.delete_vectors",
        lambda *args, **kwargs: cleanup_calls.append({"args": args, "kwargs": kwargs}),
    )

    async def _always_fail(*args, **kwargs):
        raise RuntimeError("forced section failure")

    monkeypatch.setattr(pipeline, "_process_section", _always_fail)

    with pytest.raises(RuntimeError):
        asyncio.run(
            pipeline.process(
                file_url="https://example.com/file.pdf",
                file_type="pdf",
                job_id="job-cb-2",
                metadata={
                    "filename": "y.pdf",
                    "documentId": "doc-1",
                    "workspaceId": "ws-1",
                    "domainId": "tenant-1",
                    "_celery_current_retry": 2,
                    "_celery_max_retries": 2,
                },
            )
        )

    failed_calls = [call for call in callback_calls if call.get("status") == "failed"]
    assert len(failed_calls) == 1
    assert "forced section failure" in failed_calls[0].get("error", {}).get("message", "")
    assert len(cleanup_calls) == 1


def test_non_terminal_retry_does_not_emit_terminal_failed_callback(monkeypatch):
    pipeline = IngestionPipeline()
    callback_calls = []

    monkeypatch.setattr(
        "app.services.ingestion_pipeline.requests.get",
        lambda *args, **kwargs: _FakeDownloadResponse([b"ok-bytes"]),
    )

    async def _fake_get_toc(_path):
        return []

    async def _fake_extract(_path, job_id=None, table_callback=None, provided_toc=None):
        return {
            "sections": [{"sectionName": "bad-section", "text": "b " * 6000}],
            "tables": [],
        }

    monkeypatch.setattr(pipeline.extraction, "get_toc", _fake_get_toc)
    monkeypatch.setattr(pipeline.extraction, "extract_sections_from_pdf", _fake_extract)
    monkeypatch.setattr(
        "app.services.ingestion_pipeline.backend_notifier.notify_status",
        lambda **kwargs: callback_calls.append(kwargs),
    )

    class _Collection:
        def update_one(self, *args, **kwargs):
            return None

        def insert_one(self, *args, **kwargs):
            return None

    class _MongoStub:
        sync_db = object()

        @staticmethod
        def get_sync_collection(_name):
            return _Collection()

    monkeypatch.setattr("app.services.ingestion_pipeline.mongodb", _MongoStub())
    monkeypatch.setattr(
        "app.services.ingestion_pipeline.vector_store_service.delete_vectors",
        lambda *args, **kwargs: None,
    )

    async def _always_fail(*args, **kwargs):
        raise RuntimeError("forced section failure")

    monkeypatch.setattr(pipeline, "_process_section", _always_fail)

    with pytest.raises(RuntimeError):
        asyncio.run(
            pipeline.process(
                file_url="https://example.com/file.pdf",
                file_type="pdf",
                job_id="job-cb-3",
                metadata={
                    "filename": "y.pdf",
                    "_celery_current_retry": 0,
                    "_celery_max_retries": 2,
                },
            )
        )

    assert not any(call.get("status") == "failed" for call in callback_calls)
    assert not any(call.get("status") == "completed" for call in callback_calls)


def test_s3_download_file_to_path_cleans_temp_on_failure(monkeypatch, tmp_path):
    service = AzureStorageService()
    target_path = tmp_path / "azure-temp.pdf"

    def _fake_mkstemp(suffix=".pdf"):
        fd = os.open(str(target_path), os.O_CREAT | os.O_RDWR)
        return fd, str(target_path)

    class _DownloadStream:
        def chunks(self):
            yield b"first"
            raise RuntimeError("azure stream broke")

    class _BlobClient:
        @staticmethod
        def download_blob():
            return _DownloadStream()

    class _BlobService:
        @staticmethod
        def get_blob_client(container=None, blob=None):
            return _BlobClient()

    service.blob_service_client = _BlobService()
    service.container_name = "test"

    monkeypatch.setattr(tempfile, "mkstemp", _fake_mkstemp)

    result = asyncio.run(service.download_file_to_path("key"))
    assert result is None
    assert not target_path.exists()


def test_embedding_batch_size_invalid_values_fallback_and_clamp(monkeypatch):
    pipeline = IngestionPipeline()

    monkeypatch.setenv("EMBEDDING_BATCH_SIZE", "invalid")
    assert pipeline.embedding.get_batch_size() == 50

    monkeypatch.setenv("EMBEDDING_BATCH_SIZE", "0")
    assert pipeline.embedding.get_batch_size() == 50

    monkeypatch.setenv("EMBEDDING_BATCH_SIZE", "-5")
    assert pipeline.embedding.get_batch_size() == 50

    monkeypatch.setenv("EMBEDDING_BATCH_SIZE", "999")
    assert pipeline.embedding.get_batch_size() == 200

    monkeypatch.setenv("EMBEDDING_BATCH_SIZE", "25")
    assert pipeline.embedding.get_batch_size() == 25
