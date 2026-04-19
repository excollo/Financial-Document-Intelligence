import httpx
import time
import uuid
import sys
import os
import asyncio
from typing import List, Dict, Any

# Configurations
API_BASE_URL = os.getenv("AI_PLATFORM_URL", "http://localhost:8000")
INTERNAL_SECRET = os.getenv("INTERNAL_SECRET", "4f8a12e3b9c7d4a5f6b8c9d0a1e2f3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0")
NUM_CONCURRENT_JOBS = 5
TIMEOUT = 300  # Max seconds to wait for all jobs

def get_headers():
    return {
        "X-Internal-Secret": INTERNAL_SECRET,
        "Content-Type": "application/json"
    }

async def poll_job(client, job_id: str) -> bool:
    """Polls a single job until SUCCESS or FAILURE."""
    start_time = time.time()
    while time.time() - start_time < TIMEOUT:
        try:
            resp = await client.get(f"{API_BASE_URL}/jobs/{job_id}", headers=get_headers())
            if resp.status_code == 200:
                data = resp.json()
                state = data.get("state")
                if state == "SUCCESS":
                    print(f"✅ Job {job_id[:8]}... SUCCESS")
                    return True
                elif state == "FAILURE":
                    print(f"❌ Job {job_id[:8]}... FAILURE: {data.get('error')}")
                    return False
            else:
                print(f"⚠️ Job {job_id[:8]}... Status error ({resp.status_code})")
            
        except Exception as e:
            print(f"⚠️ Job {job_id[:8]}... Poll error: {e}")
            
        await asyncio.sleep(10)
        
    print(f"⏰ Job {job_id[:8]}... TIMEOUT")
    return False

async def run_concurrency_test():
    print(f"🔥 Starting Concurrency E2E Test (Jobs: {NUM_CONCURRENT_JOBS})...")
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        # 1. Submit multiple jobs
        job_ids = []
        for i in range(NUM_CONCURRENT_JOBS):
            payload = {
                "namespace": f"concurrency-test-{i}",
                "doc_type": "drhp",
                "documentId": str(uuid.uuid4()),
                "domainId": "stress-test-domain",
                "metadata": {"batch": "concurrency_test", "index": i}
            }
            
            resp = await client.post(f"{API_BASE_URL}/jobs/summary", json=payload, headers=get_headers())
            if resp.status_code == 202:
                jid = resp.json()["job_id"]
                job_ids.append(jid)
                print(f"🚀 Job {i+1} enqueued: {jid[:8]}...")
            else:
                print(f"❌ Job {i+1} submission failed: {resp.text}")
        
        if not job_ids:
            print("❌ No jobs were successfully enqueued. Exiting.")
            sys.exit(1)

        # 2. Wait for all jobs to complete
        print(f"⏳ Waiting for {len(job_ids)} jobs to process...")
        results = await asyncio.gather(*(poll_job(client, jid) for jid in job_ids))
        
        success_count = sum(1 for r in results if r)
        print(f"📊 Final Results: {success_count}/{len(job_ids)} successful.")
        
        if success_count == len(job_ids):
            print("🌟 All concurrent jobs processed correctly!")
        else:
            print("⚠️ Some jobs failed or timed out.")

if __name__ == "__main__":
    asyncio.run(run_concurrency_test())
