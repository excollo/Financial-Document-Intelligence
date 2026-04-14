"""
Adverse Findings Research Service.
Matches n8n "Message a model2" node:
  - Model: gpt-4.1-mini (n8n uses gpt-5-mini alias)
  - Built-in tool: webSearch (searchContextSize: "medium")
  - System prompt: RESEARCH_SYSTEM_PROMPT (forensic analyst)
  - Input: company_name from investor agent output
  - Returns: JSON in the exact structure expected by convert_research_json_to_markdown()
"""
import json
import re
from typing import Dict, Any, Optional
import openai
from app.core.config import settings
from app.core.logging import get_logger
from app.core.openai_client import get_async_openai_client, DEPLOYMENT_MODEL
from app.services.summarization.prompts import RESEARCH_SYSTEM_PROMPT

logger = get_logger(__name__)


class ResearchService:
    """
    Performs adverse findings research using OpenAI with web search.
    Matches n8n 'Message a model2' node (OpenAI + builtInTools.webSearch).
    """

    def __init__(self):
        self.client = get_async_openai_client()
        self.model = DEPLOYMENT_MODEL

    async def research_company(
        self, company_name: str, promoters: str = "", custom_sop: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Main research method called by pipeline.
        
        n8n flow replicated:
          company_name  →  Message a model2 (OpenAI + web_search_preview)
                       →  Returns JSON { metadata, executive_summary, ... }
        """
        if not company_name or not company_name.strip():
            logger.warning("Research: no company name provided, skipping")
            return self._empty_result("No company name provided")

        logger.info("Research: Starting adverse findings", company=company_name)

        research_sop = custom_sop if custom_sop else RESEARCH_SYSTEM_PROMPT

        # User prompt matches n8n: {{ $json.output.company_name }}
        user_content = company_name.strip()
        if promoters:
            user_content += f"\nPromoters/Key Persons: {promoters}"

        try:
            # -----------------------------------------------------------------
            # OpenAI Chat Completions with web_search_preview tool
            # Matches n8n builtInTools.webSearch { searchContextSize: "medium" }
            # -----------------------------------------------------------------
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": research_sop},
                    {"role": "user", "content": user_content},
                ]
            )

            raw_text = response.choices[0].message.content or ""
            usage = response.usage
            input_tokens = usage.prompt_tokens if usage else 0
            output_tokens = usage.completion_tokens if usage else 0

            parsed = self._parse_json_from_text(raw_text)
            parsed["_usage"] = {"input": input_tokens, "output": output_tokens}

            logger.info(
                "Research: Completed",
                company=company_name,
                adverse_flag=parsed.get("executive_summary", {}).get("adverse_flag"),
                risk_level=parsed.get("executive_summary", {}).get("risk_level"),
                input_tokens=input_tokens,
                output_tokens=output_tokens,
            )
            return parsed

        except Exception as e:
            logger.error(
                "Research: OpenAI research failed",
                error=str(e),
            )
            result = self._empty_result(f"Research failed: {str(e)}")
            result["_usage"] = {"input": 0, "output": 0}
            return result

    async def _research_fallback(
        self, user_content: str, original_error: str, custom_sop: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Fallback: plain chat completion without web search tool.
        Used when Responses API / web search is unavailable.
        """
        try:
            research_sop = custom_sop if custom_sop else RESEARCH_SYSTEM_PROMPT
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": research_sop},
                    {"role": "user", "content": user_content},
                ],
                response_format={"type": "json_object"},
            )
            raw_text = response.choices[0].message.content or ""
            usage = response.usage
            parsed = self._parse_json_from_text(raw_text)
            parsed["_usage"] = {
                "input": usage.prompt_tokens if usage else 0,
                "output": usage.completion_tokens if usage else 0,
            }
            logger.info("Research: Fallback chat completion succeeded")
            return parsed
        except Exception as e2:
            logger.error("Research: Fallback also failed", error=str(e2))
            result = self._empty_result(f"Research failed: {original_error}")
            result["_usage"] = {"input": 0, "output": 0}
            return result

    @staticmethod
    def _parse_json_from_text(raw: str) -> Dict[str, Any]:
        """
        Matches n8n 'convert in mdn3' JSON extraction logic:
          1. Remove code fences
          2. Find JSON object via regex
          3. Safe JSON.parse
        """
        if not raw:
            return {}

        # Remove code fences (matches n8n: replace /^```json/i, /^```/, /```$/g)
        cleaned = re.sub(r"^```json", "", raw.strip(), flags=re.IGNORECASE)
        cleaned = re.sub(r"^```", "", cleaned.strip())
        cleaned = re.sub(r"```$", "", cleaned.strip()).strip()

        # Find JSON object (matches n8n: raw.match(/\{[\s\S]*\}/))
        json_match = re.search(r"\{[\s\S]*\}", cleaned)
        if json_match:
            cleaned = json_match.group(0)

        try:
            return json.loads(cleaned)
        except (json.JSONDecodeError, ValueError):
            return {
                "executive_summary": {
                    "key_findings": f"Failed to parse research output: {raw[:300]}"
                }
            }

    @staticmethod
    def _empty_result(reason: str) -> Dict[str, Any]:
        return {
            "metadata": {"company": "Unknown", "promoters": "N/A"},
            "executive_summary": {
                "adverse_flag": False,
                "risk_level": "Low",
                "confidence_overall": 0.0,
                "key_findings": reason,
                "red_flags_count": {
                    "sanctions": 0,
                    "enforcement_actions": 0,
                    "criminal_cases": 0,
                    "high_risk_media": 0,
                },
                "recommended_action": "proceed",
            },
            "detailed_findings": {
                "layer1_sanctions": [],
                "layer2_legal_regulatory": [],
                "layer3_osint_media": [],
            },
            "entity_network": {
                "associated_companies": [],
                "associated_persons": [],
                "beneficial_owners_identified": [],
                "related_entities_in_adverse_actions": [],
            },
            "risk_assessment": {
                "financial_crime_risk": "Low",
                "regulatory_compliance_risk": "Low",
                "reputational_risk": "Low",
                "sanctions_risk": "Low",
                "litigation_risk": "Low",
                "overall_risk_score": 0.0,
                "risk_factors": ["No adverse findings detected"],
            },
            "gaps_and_limitations": [],
            "next_steps": [],
        }


research_service = ResearchService()
