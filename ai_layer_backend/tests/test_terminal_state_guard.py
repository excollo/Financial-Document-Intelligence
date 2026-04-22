import pytest

from app.services.job_state_guard import is_terminal_job


class FakeCollection:
    def __init__(self, status):
        self.status = status

    async def find_one(self, query, projection):
        return {"status": self.status}


@pytest.mark.asyncio
@pytest.mark.parametrize("status,expected", [
    ("completed", True),
    ("failed", True),
    ("completed_with_errors", True),
    ("processing", False),
])
async def test_terminal_state_detection(monkeypatch, status, expected):
    from app.services import job_state_guard as module
    monkeypatch.setattr(module.mongodb, "get_collection", lambda _: FakeCollection(status))
    result = await is_terminal_job("job-1", "tenant-1")
    assert result is expected
