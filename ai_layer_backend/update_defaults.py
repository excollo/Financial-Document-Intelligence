import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
import sys
import os

# Add app to path if script is run from project root
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.summarization.prompts import (
    MAIN_SUMMARY_SYSTEM_PROMPT,
    SUBQUERIES,
    BUSINESS_TABLE_EXTRACTOR_SYSTEM_PROMPT,
    BUSINESS_EXTRACTION_QUERIES,
    INVESTOR_EXTRACTOR_SYSTEM_PROMPT,
    CAPITAL_HISTORY_EXTRACTOR_SYSTEM_PROMPT,
    RESEARCH_SYSTEM_PROMPT
)
from app.core.config import settings

async def update_domain_schemas():
    client = AsyncIOMotorClient(settings.MONGO_URI)
    db = client[settings.MONGO_DB_NAME]
    collection = db["domains"]
    
    print("Updating existing domains with default prompts and subqueries...")
    
    # Target updates
    updates = {
        "$set": {
            "agent3_prompt": BUSINESS_TABLE_EXTRACTOR_SYSTEM_PROMPT,
            "agent3_subqueries": BUSINESS_EXTRACTION_QUERIES,
            "agent4_prompt": MAIN_SUMMARY_SYSTEM_PROMPT,
            "agent4_subqueries": SUBQUERIES,
            "agent5_prompt": RESEARCH_SYSTEM_PROMPT
        }
    }
    
    # We want to update all existing domains with empty or non-existent prompts
    result = await collection.update_many({}, updates)
    print(f"Update complete! Modified {result.modified_count} domains.")

if __name__ == "__main__":
    asyncio.run(update_domain_schemas())
