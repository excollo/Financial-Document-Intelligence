import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
import sys
import os

# Add app to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.config import settings

async def cleanup_redundant_fields():
    client = AsyncIOMotorClient(settings.MONGO_URI)
    db = client[settings.MONGO_DB_NAME]
    collection = db["domains"]
    
    print("Removing redundant agent1 and agent2 fields from MongoDB...")
    
    updates = {
        "$unset": {
            "agent1_prompt": "",
            "agent1_query": "",
            "agent2_prompt": "",
            "agent2_query": ""
        }
    }
    
    result = await collection.update_many({}, updates)
    print(f"Cleanup complete! Modified {result.modified_count} domains.")

if __name__ == "__main__":
    asyncio.run(cleanup_redundant_fields())
