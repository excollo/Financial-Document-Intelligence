from typing import Dict, Any, Optional
from datetime import datetime, timezone

from app.db.mongo import mongodb


class CheckpointStore:
    COLLECTION = "job_stage_checkpoints"

    async def mark_completed(self, job_id: str, stage_name: str, metadata: Optional[Dict[str, Any]] = None) -> None:
        collection = mongodb.get_collection(self.COLLECTION)
        await collection.update_one(
            {"job_id": job_id, "stage_name": stage_name},
            {
                "$set": {
                    "status": "completed",
                    "completed_at": datetime.now(timezone.utc),
                    "resumable_metadata": metadata or {},
                }
            },
            upsert=True,
        )

    async def mark_failed(self, job_id: str, stage_name: str, metadata: Optional[Dict[str, Any]] = None) -> None:
        collection = mongodb.get_collection(self.COLLECTION)
        await collection.update_one(
            {"job_id": job_id, "stage_name": stage_name},
            {
                "$set": {
                    "status": "failed",
                    "completed_at": None,
                    "resumable_metadata": metadata or {},
                }
            },
            upsert=True,
        )

    async def get_checkpoint(self, job_id: str, stage_name: str) -> Optional[Dict[str, Any]]:
        collection = mongodb.get_collection(self.COLLECTION)
        return await collection.find_one({"job_id": job_id, "stage_name": stage_name})


checkpoint_store = CheckpointStore()
