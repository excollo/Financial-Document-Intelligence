"""
conftest.py — Global test fixtures for the AI Python backend.

All external services (Pinecone, Azure Blob, Cohere, OpenAI, MongoDB, Redis/Celery)
are patched at the module level BEFORE the FastAPI app is imported so that no real
network calls are made during the test run.
"""
import os
import sys
import pytest
from typing import Generator
from unittest.mock import MagicMock, AsyncMock, patch

# ---------------------------------------------------------------------------
# 1. Set minimal env vars so Settings validation passes without real secrets
# ---------------------------------------------------------------------------
os.environ.setdefault("AZURE_BLOB_ACCOUNT_NAME", "dummyaccount")
os.environ.setdefault("AZURE_BLOB_ACCOUNT_KEY", "ZmFrZV9rZXlfZm9yX3Rlc3RpbmdfcHVycG9zZXNfMTIzNDU2Nzg5MA==")
os.environ.setdefault("AZURE_BLOB_CONTAINER_NAME", "drhp-files")
os.environ.setdefault(
    "AZURE_BLOB_STORAGE_CONNECTION_STRING",
    "DefaultEndpointsProtocol=https;AccountName=dummyaccount;"
    "AccountKey=ZmFrZV9rZXlfZm9yX3Rlc3RpbmdfcHVycG9zZXNfMTIzNDU2Nzg5MA==;"
    "EndpointSuffix=core.windows.net",
)
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("CELERY_BROKER_URL", "redis://localhost:6379/0")
os.environ.setdefault("MONGO_URI", "mongodb://localhost:27017/test")
os.environ.setdefault("INTERNAL_SECRET", "test-secret")
os.environ.setdefault("PINECONE_API_KEY", "dummy-pinecone-key")
os.environ.setdefault("OPENAI_API_KEY", "sk-dummy-key-for-testing")
os.environ.setdefault("COHERE_API_KEY", "dummy-cohere-key")
os.environ.setdefault("APP_ENV", "test")

# ---------------------------------------------------------------------------
# 2. Patch all heavy external clients BEFORE any app module is imported
# ---------------------------------------------------------------------------

# --- Pinecone ---
mock_pinecone_index = MagicMock()
mock_pinecone_index.query.return_value = {"matches": []}
mock_pinecone_index.upsert.return_value = MagicMock(upserted_count=0)
mock_pinecone_instance = MagicMock()
mock_pinecone_instance.Index.return_value = mock_pinecone_index
mock_pinecone_instance.list_indexes.return_value = []
patch("pinecone.Pinecone", return_value=mock_pinecone_instance).start()

# --- Azure Blob Storage ---
mock_blob_client = MagicMock()
mock_container_client = MagicMock()
mock_container_client.exists.return_value = True
mock_blob_client.get_container_client.return_value = mock_container_client
patch("azure.storage.blob.BlobServiceClient.from_connection_string",
      return_value=mock_blob_client).start()
patch("azure.storage.blob.BlobServiceClient",
      return_value=mock_blob_client).start()

# --- OpenAI / Azure OpenAI ---
mock_openai_response = MagicMock()
mock_openai_response.choices = [MagicMock(message=MagicMock(content='{"status": "ok"}'))]
mock_openai_response.usage = MagicMock(prompt_tokens=10, completion_tokens=10, total_tokens=20)
mock_openai_client = MagicMock()
mock_openai_client.chat.completions.create.return_value = mock_openai_response
mock_openai_client.models.list.return_value = []
mock_async_openai_client = AsyncMock()
mock_async_openai_client.chat.completions.create = AsyncMock(return_value=mock_openai_response)
patch("openai.OpenAI", return_value=mock_openai_client).start()
patch("openai.AsyncOpenAI", return_value=mock_async_openai_client).start()
patch("openai.AzureOpenAI", return_value=mock_openai_client).start()
patch("openai.AsyncAzureOpenAI", return_value=mock_async_openai_client).start()

# --- Cohere ---
mock_cohere_client = MagicMock()
mock_cohere_client.rerank.return_value = MagicMock(results=[])
patch("cohere.Client", return_value=mock_cohere_client).start()
patch("cohere.ClientV2", return_value=mock_cohere_client).start()

# --- Camelot (optional heavy lib) ---
mock_camelot = MagicMock()
mock_camelot.read_pdf.return_value = []
sys.modules.setdefault("camelot", mock_camelot)

# --- pdfplumber ---
mock_pdfplumber = MagicMock()
sys.modules.setdefault("pdfplumber", mock_pdfplumber)

# --- cv2 (OpenCV) ---
sys.modules.setdefault("cv2", MagicMock())

# --- MongoDB ---
mock_motor_client = MagicMock()
patch("motor.motor_asyncio.AsyncIOMotorClient", return_value=mock_motor_client).start()
patch("pymongo.MongoClient", return_value=MagicMock()).start()

# ---------------------------------------------------------------------------
# 3. Now it is safe to import the FastAPI app
# ---------------------------------------------------------------------------
from fastapi.testclient import TestClient
from app.main import app  # noqa: E402  (must be after patches)
from app.db.mongo import mongodb  # noqa: E402


@pytest.fixture(scope="session")
def client() -> Generator:
    """Synchronous FastAPI test client (session-scoped for speed)."""
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def mock_mongodb(monkeypatch):
    """Prevent real MongoDB connect/disconnect during tests."""
    monkeypatch.setattr(mongodb, "connect", AsyncMock())
    monkeypatch.setattr(mongodb, "disconnect", AsyncMock())
