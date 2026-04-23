import pytest
from fastapi import HTTPException

from app.api import jobs


class _DeleteResult:
    def __init__(self, deleted_count: int):
        self.deleted_count = deleted_count


class _Collection:
    def __init__(self, docs):
        self.docs = list(docs)

    async def find_one(self, filter_doc):
        for doc in self.docs:
            if all(doc.get(k) == v for k, v in filter_doc.items()):
                return dict(doc)
        return None

    async def delete_many(self, filter_doc):
        remaining = []
        deleted = 0
        for doc in self.docs:
            if all(doc.get(k) == v for k, v in filter_doc.items()):
                deleted += 1
            else:
                remaining.append(doc)
        self.docs = remaining
        return _DeleteResult(deleted)


class _MongoStub:
    def __init__(self, collections):
        self.db = object()
        self._collections = collections

    async def connect(self):
        return None

    def get_collection(self, name):
        return self._collections[name]


@pytest.mark.asyncio
async def test_cleanup_with_document_id_deletes_only_target_when_filenames_match(monkeypatch):
    collections = {
        "document_metadata": _Collection(
            [
                {"document_id": "doc-1", "workspace_id": "ws-1", "domain_id": "d-1", "filename": "same.pdf", "job_id": "job-1"},
                {"document_id": "doc-2", "workspace_id": "ws-2", "domain_id": "d-2", "filename": "same.pdf", "job_id": "job-2"},
            ]
        ),
        "extraction_results": _Collection(
            [
                {"document_id": "doc-1", "workspace_id": "ws-1", "domain_id": "d-1", "filename": "same.pdf", "table_id": "t-1"},
                {"document_id": "doc-2", "workspace_id": "ws-2", "domain_id": "d-2", "filename": "same.pdf", "table_id": "t-2"},
            ]
        ),
        "document_processing": _Collection(
            [
                {"document_id": "doc-1", "workspace_id": "ws-1", "domain_id": "d-1", "filename": "same.pdf", "job_id": "job-1"},
                {"document_id": "doc-2", "workspace_id": "ws-2", "domain_id": "d-2", "filename": "same.pdf", "job_id": "job-2"},
            ]
        ),
    }
    mongo_stub = _MongoStub(collections)
    monkeypatch.setattr(jobs, "mongodb", mongo_stub)

    vector_calls = []
    monkeypatch.setattr(
        jobs.vector_store_service,
        "delete_vectors",
        lambda *args, **kwargs: vector_calls.append(kwargs) or {"ok": True},
    )
    s3_calls = []

    async def _fake_delete_prefix(prefix):
        s3_calls.append(prefix)
        return True

    monkeypatch.setattr(jobs.s3_service, "delete_prefix", _fake_delete_prefix)

    response = await jobs.delete_document(
        namespace="same.pdf",
        document_id="doc-1",
        workspace_id="ws-1",
        domain_id="d-1",
    )

    assert response["status"] == "success"
    assert all(doc["document_id"] != "doc-1" for doc in collections["document_metadata"].docs)
    assert all(doc["document_id"] != "doc-1" for doc in collections["extraction_results"].docs)
    assert all(doc["document_id"] != "doc-1" for doc in collections["document_processing"].docs)
    assert any(doc["document_id"] == "doc-2" for doc in collections["document_metadata"].docs)
    assert any(doc["document_id"] == "doc-2" for doc in collections["extraction_results"].docs)
    assert any(doc["document_id"] == "doc-2" for doc in collections["document_processing"].docs)
    assert vector_calls and vector_calls[0]["document_id"] == "doc-1"
    assert s3_calls == ["visuals/job-1/"]


@pytest.mark.asyncio
async def test_cleanup_with_document_id_is_scoped_to_context(monkeypatch):
    collections = {
        "document_metadata": _Collection(
            [
                {"document_id": "doc-1", "workspace_id": "ws-1", "domain_id": "d-1", "job_id": "job-1"},
                {"document_id": "doc-1", "workspace_id": "ws-2", "domain_id": "d-2", "job_id": "job-2"},
            ]
        ),
        "extraction_results": _Collection(
            [
                {"document_id": "doc-1", "workspace_id": "ws-1", "domain_id": "d-1", "table_id": "t-1"},
                {"document_id": "doc-1", "workspace_id": "ws-2", "domain_id": "d-2", "table_id": "t-2"},
            ]
        ),
        "document_processing": _Collection(
            [
                {"document_id": "doc-1", "workspace_id": "ws-1", "domain_id": "d-1", "job_id": "job-1"},
                {"document_id": "doc-1", "workspace_id": "ws-2", "domain_id": "d-2", "job_id": "job-2"},
            ]
        ),
    }
    monkeypatch.setattr(jobs, "mongodb", _MongoStub(collections))
    monkeypatch.setattr(jobs.vector_store_service, "delete_vectors", lambda *args, **kwargs: {"ok": True})

    async def _fake_delete_prefix(_prefix):
        return True

    monkeypatch.setattr(jobs.s3_service, "delete_prefix", _fake_delete_prefix)

    await jobs.delete_document(
        namespace="same.pdf",
        document_id="doc-1",
        workspace_id="ws-1",
        domain_id="d-1",
    )

    assert any(
        doc.get("workspace_id") == "ws-2" and doc.get("domain_id") == "d-2"
        for doc in collections["document_metadata"].docs
    )
    assert any(
        doc.get("workspace_id") == "ws-2" and doc.get("domain_id") == "d-2"
        for doc in collections["extraction_results"].docs
    )
    assert any(
        doc.get("workspace_id") == "ws-2" and doc.get("domain_id") == "d-2"
        for doc in collections["document_processing"].docs
    )


@pytest.mark.asyncio
async def test_cleanup_without_document_id_does_not_delete_anything(monkeypatch):
    collections = {
        "document_metadata": _Collection([{"document_id": "doc-1", "job_id": "job-1"}]),
        "extraction_results": _Collection([{"document_id": "doc-1", "table_id": "t-1"}]),
        "document_processing": _Collection([{"document_id": "doc-1", "job_id": "job-1"}]),
    }
    monkeypatch.setattr(jobs, "mongodb", _MongoStub(collections))

    vector_calls = []
    monkeypatch.setattr(
        jobs.vector_store_service,
        "delete_vectors",
        lambda *args, **kwargs: vector_calls.append(kwargs) or {"ok": True},
    )
    s3_calls = []

    async def _fake_delete_prefix(prefix):
        s3_calls.append(prefix)
        return True

    monkeypatch.setattr(jobs.s3_service, "delete_prefix", _fake_delete_prefix)

    with pytest.raises(HTTPException) as exc:
        await jobs.delete_document(namespace="same.pdf", document_id=None, workspace_id="ws-1", domain_id="d-1")
    assert exc.value.status_code == 400
    assert len(collections["document_metadata"].docs) == 1
    assert len(collections["extraction_results"].docs) == 1
    assert len(collections["document_processing"].docs) == 1
    assert vector_calls == []
    assert s3_calls == []


@pytest.mark.asyncio
async def test_cleanup_without_workspace_id_fails_explicitly(monkeypatch):
    collections = {
        "document_metadata": _Collection([{"document_id": "doc-1", "workspace_id": "ws-1", "domain_id": "d-1", "job_id": "job-1"}]),
        "extraction_results": _Collection([{"document_id": "doc-1", "workspace_id": "ws-1", "domain_id": "d-1", "table_id": "t-1"}]),
        "document_processing": _Collection([{"document_id": "doc-1", "workspace_id": "ws-1", "domain_id": "d-1", "job_id": "job-1"}]),
    }
    monkeypatch.setattr(jobs, "mongodb", _MongoStub(collections))
    monkeypatch.setattr(jobs.vector_store_service, "delete_vectors", lambda *args, **kwargs: {"ok": True})
    async def _fake_delete_prefix(_prefix):
        return True
    monkeypatch.setattr(jobs.s3_service, "delete_prefix", _fake_delete_prefix)

    with pytest.raises(HTTPException) as exc:
        await jobs.delete_document(namespace="same.pdf", document_id="doc-1", workspace_id=None, domain_id="d-1")
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_cleanup_without_domain_id_fails_explicitly(monkeypatch):
    collections = {
        "document_metadata": _Collection([{"document_id": "doc-1", "workspace_id": "ws-1", "domain_id": "d-1", "job_id": "job-1"}]),
        "extraction_results": _Collection([{"document_id": "doc-1", "workspace_id": "ws-1", "domain_id": "d-1", "table_id": "t-1"}]),
        "document_processing": _Collection([{"document_id": "doc-1", "workspace_id": "ws-1", "domain_id": "d-1", "job_id": "job-1"}]),
    }
    monkeypatch.setattr(jobs, "mongodb", _MongoStub(collections))
    monkeypatch.setattr(jobs.vector_store_service, "delete_vectors", lambda *args, **kwargs: {"ok": True})
    async def _fake_delete_prefix(_prefix):
        return True
    monkeypatch.setattr(jobs.s3_service, "delete_prefix", _fake_delete_prefix)

    with pytest.raises(HTTPException) as exc:
        await jobs.delete_document(namespace="same.pdf", document_id="doc-1", workspace_id="ws-1", domain_id=None)
    assert exc.value.status_code == 400
