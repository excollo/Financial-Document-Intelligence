import logging
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from pymongo import MongoClient
import openai
import json
from app.core.config import settings
from app.core.openai_client import get_openai_client, DEPLOYMENT_MODEL
from app.services.summarization.prompts import (
    SUBQUERIES,
    INVESTOR_EXTRACTOR_SYSTEM_PROMPT,
    CAPITAL_HISTORY_EXTRACTOR_SYSTEM_PROMPT,
    BUSINESS_EXTRACTION_QUERIES,
    BUSINESS_TABLE_EXTRACTOR_SYSTEM_PROMPT,
    AGENT_4_SECTION_I_II_PROMPT,
    AGENT_5_SECTION_IV_V_PROMPT,
    AGENT_6_SECTION_VII_PROMPT,
    AGENT_7_SECTION_VIII_IX_PROMPT,
    AGENT_8_SECTION_X_PROMPT,
    AGENT_9_SECTION_XI_XII_PROMPT,
)
from app.services.onboarding.prompts import ONBOARDING_MASTER_SYSTEM_PROMPT

logger = logging.getLogger(__name__)


class OnboardingAgent:
    """
    Master Onboarding Agent - Analyzes Tenant SOPs and customizes the full 9-agent pipeline.
    Stores all specialized prompts and subqueries in the domain's MongoDB record.
    """

    def __init__(self):
        self.client = MongoClient(settings.MONGO_URI)
        self.db = self.client[settings.MONGO_DB_NAME]
        self.collection = self.db["domains"]
        self.openai_client = get_openai_client()

    def extract_text(self, file_content: bytes, filename: str) -> str:
        """Extracts text from PDF or DOCX file content."""
        import io
        text = ""
        try:
            if filename.lower().endswith(".pdf"):
                from PyPDF2 import PdfReader
                reader = PdfReader(io.BytesIO(file_content))
                for page in reader.pages:
                    text += (page.extract_text() or "") + "\n"
            elif filename.lower().endswith(".docx"):
                from docx import Document
                doc = Document(io.BytesIO(file_content))
                for para in doc.paragraphs:
                    text += para.text + "\n"
            else:
                text = file_content.decode("utf-8", errors="ignore")
        except Exception as e:
            logger.error(f"Error extracting text from {filename}: {e}")
            return ""
        return text

    def _get_baseline_context(self) -> str:
        """Serializes current 'Hardcoded' prompts/subqueries into context for the AI."""
        baseline = {
            "Agent 1": {"prompt": INVESTOR_EXTRACTOR_SYSTEM_PROMPT, "default_subqueries": ["Extract selling shareholders from DRHP"]},
            "Agent 2": {"prompt": CAPITAL_HISTORY_EXTRACTOR_SYSTEM_PROMPT, "default_subqueries": ["Extract capital history table"]},
            "Agent 3": {"prompt": BUSINESS_TABLE_EXTRACTOR_SYSTEM_PROMPT, "default_subqueries": BUSINESS_EXTRACTION_QUERIES},
            "Agent 4": {"prompt": AGENT_4_SECTION_I_II_PROMPT, "default_subqueries": [SUBQUERIES[0], SUBQUERIES[1]]},
            "Agent 5": {"prompt": AGENT_5_SECTION_IV_V_PROMPT, "default_subqueries": [SUBQUERIES[2], SUBQUERIES[3]]},
            "Agent 6": {"prompt": AGENT_6_SECTION_VII_PROMPT, "default_subqueries": [SUBQUERIES[5]]},
            "Agent 7": {"prompt": AGENT_7_SECTION_VIII_IX_PROMPT, "default_subqueries": [SUBQUERIES[6], SUBQUERIES[7]]},
            "Agent 8": {"prompt": AGENT_8_SECTION_X_PROMPT, "default_subqueries": [SUBQUERIES[8]]},
            "Agent 9": {"prompt": AGENT_9_SECTION_XI_XII_PROMPT, "default_subqueries": [SUBQUERIES[9], SUBQUERIES[10]]},
        }
        return json.dumps(baseline, indent=2)

    def process_new_tenant(
        self,
        domain_id: str,
        sop_text: str,
        toggles: dict = None,
    ) -> bool:
        """Analyzes SOP and generates 9 customized agents (prompts + subqueries)."""
        logger.info(f"Starting Master Onboarding for domain: {domain_id}")
        
        if not sop_text:
            logger.warning(f"No SOP provided for {domain_id}. Using defaults.")
            return self._save_to_mongodb(domain_id, {"onboarding_status": "completed_no_sop"})

        baseline_context = self._get_baseline_context()
        
        try:
            response = self.openai_client.chat.completions.create(
                model=DEPLOYMENT_MODEL,
                messages=[
                    {"role": "system", "content": ONBOARDING_MASTER_SYSTEM_PROMPT},
                    {"role": "user", "content": f"Analyze this SOP and Baseline Context. SOP:\n{sop_text}\n\nBaseline:\n{baseline_context}"}
                ],
                temperature=0.0,
                response_format={"type": "json_object"}
            )
            
            result = json.loads(response.choices[0].message.content)
            logger.info(f"Successfully generated 9-agent customization from SOP for {domain_id}")

            # Prepare update payload for MongoDB
            update_data = {
                "sop_text": sop_text,
                "onboarding_status": "completed",
                "last_onboarded": datetime.now(timezone.utc).isoformat(),
                "analysis_summary": result.get("analysis_summary", "")
            }

            # Map the 9 customized prompts and subqueries
            for i in range(1, 10):
                update_data[f"agent{i}_prompt"] = result.get(f"agent{i}_prompt", "")
                update_data[f"agent{i}_subqueries"] = result.get(f"agent{i}_subqueries", [])

            # Merge in toggles if provided
            if toggles:
                for key, val in toggles.items():
                    if key in ["investor_match_only", "valuation_matching", "adverse_finding", "target_investors"]:
                        update_data[key] = val

            return self._save_to_mongodb(domain_id, update_data)

        except Exception as e:
            logger.error(f"Onboarding Agent failed for {domain_id}: {str(e)}", exc_info=True)
            return False

    def _save_to_mongodb(self, domain_id: str, update_data: Dict[str, Any]) -> bool:
        """Saves config to MongoDB (domainId key)."""
        try:
            result = self.collection.update_one(
                {"domainId": domain_id},
                {"$set": update_data},
                upsert=True
            )
            logger.info(f"MongoDB Onboarding update for {domain_id}: matched={result.matched_count}, modified={result.modified_count}")
            return True
        except Exception as e:
            logger.error(f"Failed to save onboarding config: {e}")
            return False


def onboard_tenant(domain_id: str, sop_text: str, toggles: dict = None) -> bool:
    """Public API for onboarding."""
    agent = OnboardingAgent()
    return agent.process_new_tenant(domain_id, sop_text, toggles)

def onboard_tenant(domain_id: str, sop_text: str, toggles: dict = None) -> bool:
    """Public API for onboarding."""
    agent = OnboardingAgent()
    return agent.process_new_tenant(domain_id, sop_text, toggles)
