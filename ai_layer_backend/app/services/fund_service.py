"""
Fund Service to fetch and cache Domain (Fund) configurations.

Supports both sync (Celery workers) and async (FastAPI) contexts.
Fetches tenant configuration including:
  - Feature toggles (investor_match_only, valuation_matching, adverse_finding)
  - Custom subqueries (from onboarding Task 1)
  - Custom Agent 3 prompt (from onboarding Task 2)
  - Custom Agent 4 prompt (from onboarding Task 3)
  - SOP text and metadata
"""
from typing import Dict, Any, Optional
from app.db.mongo import mongodb
from app.core.logging import get_logger

logger = get_logger(__name__)


class FundService:
    def __init__(self):
        self._collection_name = "domains"

    async def get_fund_config(self, domain_id: str) -> Dict[str, Any]:
        """
        Fetch fund configuration by domain_id (async for FastAPI routes).
        
        Returns the full tenant config including:
          - Feature toggles
          - Custom subqueries
          - Custom agent prompts
          - SOP text
        """
        if not domain_id:
            return {}

        try:
            if mongodb.sync_db is None:
                mongodb.connect_sync()
            
            collection = mongodb.get_sync_collection(self._collection_name)
            config = collection.find_one({"domainId": domain_id})
            
            if not config:
                logger.warning(f"Fund config not found for domain_id: {domain_id}")
                return {}
            
            # Remove MongoDB _id (not JSON serializable)
            if "_id" in config:
                del config["_id"]

            # Log what config was resolved
            logger.info(
                f"Fund config loaded for {domain_id}",
                has_custom_sop=bool(config.get("agent3_prompt")),
                has_custom_validator=bool(config.get("agent4_prompt")),
                has_custom_subqueries=bool(config.get("custom_subqueries")),
                onboarding_status=config.get("onboarding_status", "unknown"),
            )

            return config
        except Exception as e:
            logger.error(f"Failed to fetch fund config: {str(e)}")
            return {}

    def get_fund_config_sync(self, domain_id: str) -> Dict[str, Any]:
        """
        Synchronous version for Celery workers that cannot use async.
        """
        if not domain_id:
            return {}

        try:
            if mongodb.sync_db is None:
                mongodb.connect_sync()
            
            collection = mongodb.get_sync_collection(self._collection_name)
            config = collection.find_one({"domainId": domain_id})
            
            if not config:
                logger.warning(f"Fund config not found for domain_id: {domain_id}")
                return {}
            
            if "_id" in config:
                del config["_id"]
                
            return config
        except Exception as e:
            logger.error(f"Failed to fetch fund config (sync): {str(e)}")
            return {}


fund_service = FundService()
