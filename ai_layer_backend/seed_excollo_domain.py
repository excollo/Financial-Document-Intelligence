"""
Seed: Populate Excollo domain with default prompts & subqueries.
"""
import os, sys
from datetime import datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from pymongo import MongoClient
from app.services.summarization.prompts import (
    SUBQUERIES,
    MAIN_SUMMARY_SYSTEM_PROMPT,
    SUMMARY_VALIDATOR_SYSTEM_PROMPT,
)

MONGODB_URI = "mongodb+srv://sonuv:Sonu12345@cluster0.makyp.mongodb.net/pdf-summarizer"
DOMAIN_ID = "domain_excollo-com_1762104581969"

def main():
    print("Connecting to MongoDB...")
    client = MongoClient(MONGODB_URI)
    db = client.get_default_database()
    domains = db["domains"]

    existing = domains.find_one({"domainId": DOMAIN_ID})
    if existing:
        print(f"Found existing domain: {existing.get('domainName', 'N/A')}")
    else:
        print(f"Domain not found, will create: {DOMAIN_ID}")

    update_data = {
        "agent3_prompt": MAIN_SUMMARY_SYSTEM_PROMPT,
        "agent4_prompt": SUMMARY_VALIDATOR_SYSTEM_PROMPT,
        "custom_subqueries": list(SUBQUERIES),
        "target_investors": [],
        "onboarding_status": "completed",
        "last_onboarded": datetime.utcnow(),
        "updatedAt": datetime.utcnow(),
    }

    result = domains.update_one(
        {"domainId": DOMAIN_ID},
        {
            "$set": update_data,
            "$setOnInsert": {
                "domainId": DOMAIN_ID,
                "domainName": "excollo.com",
                "createdAt": datetime.utcnow(),
                "status": "active",
                "investor_match_only": True,
                "valuation_matching": True,
                "adverse_finding": True,
            }
        },
        upsert=True,
    )

    print(f"Matched: {result.matched_count}, Modified: {result.modified_count}, Upserted: {result.upserted_id or 'N/A'}")

    # Verify
    updated = domains.find_one({"domainId": DOMAIN_ID})
    print(f"VERIFICATION:")
    print(f"  domainId:          {updated.get('domainId')}")
    print(f"  domainName:        {updated.get('domainName')}")
    print(f"  onboarding_status: {updated.get('onboarding_status')}")
    print(f"  last_onboarded:    {updated.get('last_onboarded')}")
    print(f"  agent3_prompt:     {len(updated.get('agent3_prompt', ''))} chars")
    print(f"  agent4_prompt:     {len(updated.get('agent4_prompt', ''))} chars")
    print(f"  subqueries:        {len(updated.get('custom_subqueries', []))} items")
    print(f"  target_investors:  {updated.get('target_investors', [])}")
    client.close()
    print("DONE")

if __name__ == "__main__":
    main()
