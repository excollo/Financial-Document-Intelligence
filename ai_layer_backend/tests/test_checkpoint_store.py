import pytest

from app.services.checkpoint_store import CheckpointStore


class FakeCollection:
    def __init__(self):
        self.data = {}

    async def update_one(self, query, update, upsert=False):
        key = (query["job_id"], query["stage_name"])
        current = self.data.get(key, {})
        current.update(update.get("$set", {}))
        self.data[key] = current

    async def find_one(self, query):
        return self.data.get((query["job_id"], query["stage_name"]))


@pytest.mark.asyncio
async def test_checkpoint_store_roundtrip(monkeypatch):
    store = CheckpointStore()
    fake = FakeCollection()

    from app.services import checkpoint_store as checkpoint_module
    monkeypatch.setattr(checkpoint_module.mongodb, "get_collection", lambda _: fake)

    await store.mark_completed("job-1", "ingestion", metadata={"pdf_sections": [1]})
    item = await store.get_checkpoint("job-1", "ingestion")
    assert item["status"] == "completed"
    assert item["resumable_metadata"]["pdf_sections"] == [1]
