"""
Adverse Findings Processor — performs external web search research 
on the identified company and promoters to find negative news.
"""
from typing import Dict, Any, List, Optional
from app.workers.job_context import JobContext
from app.services.summarization.research import research_service
from app.core.logging import get_logger

logger = get_logger(__name__)


class AdverseFindingProcessor:
    """
    Processor to handle adverse findings research.
    Runs after the main document sections are extracted 
    to ensure company name and promoters are available.
    """

    def __init__(self, context: JobContext):
        self.ctx = context

    async def run(self):
        """Execute the adverse research flow."""
        # 1. Retrieve company details from JobContext
        company_name = self.ctx.get_field("company_name")
        promoters = self.ctx.get_field("promoters", "")
        
        # Fallback if company_name was not found under that specific key
        if not company_name:
            # We can try other common keys if the SOP used a different field_id
            company_name = self.ctx.get_field("issuer_company") or self.ctx.get_field("company")
            
        if not company_name:
            logger.warning("Adverse Research skipped: Could not find company name in extracted fields")
            return

        logger.info(f"Starting adverse findings research for: {company_name}")
        
        try:
            # 2. Call OpenAI with Web Search
            research_data = await research_service.research_company(
                company_name=str(company_name),
                promoters=str(promoters)
            )
            
            # 3. Flatten and Submit Findings
            findings_submitted = 0
            
            # Layer-wise findings (Layer 1, 2, 3 as defined in ResearchService)
            detailed = research_data.get("detailed_findings", {})
            layers = ["layer1_sanctions", "layer2_legal_regulatory", "layer3_osint_media"]
            
            for layer in layers:
                findings_list = detailed.get(layer, [])
                if not isinstance(findings_list, list):
                    continue
                    
                for item in findings_list:
                    # Map LLM JSON to AdverseFinding model
                    await self.ctx.submit_adverse_finding(
                        entity_name=str(company_name),
                        finding_type=layer.replace("layer", "").replace("_", " ").title().strip(),
                        severity=item.get("severity", "Medium"),
                        title=item.get("title", "Adverse Finding"),
                        description=item.get("summary", item.get("description", "N/A")),
                        source_url=item.get("source_url") or item.get("source"),
                        confidence_score=research_data.get("executive_summary", {}).get("confidence_overall", 0.8),
                        risk_assessment={
                            "layer": layer,
                            "impact": item.get("impact", "N/A"),
                            "status": item.get("status", "pending")
                        }
                    )
                    findings_submitted += 1

            logger.info(f"Adverse findings processed. Submitted {findings_submitted} findings.")
            
        except Exception as e:
            logger.error(f"AdverseFindingsProcessor failed", error=str(e))
            # Non-blocking failure: the job continues even if research fails.
