import pytest
from app.main import app
from app.api.jobs import require_internal_secret

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
