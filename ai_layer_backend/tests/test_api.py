import pytest
from app.main import app
from app.api.jobs import require_internal_secret
from app.api import jobs as jobs_api

# --- Simplified Mock for internal secret check in tests ---
async def mock_require_internal_secret():
    return True

@pytest.fixture(autouse=True)
def override_internal_secret(monkeypatch):
    """Override the dependency with the mock."""
    app.dependency_overrides[require_internal_secret] = mock_require_internal_secret
    yield
    app.dependency_overrides.clear()

def test_health_check(client):
    """Verify health endpoint."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] in {"healthy", "operational"}
    assert data["service"] == "ai-python-platform-router"

def test_root_endpoint(client):
    """Verify root endpoint."""
    response = client.get("/")
    assert response.status_code == 200
    assert "AI Python Platform API" in response.json()["message"]

def test_job_submission_validation(client):
    """Verify that submitting a pipeline job without required fields fails (422)."""
    # Empty body
    response = client.post("/jobs/pipeline", json={})
    assert response.status_code == 422
    
    # Missing required field job_id
    response = client.post("/jobs/pipeline", json={
        "tenant_id": "test-tenant",
        "document_name": "test.pdf",
        "s3_input_key": "raw/test.pdf"
    })
    assert response.status_code == 422

def test_summary_job_uses_upstream_job_id(client, monkeypatch):
    captured = {}

    def fake_send_task(name, args=None, task_id=None, **kwargs):
        captured["name"] = name
        captured["args"] = args or []
        captured["task_id"] = task_id
        captured["kwargs"] = kwargs
        class Dummy:
            id = task_id
        return Dummy()

    monkeypatch.setattr(jobs_api.celery_app, "send_task", fake_send_task)
    payload = {
        "job_id": "summary-job-123",
        "namespace": "demo.pdf",
        "doc_type": "drhp",
        "metadata": {}
    }
    response = client.post("/jobs/summary", json=payload)
    assert response.status_code == 202
    assert response.json()["job_id"] == "summary-job-123"
    assert captured["task_id"] == "summary-job-123"
    assert captured.get("name") == "generate_summary"
    assert captured.get("kwargs", {}).get("queue", "light_jobs") == "light_jobs"

def test_comparison_job_uses_upstream_job_id(client, monkeypatch):
    captured = {}

    def fake_send_task(name, args=None, task_id=None, **kwargs):
        captured["name"] = name
        captured["args"] = args or []
        captured["task_id"] = task_id
        captured["kwargs"] = kwargs
        class Dummy:
            id = task_id
        return Dummy()

    monkeypatch.setattr(jobs_api.celery_app, "send_task", fake_send_task)
    payload = {
        "job_id": "comparison-job-123",
        "drhpNamespace": "drhp-demo.pdf",
        "rhpNamespace": "rhp-demo.pdf",
        "drhpDocumentId": "drhp-1",
        "rhpDocumentId": "rhp-1",
        "sessionId": "sess-1",
        "metadata": {}
    }
    response = client.post("/jobs/comparison", json=payload)
    assert response.status_code == 202
    assert response.json()["job_id"] == "comparison-job-123"
    assert captured["task_id"] == "comparison-job-123"
    assert captured.get("name") == "generate_comparison"
    assert captured.get("kwargs", {}).get("queue", "light_jobs") == "light_jobs"


def test_pipeline_job_routes_to_heavy_queue(client, monkeypatch):
    captured = {}

    def fake_send_task(name, args=None, task_id=None, queue=None, **kwargs):
        captured["name"] = name
        captured["args"] = args or []
        captured["task_id"] = task_id
        captured["queue"] = queue
        class Dummy:
            id = task_id
        return Dummy()

    monkeypatch.setattr(jobs_api.celery_app, "send_task", fake_send_task)
    response = client.post("/jobs/pipeline", json={
        "job_id": "pipeline-job-1",
        "tenant_id": "tenant-1",
        "document_name": "doc.pdf",
        "s3_input_key": "raw/doc.pdf",
    })
    assert response.status_code == 202
    assert captured["task_id"] == "pipeline-job-1"
    assert captured["queue"] == "heavy_jobs"
