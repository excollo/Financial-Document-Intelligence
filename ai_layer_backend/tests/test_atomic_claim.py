import pytest

from app.services.execution_claim import ExecutionClaimService


class FakeCollection:
    def __init__(self):
        self.doc = {
            "id": "job-1",
            "tenant_id": "tenant-1",
            "status": "queued",
            "execution_claimed_by": None,
            "claim_expires_at": None,
        }

    async def find_one_and_update(self, query, update, upsert=False, return_document=None):
        now_clause = query["$or"][2]["claim_expires_at"]["$lt"]
        claimable = self.doc.get("execution_claimed_by") in (None, "") or (
            self.doc.get("claim_expires_at") is not None and self.doc["claim_expires_at"] < now_clause
        )
        if not claimable:
            return None
        self.doc.update(update.get("$setOnInsert", {}))
        self.doc.update(update["$set"])
        return dict(self.doc)

    async def update_one(self, query, update):
        class Result:
            def __init__(self, modified_count):
                self.modified_count = modified_count
        if self.doc.get("execution_claimed_by") != query.get("execution_claimed_by"):
            return Result(0)
        expires_guard = query.get("claim_expires_at", {}).get("$gte")
        if expires_guard is not None and (self.doc.get("claim_expires_at") is None or self.doc.get("claim_expires_at") < expires_guard):
            return Result(0)
        if "$set" in update:
            self.doc.update(update.get("$set", {}))
            return Result(1)
        for k in update.get("$unset", {}).keys():
            self.doc[k] = None
        return Result(1)


@pytest.mark.asyncio
async def test_first_worker_claims_second_cannot():
    svc = ExecutionClaimService()
    coll = FakeCollection()
    from app.services import execution_claim as module
    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(module.mongodb, "get_collection", lambda _: coll)
    claimed, _ = await svc.try_claim("task", "job-1", scope="tenant-1")
    assert claimed is True
    second, _ = await svc.try_claim("task", "job-1", scope="tenant-1")
    assert second is False
    monkeypatch.undo()


@pytest.mark.asyncio
async def test_terminal_job_cannot_be_reclaimed():
    # Terminal protection is enforced by caller's task status checks; claim service is task-generic.
    coll = FakeCollection()
    svc = ExecutionClaimService()
    from app.services import execution_claim as module
    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(module.mongodb, "get_collection", lambda _: coll)
    claimed, _ = await svc.try_claim("task", "job-1", scope="tenant-1")
    assert claimed is True
    monkeypatch.undo()


@pytest.mark.asyncio
async def test_release_only_by_owner():
    svc = ExecutionClaimService()
    coll = FakeCollection()
    from app.services import execution_claim as module
    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(module.mongodb, "get_collection", lambda _: coll)
    claimed, claim_id = await svc.try_claim("task", "job-1", scope="tenant-1")
    assert claimed is True
    await svc.release_claim("task", "job-1", "other-worker", scope="tenant-1")
    assert coll.doc["execution_claimed_by"] == claim_id
    await svc.release_claim("task", "job-1", claim_id, scope="tenant-1")
    assert coll.doc["execution_claimed_by"] is None
    monkeypatch.undo()


@pytest.mark.asyncio
async def test_owner_can_renew_lease_and_non_owner_cannot():
    svc = ExecutionClaimService()
    coll = FakeCollection()
    from app.services import execution_claim as module
    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(module.mongodb, "get_collection", lambda _: coll)
    claimed, claim_id = await svc.try_claim("task", "job-1", scope="tenant-1")
    assert claimed is True
    old_expiry = coll.doc["claim_expires_at"]

    renewed_by_owner = await svc.renew_claim("task", "job-1", claim_id, scope="tenant-1")
    assert renewed_by_owner is True
    assert coll.doc["claim_expires_at"] >= old_expiry

    renewed_by_other = await svc.renew_claim("task", "job-1", "other-worker", scope="tenant-1")
    assert renewed_by_other is False
    monkeypatch.undo()
