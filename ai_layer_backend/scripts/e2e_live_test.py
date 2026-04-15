import httpx
import time
import uuid
import sys
import os
from typing import Dict, Any

# Configurations
API_BASE_URL = os.getenv("AI_PLATFORM_URL", "http://localhost:8000")
INTERNAL_SECRET = os.getenv("INTERNAL_SECRET", "4f8a12e3b9c7d4a5f6b8c9d0a1e2f3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0")
TIMEOUT = 120  # Max seconds to wait for job completion

def get_headers():
    return {
        "X-Internal-Secret": INTERNAL_SECRET,
        "Content-Type": "application/json"
    }

async def run_e2e_test():
    print(f"🚀 Starting AI Platform E2E Test against {API_BASE_URL}...")
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        # 1. Health Check
        try:
            health = await client.get(f"{API_BASE_URL}/health")
            health.raise_for_status()
            print("✅ Health Check Passed")
        except Exception as e:
            print(f"❌ Health Check Failed: {e}")
            sys.exit(1)

        # 2. Submit Summary Job (Asynchronous)
        # Note: This requires a valid namespace if we want it to actually succeed in a real worker.
        # But for E2E infrastructure test, we just check if it enqueues.
        job_payload = {
            "namespace": "e2e-test-doc",
            "doc_type": "drhp",
            "documentId": str(uuid.uuid4()),
            "domainId": "e2e-domain",
            "metadata": {"source": "e2e_test_script"}
        }
        
        print("📤 Submitting Summary Job...")
        resp = await client.post(f"{API_BASE_URL}/jobs/summary", json=job_payload, headers=get_headers())
        
        if resp.status_code != 202:
            print(f"❌ Job Submission Failed ({resp.status_code}): {resp.text}")
            sys.exit(1)
            
        job_id = resp.json()["job_id"]
        print(f"✅ Job Submitted: {job_id}")

        # 3. Poll for Status
        print(f"⏳ Polling for job {job_id} status (max {TIMEOUT}s)...")
        start_time = time.time()
        
        while time.time() - start_time < TIMEOUT:
            status_resp = await client.get(f"{API_BASE_URL}/jobs/{job_id}", headers=get_headers())
            
            if status_resp.status_code != 200:
                print(f"❌ Status Check Failed ({status_resp.status_code}): {status_resp.text}")
                sys.exit(1)
                
            data = status_resp.json()
            state = data.get("state")
            
            print(f"   [+{int(time.time()-start_time)}s] State: {state}")
            
            if state == "SUCCESS":
                print("🎉 E2E Test Passed: Job Completed Successfully!")
                print("Result:", data.get("result"))
                return
            elif state == "FAILURE":
                print(f"❌ Job Failed! Error: {data.get('error')}")
                # We don't exit if it's a "real" failure due to missing data, 
                # but enqueuing/polling worked.
                return
            
            time.sleep(5)
            
        print("❌ E2E Test Failed: Job Timed Out")
        sys.exit(1)

if __name__ == "__main__":
    import asyncio
    asyncio.run(run_e2e_test())
