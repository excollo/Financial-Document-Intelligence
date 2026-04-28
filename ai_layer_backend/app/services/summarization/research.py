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
from datetime import datetime
import re
from typing import Dict, Any, Optional
import openai
import httpx
from app.core.config import settings
from app.core.logging import get_logger
from app.services.summarization.prompts import RESEARCH_SYSTEM_PROMPT

logger = get_logger(__name__)


class ResearchService:
    """
    Performs adverse findings research using OpenAI with web search.
    Matches n8n 'Message a model2' node (OpenAI + builtInTools.webSearch).
    """

    def __init__(self):
        self.client = openai.AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
        # Model name matches n8n request exactly
        self.model = "gpt-5-mini"
        # Auto-disable tool mode when SDK parsing bug is observed.
        self._responses_tools_enabled = True

    async def _responses_create_http(
        self,
        instructions: str,
        user_content: str,
        use_tools: bool = True,
    ) -> Dict[str, Any]:
        """
        Direct HTTP fallback for /v1/responses to bypass SDK typed parsing issues.
        Returns raw JSON payload.
        """
        payload: Dict[str, Any] = {
            "model": self.model,
            "instructions": instructions,
            "input": user_content,
        }
        if use_tools:
            payload["tools"] = [{"type": "web_search_preview", "search_context_size": "medium"}]

        headers = {
            "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
            "Content-Type": "application/json",
        }
        async with httpx.AsyncClient(timeout=240.0) as client:
            resp = await client.post(
                "https://api.openai.com/v1/responses",
                headers=headers,
                json=payload,
            )
            resp.raise_for_status()
            return resp.json()

    @staticmethod
    def _extract_text_usage_from_responses_payload(payload: Dict[str, Any]) -> tuple[str, int, int]:
        raw_text = (payload or {}).get("output_text") or ""
        if not raw_text:
            chunks = []
            for item in (payload or {}).get("output", []) or []:
                for c in item.get("content", []) or []:
                    if c.get("type") in ("output_text", "text"):
                        txt = c.get("text")
                        if txt:
                            chunks.append(txt)
            raw_text = "\n".join(chunks).strip()
        usage = (payload or {}).get("usage", {}) or {}
        input_tokens = int(usage.get("input_tokens", 0) or 0)
        output_tokens = int(usage.get("output_tokens", 0) or 0)
        return raw_text, input_tokens, output_tokens

    async def research_company(
        self,
        company_name: str,
        promoters: str = "",
        directory_name: str = "",
        custom_sop: Optional[str] = None,
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
        if directory_name:
            user_content += f"\nDirectory/Deal Name: {directory_name}"

        try:
            # -----------------------------------------------------------------
            # n8n-compatible call style: Responses API + web_search_preview tool.
            # If SDK tool parsing fails once, disable tool mode for this process.
            # -----------------------------------------------------------------
            request_kwargs = dict(
                model=self.model,
                instructions=research_sop,
                input=user_content,
            )
            if self._responses_tools_enabled:
                request_kwargs["tools"] = [{"type": "web_search_preview", "search_context_size": "medium"}]
            response = await self.client.responses.create(**request_kwargs)

            raw_text = getattr(response, "output_text", "") or ""
            if not raw_text:
                # Fallback extraction for SDK variants where output_text isn't populated.
                output = getattr(response, "output", None) or []
                chunks = []
                for item in output:
                    for c in getattr(item, "content", None) or []:
                        if getattr(c, "type", None) in ("output_text", "text"):
                            txt = getattr(c, "text", None)
                            if txt:
                                chunks.append(txt)
                raw_text = "\n".join(chunks).strip()
            usage = getattr(response, "usage", None)
            input_tokens = int(getattr(usage, "input_tokens", 0) or 0)
            output_tokens = int(getattr(usage, "output_tokens", 0) or 0)

            parsed = self._parse_json_from_text(raw_text)
            parsed["_usage"] = {"input": input_tokens, "output": output_tokens}
            parsed_metadata = parsed.get("metadata") if isinstance(parsed.get("metadata"), dict) else {}
            parsed_metadata["company"] = parsed_metadata.get("company") or company_name
            if promoters and not parsed_metadata.get("promoters"):
                parsed_metadata["promoters"] = promoters
            if not parsed_metadata.get("investigation_date"):
                parsed_metadata["investigation_date"] = datetime.utcnow().strftime("%Y-%m-%d")
            if directory_name:
                parsed_metadata["directory_name"] = directory_name
            parsed["metadata"] = parsed_metadata

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
            # Guardrail for known SDK typing error:
            # "'typing.Union' object has no attribute '__discriminator__'"
            # Retry once without tools before falling back to chat completion.
            if "__discriminator__" in str(e) or "typing.Union" in str(e):
                try:
                    logger.warning(
                        "Research: SDK Union parse issue detected; retrying via raw HTTP responses API",
                    )
                    payload = await self._responses_create_http(
                        instructions=research_sop,
                        user_content=user_content,
                        use_tools=True,
                    )
                    raw_text, input_tokens, output_tokens = self._extract_text_usage_from_responses_payload(payload)
                    parsed = self._parse_json_from_text(raw_text)
                    parsed["_usage"] = {"input": input_tokens, "output": output_tokens}
                    parsed_metadata = parsed.get("metadata") if isinstance(parsed.get("metadata"), dict) else {}
                    parsed_metadata["company"] = parsed_metadata.get("company") or company_name
                    if promoters and not parsed_metadata.get("promoters"):
                        parsed_metadata["promoters"] = promoters
                    if not parsed_metadata.get("investigation_date"):
                        parsed_metadata["investigation_date"] = datetime.utcnow().strftime("%Y-%m-%d")
                    if directory_name:
                        parsed_metadata["directory_name"] = directory_name
                    parsed["metadata"] = parsed_metadata
                    return parsed
                except Exception as retry_err:
                    logger.error("Research: Raw HTTP retry failed", error=str(retry_err))
                    # As last resort, disable tools in-process and continue with fallback methods.
                    self._responses_tools_enabled = False
            else:
                logger.error(
                    "Research: OpenAI research failed",
                    error=str(e),
                )
            return await self._research_fallback(
                user_content=user_content,
                original_error=str(e),
                custom_sop=research_sop,
            )

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
            parsed_metadata = parsed.get("metadata") if isinstance(parsed.get("metadata"), dict) else {}
            if not parsed_metadata.get("investigation_date"):
                parsed_metadata["investigation_date"] = datetime.utcnow().strftime("%Y-%m-%d")
            parsed["metadata"] = parsed_metadata
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
