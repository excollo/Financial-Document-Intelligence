import os
import time
from typing import Optional, Tuple

from pymongo import ReturnDocument
from app.db.mongo import mongodb


class ExecutionClaimService:
    COLLECTION = "execution_claims"

    async def try_claim(self, task_name: str, job_id: str, scope: Optional[str] = None) -> Tuple[bool, str]:
        now_ts = time.time()
        lease_seconds = int(os.environ.get("EXECUTION_CLAIM_LEASE_SECONDS", "3600"))
        claim_id = f"{task_name}:{job_id}:{int(now_ts * 1000)}"
        coll = mongodb.get_collection(self.COLLECTION)
        doc = await coll.find_one_and_update(
            {
                "task_name": task_name,
                "job_id": job_id,
                "scope": scope or "global",
                "$or": [
                    {"execution_claimed_by": {"$exists": False}},
                    {"execution_claimed_by": None},
                    {"claim_expires_at": {"$lt": now_ts}},
                ],
            },
            {
                "$setOnInsert": {
                    "task_name": task_name,
                    "job_id": job_id,
                    "scope": scope or "global",
                },
                "$set": {
                    "execution_claimed_at": now_ts,
                    "execution_claimed_by": claim_id,
                    "claim_expires_at": now_ts + lease_seconds,
                },
            },
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
        return bool(doc and doc.get("execution_claimed_by") == claim_id), claim_id

    async def release_claim(self, task_name: str, job_id: str, claim_id: str, scope: Optional[str] = None):
        coll = mongodb.get_collection(self.COLLECTION)
        await coll.update_one(
            {
                "task_name": task_name,
                "job_id": job_id,
                "scope": scope or "global",
                "execution_claimed_by": claim_id,
            },
            {"$unset": {"execution_claimed_at": "", "execution_claimed_by": "", "claim_expires_at": ""}},
        )

    async def renew_claim(self, task_name: str, job_id: str, claim_id: str, scope: Optional[str] = None) -> bool:
        coll = mongodb.get_collection(self.COLLECTION)
        now_ts = time.time()
        lease_seconds = int(os.environ.get("EXECUTION_CLAIM_LEASE_SECONDS", "3600"))
        result = await coll.update_one(
            {
                "task_name": task_name,
                "job_id": job_id,
                "scope": scope or "global",
                "execution_claimed_by": claim_id,
                "claim_expires_at": {"$gte": now_ts},
            },
            {
                "$set": {
                    "execution_claimed_at": now_ts,
                    "claim_expires_at": now_ts + lease_seconds,
                }
            },
        )
        return bool(getattr(result, "modified_count", 0))


execution_claim_service = ExecutionClaimService()
