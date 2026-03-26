
"""
Onboarding Agent - Tenant SOP Analysis & Configuration Generator

Handles the full onboarding workflow:
  Task 1: Subquery refactoring based on SOP analysis
  Task 2: Agent 3 prompt customization (Summarization Agent)
  Task 3: Agent 4 prompt customization (Summary Validator Agent)

Stores all configurations in MongoDB tenant domain schema.
Supports re-onboarding when SOP is updated.
"""

import logging
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from pymongo import MongoClient
from app.core.config import settings
from app.services.summarization.prompts import (
    SUBQUERIES,
    MAIN_SUMMARY_SYSTEM_PROMPT,
    BUSINESS_TABLE_EXTRACTOR_SYSTEM_PROMPT,
)
import openai
import json

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────
# Prompt Templates for the Onboarding Agent
# ─────────────────────────────────────────────

SUBQUERY_REFACTOR_SYSTEM_PROMPT = """
# ROLE: Senior Financial Systems Architect & Prompt Engineer
You are an expert at optimizing RAG (Retrieval-Augmented Generation) pipelines for Institutional Finance.

# TASK: 
Analyze a tenant's Standard Operating Procedure (SOP) and perform a high-precision refactoring of the DEFAULT SUBQUERIES. 
Your goal is to align the retrieval logic with the tenant's specific terminology and data extraction priorities.

## DEFAULT SUBQUERIES (Base Context):
{default_subqueries}

# CONSTRAINTS & LOGIC:
1. **FIXED COUNT**: You MUST return exactly 10 subqueries. If the SOP is brief, rephrase or merge default queries to maintain this count.
2. **TERMINOLOGY ALIGNMENT**: Replace generic terms (e.g., "Company") with tenant-specific terms found in the SOP.
3. **PRIORITIZATION**: If the SOP emphasizes certain metrics (e.g., EBITDA, ROE), adjust the corresponding subqueries to be more specific.
4. **NO DELETIONS**: Every extraction area in the default list must remain represented, even if reworded.
5. **ADDITIONS**: If the SOP demands a unique data point not covered by defaults, replace the least relevant default subquery with the new requirement.

# OUTPUT JSON STRUCTURE:
Return ONLY valid JSON:
{{
    "analysis": {{
        "sop_focus": "Primary objective of the tenant SOP",
        "terminology_changes": ["List of replaced terms"],
        "new_requirements": ["Unique data points from SOP"]
    }},
    "subqueries": [
        "Subquery 1 (Must be 10 total)",
        ...
    ],
    "changes_log": ["Surgical explanation of each modification"]
}}
"""

AGENT3_PROMPT_CUSTOMIZATION_SYSTEM_PROMPT = """
# ROLE: Lead AI Prompt Engineer (Fintech Summarization)
You specialize in modifying "Summarization System Prompts" using a Minimalist Modification Strategy.

# OBJECTIVE:
Inject tenant-specific SOP requirements into the BASE SUMMARIZATION PROMPT while preserving 100% of its core logic, accuracy constraints, and professional tone.

## BASE SYSTEM PROMPT:
{base_prompt}

# CUSTOMIZATION HIERARCHY (Order of Priority):
1. **Section Structure**: Reorder, add, or rename headers ONLY IF explicitly required by the SOP.
2. **Formatting Specs**: Adjust tables, column headers, or bullet styles if the SOP mandates a different reporting structure.
3. **Extraction Rules**: Add specific rules for how certain numbers must be handled (e.g., "Round to 2 decimals" or "Use Million instead of Crore").
4. **Mandatory Disclosures**: Append any required legalese or standard text the SOP specifies for every summary.

# CRITICAL RULES (DO NOT CHANGE):
- DO NOT remove "Zero Fabrication" or "Exact Transcription" rules.
- DO NOT change the "Audit Link" or "Contextual Reference" logic.
- DO NOT change the [STRICT MANDATORY TABLE FORMAT] for Section I and Section II. These sections must always be in table format.
- Keep the prompt concise; only make changes that are functionally necessary based on the SOP.

# OUTPUT:
Return the complete, ready-to-use customized system prompt string. No markdown code blocks. No preamble.
"""

AGENT3_BUSINESS_PROMPT_CUSTOMIZATION_SYSTEM_PROMPT = """
# ROLE: Lead AI Prompt Engineer (Fintech Summarization)
Your specialty is modifying "Our Business Table Extractor Prompts" for financial compliance.

# OBJECTIVE:
Customize the OUR BUSINESS TABLE EXTRACTOR system prompt to enforce the specific rules, checklists, and data points defined in the tenant's SOP related to the "Our Business" section.

## BASE BUSINESS EXTRACTOR PROMPT:
{base_prompt}

# CUSTOMIZATION LOGIC:
1. **Extraction Rules Synthesis**: Extract any specific requirements related to Business Model, Products, Revenue Breakdown, Concentration, etc., from the SOP and inject them into the extraction rules.
2. **Minimalism**: Maintain the existing strict format. Only update the "what" is being extracted based on the SOP's specific requirements for the "Our Business" section.

# OUTPUT:
Return only the full customized business table extractor prompt text. No explanation, no wrapper.
"""


class OnboardingAgent:
    """
    Handles tenant onboarding by analyzing SOP documents and generating
    customized pipeline configurations (subqueries, Agent 3 prompt, Agent 4 prompt).
    
    Stores all configs in MongoDB under the tenant's domain document.
    Supports re-onboarding when SOP is updated.
    """

    def __init__(self):
        self.client = MongoClient(settings.MONGO_URI)
        self.db = self.client[settings.MONGO_DB_NAME]
        self.collection = self.db["domains"]
        self.openai_client = openai.OpenAI(api_key=settings.OPENAI_API_KEY)

    # ─────────────────────────────────────────────
    # File Extraction Utility
    # ─────────────────────────────────────────────

    def extract_text(self, file_content: bytes, filename: str) -> str:
        """Extracts text from PDF or DOCX file content."""
        import io
        text = ""
        try:
            if filename.lower().endswith(".pdf"):
                from PyPDF2 import PdfReader
                reader = PdfReader(io.BytesIO(file_content))
                for page in reader.pages:
                    text += page.extract_text() + "\n"
            elif filename.lower().endswith(".docx"):
                from docx import Document
                doc = Document(io.BytesIO(file_content))
                for para in doc.paragraphs:
                    text += para.text + "\n"
            else:
                # Assume plain text
                text = file_content.decode("utf-8", errors="ignore")
        except Exception as e:
            logger.error(f"Error extracting text from {filename}: {e}")
            return ""
        return text

    # ─────────────────────────────────────────────
    # Task 0: SOP Text Analysis (Raw → Structured)
    # ─────────────────────────────────────────────

    def analyze_and_create_format_prompt(self, raw_sop_text: str) -> str:
        """
        Analyzes RAW SOP text (extracted from file) and converts it into a
        clean, structured PROMPT TEMPLATE similar to DEFAULT_SUMMARY_FORMAT.
        """
        system_instructions = """
        You are an expert Prompt Engineer.
        Your task is to convert a raw "Standard Operating Procedure" (SOP) document into a specialized "REQUIRED FORMAT AND STRUCTURE" prompt template.

        GOAL:
        Create a clean, markdown-formatted template that an AI agent uses to structure a financial summary.
        The output must be ONLY the format/structure part (like headers, bullet points, tables with placeholders).
        
        RULES:
        1. Read the raw SOP content.
        2. Identify all required sections, tables, and data points.
        3. Convert them into a template format using Markdown.
        4. Use placeholders like [Amount], [Date], [%], etc.
        5. Do NOT include instructions on "how" to extract (unless critical formatting notes).
        6. Start with "## REQUIRED FORMAT AND STRUCTURE:"
        
        RAW SOP CONTENT:
        {raw_sop}

        OUTPUT:
        Return ONLY the generated template string.
        """
        try:
            response = self.openai_client.chat.completions.create(
                model="gpt-4.1-mini",
                messages=[
                    {"role": "system", "content": system_instructions.format(raw_sop=raw_sop_text)},
                    {"role": "user", "content": "Generate the format template."}
                ],
                temperature=0.2,
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            logger.error(f"Failed to generate format prompt: {e}")
            return ""

    # ─────────────────────────────────────────────
    # Task 1: Subquery Refactoring
    # ─────────────────────────────────────────────

    def _task1_refactor_subqueries(self, sop_text: str) -> Dict[str, Any]:
        """
        Task 1: Compare tenant SOP vs existing subqueries.
        Identify missing areas, modify/extend subqueries as needed.
        
        Returns:
            {
                "subqueries": [...],
                "analysis": {...},
                "changes_log": [...]
            }
        """
        logger.info("Task 1: Subquery Refactoring - Starting")

        # Format default subqueries for the prompt
        default_sq_formatted = "\n".join(
            [f"{i+1}. {sq}" for i, sq in enumerate(SUBQUERIES)]
        )

        try:
            response = self.openai_client.chat.completions.create(
                model="gpt-4.1-mini",
                messages=[
                    {
                        "role": "system",
                        "content": SUBQUERY_REFACTOR_SYSTEM_PROMPT.format(
                            default_subqueries=default_sq_formatted
                        ),
                    },
                    {
                        "role": "user",
                        "content": f"Analyze this tenant SOP and refactor subqueries:\n\n{sop_text}",
                    },
                ],
                temperature=0.2,
                response_format={"type": "json_object"},
            )

            result = json.loads(response.choices[0].message.content)
            
            # Validate: Must have at least the default number of subqueries
            subqueries = result.get("subqueries", [])
            if len(subqueries) < len(SUBQUERIES):
                logger.warning(
                    f"Task 1: Generated fewer subqueries ({len(subqueries)}) than default ({len(SUBQUERIES)}). "
                    "Padding with defaults."
                )
                # Pad with any missing default subqueries
                for i in range(len(subqueries), len(SUBQUERIES)):
                    subqueries.append(SUBQUERIES[i])
                result["subqueries"] = subqueries

            logger.info(
                f"Task 1: Completed. Generated {len(subqueries)} subqueries. "
                f"Changes: {len(result.get('changes_log', []))}"
            )
            return result

        except Exception as e:
            logger.error(f"Task 1: Failed - {e}. Using default subqueries.")
            return {
                "subqueries": list(SUBQUERIES),  # Copy of defaults
                "analysis": {"error": str(e)},
                "changes_log": ["Fallback: Using default subqueries due to error"],
            }

    # ─────────────────────────────────────────────
    # Task 2: Agent 3 Prompt Customization
    # ─────────────────────────────────────────────

    def _task2_customize_agent3_prompt(self, sop_text: str) -> str:
        """
        Task 2: Customize the summarization agent (Agent 3) prompt
        based on the tenant's SOP requirements.
        
        Returns: Customized Agent 3 system prompt string.
        """
        logger.info("Task 2: Agent 3 Prompt Customization - Starting")

        try:
            response = self.openai_client.chat.completions.create(
                model="gpt-4.1-mini",
                messages=[
                    {
                        "role": "system",
                        "content": AGENT3_PROMPT_CUSTOMIZATION_SYSTEM_PROMPT.format(
                            base_prompt=MAIN_SUMMARY_SYSTEM_PROMPT
                        ),
                    },
                    {
                        "role": "user",
                        "content": f"Customize the summarization agent prompt based on this SOP:\n\n{sop_text}",
                    },
                ],
                temperature=0.2,
            )

            custom_prompt = response.choices[0].message.content.strip()
            logger.info(
                f"Task 2: Completed. Custom Agent 3 prompt length: {len(custom_prompt)} chars"
            )
            return custom_prompt

        except Exception as e:
            logger.error(f"Task 2: Failed - {e}. Using default Agent 3 prompt.")
            return MAIN_SUMMARY_SYSTEM_PROMPT

    # ─────────────────────────────────────────────
    # Task 3: Agent 3 Business Prompt Customization
    # ─────────────────────────────────────────────

    def _task3_customize_agent3_business_prompt(self, sop_text: str) -> str:
        """
        Task 3: Customize the business table extractor (Agent 3 Business) prompt
        based on the tenant's SOP validation rules.
        
        Returns: Customized Agent 3 Business system prompt string.
        """
        logger.info("Task 3: Agent 3 Business Prompt Customization - Starting")

        try:
            response = self.openai_client.chat.completions.create(
                model="gpt-4.1-mini",
                messages=[
                    {
                        "role": "system",
                        "content": AGENT3_BUSINESS_PROMPT_CUSTOMIZATION_SYSTEM_PROMPT.format(
                            base_prompt=BUSINESS_TABLE_EXTRACTOR_SYSTEM_PROMPT
                        ),
                    },
                    {
                        "role": "user",
                        "content": f"Customize the business table extractor agent prompt based on this SOP:\n\n{sop_text}",
                    },
                ],
                temperature=0.2,
            )

            custom_prompt = response.choices[0].message.content.strip()
            logger.info(
                f"Task 3: Completed. Custom Agent 3 Business prompt length: {len(custom_prompt)} chars"
            )
            return custom_prompt

        except Exception as e:
            logger.error(f"Task 3: Failed - {e}. Using default Agent 3 Business prompt.")
            return BUSINESS_TABLE_EXTRACTOR_SYSTEM_PROMPT

    # ─────────────────────────────────────────────
    # Main Onboarding Orchestrator
    # ─────────────────────────────────────────────

    def process_new_tenant(
        self,
        domain_id: str,
        custom_sop_input: str,
        is_raw_text: bool = False,
        toggles: dict = None,
    ) -> bool:
        """
        Processes a new tenant's onboarding configuration.
        Runs all 3 tasks sequentially, keeping SOP context throughout.
        Supports both initial onboarding and re-onboarding.

        Args:
            domain_id: Tenant domain ID
            custom_sop_input: Either the final template or RAW SOP text/file content
            is_raw_text: True if input is raw text that needs AI analysis first
            toggles: Feature flags (investor_match_only, valuation_matching, etc.)
        
        Returns:
            True if successfully onboarded, False otherwise.
        """
        if toggles is None:
            toggles = {}

        logger.info(f"═══════════════════════════════════════════════")
        logger.info(f"Onboarding Agent: Starting for domain {domain_id}")
        logger.info(f"═══════════════════════════════════════════════")

        # ── Step 0: If raw text (from file upload), convert to structured SOP ──
        final_sop_text = custom_sop_input
        if is_raw_text and custom_sop_input:
            logger.info("Step 0: Converting raw SOP text to structured template...")
            generated_format = self.analyze_and_create_format_prompt(custom_sop_input)
            if generated_format:
                final_sop_text = generated_format
                logger.info(f"Step 0: Generated structured SOP ({len(final_sop_text)} chars)")
            else:
                logger.warning("Step 0: Failed to generate structured SOP, using raw text")

        # If no SOP provided, store toggles only with empty SOP fields
        if not final_sop_text or not final_sop_text.strip():
            logger.info("No SOP provided. Storing toggles only, using default pipeline.")
            update_data = {
                "sop_text": "",
                "custom_subqueries": [],
                "agent3_prompt": "",
                "agent3_business_prompt": "",
                "onboarding_status": "completed_no_sop",
                "last_onboarded": datetime.now(timezone.utc).isoformat(),
                "investor_match_only": toggles.get("investor_match_only", False),
                "valuation_matching": toggles.get("valuation_matching", False),
                "adverse_finding": toggles.get("adverse_finding", False),
            }
            if "target_investors" in toggles:
                update_data["target_investors"] = toggles["target_investors"]

            return self._save_to_mongodb(domain_id, update_data)

        # ── Task 1: Subquery Refactoring ──
        logger.info("─── Task 1/3: Subquery Refactoring ───")
        subquery_result = self._task1_refactor_subqueries(final_sop_text)
        custom_subqueries = subquery_result.get("subqueries", list(SUBQUERIES))

        # ── Task 2: Agent 3 Prompt Customization ──
        logger.info("─── Task 2/3: Agent 3 Prompt Customization ───")
        agent3_prompt = self._task2_customize_agent3_prompt(final_sop_text)

        # ── Task 3: Agent 3 Business Prompt Customization ──
        logger.info("─── Task 3/3: Agent 3 Business Prompt Customization ───")
        agent3_business_prompt = self._task3_customize_agent3_business_prompt(final_sop_text)

        # ── Store Everything in MongoDB ──
        logger.info("Storing onboarding configuration in MongoDB...")
        update_data = {
            # SOP Storage
            "sop_text": custom_sop_input,        # Original uploaded SOP text

            # Task 1 output
            "custom_subqueries": custom_subqueries,
            "subquery_analysis": subquery_result.get("analysis", {}),
            "subquery_changes_log": subquery_result.get("changes_log", []),

            # Task 2 output: Agent 3 prompt (Summarization Agent)
            "agent3_prompt": agent3_prompt,

            # Task 3 output: Agent 3 Business Prompt
            "agent3_business_prompt": agent3_business_prompt,

            # Toggles
            "investor_match_only": toggles.get("investor_match_only", False),
            "valuation_matching": toggles.get("valuation_matching", False),
            "adverse_finding": toggles.get("adverse_finding", False),

            # Metadata
            "onboarding_status": "completed",
            "last_onboarded": datetime.now(timezone.utc).isoformat(),
        }

        if "target_investors" in toggles:
            update_data["target_investors"] = toggles["target_investors"]

        success = self._save_to_mongodb(domain_id, update_data)

        if success:
            logger.info(f"═══════════════════════════════════════════════")
            logger.info(f"Onboarding Agent: COMPLETED for domain {domain_id}")
            logger.info(f"  Subqueries: {len(custom_subqueries)} (default: {len(SUBQUERIES)})")
            logger.info(f"  Agent 3 Prompt: {len(agent3_prompt)} chars")
            logger.info(f"  Agent 3 Business Prompt: {len(agent3_business_prompt)} chars")
            logger.info(f"═══════════════════════════════════════════════")
        else:
            logger.error(f"Onboarding Agent: FAILED for domain {domain_id}")

        return success

    # ─────────────────────────────────────────────
    # MongoDB Storage
    # ─────────────────────────────────────────────

    def _save_to_mongodb(self, domain_id: str, update_data: Dict[str, Any]) -> bool:
        """Saves onboarding configuration to MongoDB (upsert).
        Also removes stale/duplicate fields that should not exist."""
        try:
            result = self.collection.update_one(
                {"domainId": domain_id},
                {
                    "$set": update_data,
                    # Remove stale duplicate fields (cleanup)
                    "$unset": {
                        "custom_summary_sop": "",
                        "custom_validator_prompt": "",
                    },
                },
                upsert=True,
            )
            logger.info(
                f"MongoDB update for {domain_id}: "
                f"matched={result.matched_count}, modified={result.modified_count}, "
                f"upserted_id={result.upserted_id}"
            )
            return True
        except Exception as e:
            logger.error(f"Failed to save onboarding config to MongoDB: {e}")
            return False


# ─────────────────────────────────────────────
# Public API Functions
# ─────────────────────────────────────────────

def onboard_tenant(
    domain_id: str,
    custom_sop_input: str,
    is_raw_text: bool,
    toggles: dict,
) -> bool:
    """
    Public function to trigger tenant onboarding.
    Called from API endpoint or scripts.
    """
    agent = OnboardingAgent()
    return agent.process_new_tenant(domain_id, custom_sop_input, is_raw_text, toggles)
