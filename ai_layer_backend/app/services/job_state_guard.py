from typing import Optional

from app.db.mongo import mongodb


TERMINAL_STATUSES = {"completed", "failed", "completed_with_errors"}


async def is_terminal_job(job_id: str, tenant_id: Optional[str] = None) -> bool:
    coll = mongodb.get_collection("jobs")
    query = {"id": job_id}
    if tenant_id:
        query["tenant_id"] = tenant_id
    job = await coll.find_one(query, {"status": 1})
    return bool(job and job.get("status") in TERMINAL_STATUSES)
