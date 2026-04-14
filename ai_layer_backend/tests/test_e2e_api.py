import pytest
import uuid
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient
from app.main import app
from app.api.jobs import require_internal_secret
from app.core.config import settings

# --- Simplified Mock for internal secret check in tests ---
async def mock_require_internal_secret():
    return True

@pytest.fixture(autouse=True)
def override_internal_secret():
    """Override the dependency with the mock."""
    app.dependency_overrides[require_internal_secret] = mock_require_internal_secret
    yield
    app.dependency_overrides.clear()

@pytest.fixture
def client():
    return TestClient(app)

def test_full_job_lifecycle_mocked(client, monkeypatch):
    """
    Test the job lifecycle (submit -> poll).
    We mock the celery send_task and AsyncResult to avoid any real Redis/broker calls.
    """
    # 1. Submit Summary Job
    payload = {
        "namespace": "test-namespace",
        "doc_type": "drhp",
        "documentId": "test-doc-id",
        "domainId": "test-domain-id",
        "metadata": {"test": "data"}
    }

    # Mock celery send_task to avoid reaching actual Redis
    from celery import Celery
    monkeypatch.setattr(Celery, "send_task", lambda *a, **k: None)

    response = client.post("/jobs/summary", json=payload)
    assert response.status_code == 202
    data = response.json()
    assert "job_id" in data
    submitted_job_id = data["job_id"]

    # 2. Check Job Status — patch celery_app.AsyncResult directly on the module
    class MockAsyncResult:
        def __init__(self, id, *args, **kwargs):
            self.id = id
            self.state = "SUCCESS"
            self.result = {"summary": "This is a test summary output"}
            self.info = None
        def successful(self): return True
        def failed(self): return False

    # Patch directly on the celery_app instance used by the jobs router
    from app.workers.celery_app import celery_app as _celery_app
    monkeypatch.setattr(_celery_app, "AsyncResult", MockAsyncResult)

    status_response = client.get(f"/jobs/{submitted_job_id}")
    assert status_response.status_code == 200
    status_data = status_response.json()
    assert status_data["state"] == "SUCCESS"
    assert "summary" in status_data["result"]

def test_pipeline_job_submission(client, monkeypatch):
    """Verify high-fidelity pipeline job submission."""
    job_id = "test-job-" + str(uuid.uuid4())[:8]

    payload = {
        "job_id": job_id,
        "tenant_id": "test-tenant",
        "document_name": "test_extraction.pdf",
        "s3_input_key": "raw/test_extraction.pdf"
    }

    # Mock celery
    from celery import Celery
    monkeypatch.setattr(Celery, "send_task", lambda *a, **k: None)

    response = client.post("/jobs/pipeline", json=payload)
    assert response.status_code == 202
    assert response.json()["job_id"] == job_id
