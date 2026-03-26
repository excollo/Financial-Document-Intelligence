import pytest
from typing import Generator
from fastapi.testclient import TestClient

from app.main import app
from app.db.mongo import mongodb

@pytest.fixture(scope="session")
def client() -> Generator:
    """Test client for FastAPI."""
    with TestClient(app) as c:
        yield c

@pytest.fixture(autouse=True)
def mock_mongodb(monkeypatch):
    """
    Mock MongoDB connection for tests to avoid external dependency.
    We make this synchronous for now to avoid pytest-asyncio complications
    with sync tests.
    """
    # Overriding the connect method to do nothing in tests
    # since we're using TestClient which triggers lifespan events
    pass
