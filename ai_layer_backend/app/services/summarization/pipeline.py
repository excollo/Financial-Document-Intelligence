"""
DRHP Summary Pipeline - 4-Agent Orchestration
Matches n8n-workflows/summaryWorkflow.json implementation (v1.5)

Agent flow (all n8n-mapped):
  A-1  → Investor Extractor
  A-2  → Capital History Extractor
  A-3  → Section III Business Table Extractor
  A-4  → Summary Generator (12-section, SECTION I–XII)

Post-processing (all n8n-mapped):
  Code in JavaScript4         → Insert Section III between SECTION II and SECTION IV
  combine FULL MDN summary    → Insert investor/capital before SECTION VII,
                                 research before SECTION XII
  Date metadata wrapper
"""
import asyncio
import os
import re
import time
from typing import Dict, Any, List, Optional, Set
from datetime import datetime
from app.core.config import settings
from app.core.logging import get_logger
from app.core.memory import maybe_collect
from app.services.vector_store import vector_store_service
from app.services.embedding import EmbeddingService
from app.services.rerank import rerank_service
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
    TARGET_INVESTORS,
)
from app.services.summarization.markdown_converter import MarkdownConverter
from app.services.summarization.research import research_service
import openai
import json

logger = get_logger(__name__)

# Context soft caps (chars ≈ 4 chars/token rough upper bound). Truncation uses chunk/table boundaries only.
SUMMARY_AGENT_CONTEXT_MAX_CHARS = int(os.environ.get("SUMMARY_AGENT_CONTEXT_MAX_CHARS", "380000"))
SUMMARY_AGENT_A3_CONTEXT_MAX_CHARS = int(os.environ.get("SUMMARY_AGENT_A3_CONTEXT_MAX_CHARS", "520000"))
SUMMARY_MONGO_AGENT3_MAX_TABLES = int(os.environ.get("SUMMARY_MONGO_AGENT3_MAX_TABLES", "400"))
SUMMARY_MONGO_AGENT3_MAX_CHARS = int(os.environ.get("SUMMARY_MONGO_AGENT3_MAX_CHARS", "320000"))
SUMMARY_MONGO_AGENT6_MAX_TABLES = int(os.environ.get("SUMMARY_MONGO_AGENT6_MAX_TABLES", "280"))
SUMMARY_MONGO_AGENT6_MAX_CHARS = int(os.environ.get("SUMMARY_MONGO_AGENT6_MAX_CHARS", "400000"))


class SummaryPipeline:
    """
    4-Agent Summary Pipeline:
    - Agent 1: Investor Extractor (returns JSON)
    - Agent 2: Capital History & Section VI Summary (JSON + Markdown)
    - Agent 3: Business Table Extractor (Section III Markdown)
    - Agent 4: Section I & II Generator (Markdown)
    - Agent 5: Section IV & V Generator (Markdown)
    - Agent 6: Section VII Generator (Financial Specialist - Markdown)
    - Agent 7: Section VIII & IX Generator (Markdown)
    - Agent 8: Section X Generator (Markdown)
    - Agent 9: Section XI & XII Generator (Markdown)
    
    All outputs assembled sequentially from Section I to XII.
    """
    
    def __init__(self):
        self.embedding = EmbeddingService()
        self.client = openai.AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
        self.md_converter = MarkdownConverter()
    
    def _localize_prompt(self, text: str, doc_type: str) -> str:
        """
        Dynamically replaces "DRHP" or "Draft Red Herring Prospectus" 
        with the current doc_type (e.g., "RHP") if they differ.
        """
        if not text or not isinstance(text, str):
            return text
            
        if doc_type == "DRHP":
            return text
            
        # Replace occurrences of DRHP and Draft Red Herring Prospectus
        # case-insensitive but maintaining some sanity
        localized = re.sub(r"Draft Red Herring Prospectus", "Red Herring Prospectus", text, flags=re.IGNORECASE)
        localized = re.sub(r"\bDRHP\b", "RHP", localized) 
        # Also catch lower case drhp
        localized = re.sub(r"\bdrhp\b", "rhp", localized)
        
        return localized

    @staticmethod
    def _normalize_prompt(value: Any) -> Optional[str]:
        """Normalize prompt value from domain config."""
        if not isinstance(value, str):
            return None
        cleaned = value.strip()
        return cleaned if cleaned else None

    @staticmethod
    def _normalize_subqueries(value: Any) -> Optional[List[str]]:
        """Normalize subqueries value from domain config."""
        queries: List[str] = []
        if isinstance(value, list):
            queries = [str(v).strip() for v in value if str(v).strip()]
        elif isinstance(value, str):
            normalized = value.replace("\\r\\n", "\n").replace("\\n", "\n").replace("\\r", "\n")
            queries = [line.strip() for line in normalized.split("\n") if line.strip()]
        return queries if queries else None

    def _resolve_agent_config(
        self,
        tenant_config: Dict[str, Any],
        agent_id: int
    ) -> tuple[Optional[str], Optional[List[str]]]:
        """
        Resolve agent prompt/subqueries from tenant config.
        Empty values return None so the agent fallback prompt/subqueries are used.
        """
        prompt = self._normalize_prompt(tenant_config.get(f"agent{agent_id}_prompt"))
        subqueries = self._normalize_subqueries(tenant_config.get(f"agent{agent_id}_subqueries"))
        return prompt, subqueries

    def _post_process_final_markdown(self, markdown: str, doc_type: str) -> str:
        """
        Final cleanup before returning to user. 
        Enforces naming and removes common LLM redundancies.
        """
        if not markdown:
            return ""

        # 1. Enforce correct RHP/DRHP terminology in the final output
        markdown = self._localize_prompt(markdown, doc_type)
        
        # 2. Fix the Heading if it identifies incorrectly (common with GPT-4)
        if doc_type == "RHP":
             markdown = re.sub(r"^#\s*DRHP Summary", "# RHP Summary", markdown, flags=re.IGNORECASE)
             markdown = re.sub(r"Comprehensive DRHP Summary", "Comprehensive RHP Summary", markdown, flags=re.IGNORECASE)
        else:
             markdown = re.sub(r"^#\s*RHP Summary", "# DRHP Summary", markdown, flags=re.IGNORECASE)
             markdown = re.sub(r"Comprehensive RHP Summary", "Comprehensive DRHP Summary", markdown, flags=re.IGNORECASE)

        # 3. Remove redundant Contact Details block often generated after Section I table
        # Matches "Contact Details:" or "Contact Information:" followed by bullet points
        redundant_contact_regex = r"(?i)\n+(?:Contact Details|Contact Information):\s*(?:\n\s*[*+-]\s+.*)+"
        new_markdown = re.sub(redundant_contact_regex, "", markdown)
        if len(new_markdown) != len(markdown):
            logger.info("Post-process: Removed redundant contact details block")
        markdown = new_markdown
        
        # 4. Consistency: ensure Section III starts with requested format if not already handled
        if "SECTION III: OUR BUSINESS" not in markdown and "OUR BUSINESS ANALYSIS" in markdown:
            markdown = markdown.replace("OUR BUSINESS ANALYSIS", "SECTION III: OUR BUSINESS")

        return markdown

    @staticmethod
    def _toc_page_span(item: Dict[str, Any]) -> tuple[int, int]:
        """TOC from ingestion uses start_page/end_page; legacy may use page_start/page_end."""
        s = item.get("start_page", item.get("page_start"))
        e = item.get("end_page", item.get("page_end"))
        try:
            start = int(s) if s is not None else 1
        except (TypeError, ValueError):
            start = 1
        try:
            end = int(e) if e is not None else start
        except (TypeError, ValueError):
            end = start
        return start, max(start, end)

    @staticmethod
    def _clip_chunk_context(context: str, max_chars: int, note: str) -> str:
        """Trim retrieved context at chunk boundaries (---), never mid-cell."""
        if not context or len(context) <= max_chars:
            return context
        head = context[:max_chars]
        cut = -1
        for sep in ("\n\n---\n\n", "\n---\n"):
            cut = head.rfind(sep)
            if cut > max_chars // 4:
                return f"{head[:cut].rstrip()}\n\n> {note}\n"
        return f"{head.rstrip()}\n\n> {note}\n"
        
    async def _retrieve_tables(
        self,
        job_id: str = None,
        namespace: str = None,
        page_range: Optional[tuple] = None,
        subsection: Optional[str] = None,
        subsection_range: Optional[str] = None,
        min_cells: int = 15,
        max_tables: Optional[int] = None,
        max_chars: Optional[int] = None,
    ) -> str:
        """
        Retrieve structured tables from MongoDB extraction_results.
        Supports direct subsection filters (subsection + subsection_range) and page_range fallback.
        min_cells: Minimum number of pipe characters to consider valid table (default 15).
        """
        try:
            from app.db.mongo import mongodb
            await mongodb.connect()
            
            collection = mongodb.get_collection("extraction_results")
            query = {}
            if job_id: query["job_id"] = job_id
            elif namespace: query["filename"] = namespace
                
            if page_range:
                query["page"] = {"$gte": page_range[0], "$lte": page_range[1]}

            if subsection:
                query["subsection"] = {
                    "$regex": f"^\\s*{re.escape(subsection.strip())}\\s*$",
                    "$options": "i",
                }
            if subsection_range:
                query["subsection_range"] = {
                    "$regex": f"^\\s*{re.escape(subsection_range.strip())}\\s*$",
                    "$options": "i",
                }

            # EXCLUSION: Skip RPT tables so Pinecone can handle them in Section X
            rpt_keywords = ["Related Party", "Transactions with Related Party", "Nature of Transaction", "RPT"]
            query["markdown"] = {
                "$not": {
                    "$regex": "|".join(rpt_keywords),
                    "$options": "i"
                }
            }

            fetch_limit = min(1000, max_tables) if max_tables else 1000
            cursor = collection.find(query).sort("page", 1)
            tables = await cursor.to_list(length=fetch_limit)
            
            if not tables:
                return ""
                
            table_md_blocks = []
            for t in tables:
                sec = t.get("section", t.get("chapter", "General"))
                sub = t.get("subsection", "")
                heading = t.get("table_heading", "")
                pg = t.get("page", "?")
                md = t.get("markdown", "")
                
                # Ensure it's a meaningful markdown table, not a tiny glossary fragment.
                if len(md.split("|")) < min_cells or md.count("\n") < 2:
                    continue
                    
                context_title_parts = [f"Table from {sec}"]
                if sub:
                    context_title_parts.append(f"Subsection: {sub}")
                if heading:
                    context_title_parts.append(f"Heading: {heading}")
                context_title = " | ".join(context_title_parts)
                table_md_blocks.append(f"### {context_title} (Page {pg})\n{md}")

            if not table_md_blocks:
                return ""

            if max_chars:
                while len(table_md_blocks) > 1 and len("\n\n".join(table_md_blocks)) > max_chars:
                    table_md_blocks.pop()
                result = "\n\n".join(table_md_blocks)
                if len(result) > max_chars:
                    # One (or few) very large tables: trim the last block at row boundaries only.
                    last = table_md_blocks[-1]
                    budget = max_chars - len("\n\n".join(table_md_blocks[:-1])) - 2 - 80
                    if budget > 2000 and "\n" in last:
                        lines = last.split("\n")
                        kept: List[str] = []
                        used = 0
                        for line in lines:
                            if used + len(line) + 1 > budget:
                                break
                            kept.append(line)
                            used += len(line) + 1
                        last = "\n".join(kept) + "\n\n> [Remaining rows omitted for length.]\n"
                        table_md_blocks[-1] = last
                    result = "\n\n".join(table_md_blocks)
                    if len(result) > max_chars:
                        result = result[: max_chars - 120].rsplit("\n", 1)[0] + "\n\n> [Tables truncated for length.]\n"
                return result

            return "\n\n".join(table_md_blocks)
        except Exception as e:
            logger.warning(f"Failed to retrieve tables: {str(e)}")
            return ""

    @staticmethod
    def _build_toc_guided_queries(
        base_queries: List[str],
        toc: List[Dict[str, Any]],
        target_terms: List[str],
        max_entries: int = 8,
    ) -> List[str]:
        """
        Expand retrieval queries with TOC-guided hints so vector search prioritizes
        the exact subsection names and page spans where data is expected.
        """
        expanded = [q for q in base_queries if isinstance(q, str) and q.strip()]
        if not toc:
            return expanded

        matched_entries: List[str] = []
        for item in toc:
            title = str(item.get("title", "")).strip()
            if not title:
                continue
            title_upper = title.upper()
            if not any(term in title_upper for term in target_terms):
                continue
            ps, pe = SummaryPipeline._toc_page_span(item)
            matched_entries.append(f"Subsection: {title} | Page range: {ps}-{pe}")
            if len(matched_entries) >= max_entries:
                break

        if matched_entries:
            expanded.append(
                "Prioritize extraction from these TOC-identified subsections and page ranges:\n"
                + "\n".join(f"- {entry}" for entry in matched_entries)
            )
        return expanded

    @staticmethod
    def _usage_payload(response: Any) -> Dict[str, int]:
        """Normalize token usage from model response."""
        usage = getattr(response, "usage", None)
        return {
            "input": int(getattr(usage, "prompt_tokens", 0) or 0),
            "output": int(getattr(usage, "completion_tokens", 0) or 0),
        }

    @staticmethod
    def _to_int(value: Any) -> int:
        if value is None:
            return 0
        if isinstance(value, (int, float)):
            return int(value)
        s = re.sub(r"[^\d]", "", str(value))
        return int(s) if s else 0

    @staticmethod
    def _to_pct(value: Any) -> float:
        if value is None:
            return 0.0
        s = re.sub(r"[^\d.]", "", str(value))
        try:
            return float(s) if s else 0.0
        except ValueError:
            return 0.0

    @staticmethod
    def _extract_preissue_split_from_section6_markdown(section6_md: str) -> tuple[int, float]:
        if not section6_md:
            return 0, 0.0
        m = re.search(
            r"\|\s*-\s*Individual Promoters\s*\|\s*([\d,]+)\s*\|\s*([0-9.]+)",
            section6_md,
            flags=re.IGNORECASE,
        )
        if not m:
            return 0, 0.0
        sh = SummaryPipeline._to_int(m.group(1))
        pct = SummaryPipeline._to_pct(m.group(2))
        return sh, pct

    def _build_section6_preissue_table_from_investor(self, investor_json: Dict[str, Any], section6_md: str = "") -> str:
        rows = investor_json.get("section_a_extracted_investors", []) if isinstance(investor_json, dict) else []
        if not isinstance(rows, list) or not rows:
            return ""

        promoters_total_sh = promoters_sh = promoter_group_sh = public_sh = total_sh = 0
        promoters_total_pct = promoters_pct = promoter_group_pct = public_pct = total_pct = 0.0

        for row in rows:
            if not isinstance(row, dict):
                continue
            name = str(row.get("investor_name", "")).strip().lower()
            sh = self._to_int(row.get("number_of_equity_shares"))
            pct = self._to_pct(
                row.get("percentage_of_pre_issue_capital")
                or row.get("percentage")
                or row.get("shareholding_percentage")
            )
            if "total" in name and ("(a+b)" in name or name == "total"):
                total_sh, total_pct = sh, pct
            elif "promoters and promoter group" in name:
                promoters_total_sh, promoters_total_pct = sh, pct
            elif "promoter group" in name and "promoters and promoter group" not in name:
                promoter_group_sh, promoter_group_pct = sh, pct
            elif "promoter" in name:
                promoters_sh, promoters_pct = sh, pct
            elif "public" in name:
                public_sh, public_pct = sh, pct

        if promoters_total_sh == 0:
            promoters_total_sh = promoters_sh + promoter_group_sh
        if promoters_total_pct == 0 and (promoters_pct or promoter_group_pct):
            promoters_total_pct = promoters_pct + promoter_group_pct

        # Try to recover individual promoter split from agent-2 markdown if missing.
        if promoters_sh == 0:
            md_promoters_sh, md_promoters_pct = self._extract_preissue_split_from_section6_markdown(section6_md)
            if md_promoters_sh > 0:
                promoters_sh = md_promoters_sh
                if md_promoters_pct > 0:
                    promoters_pct = md_promoters_pct

        # Derive promoter group split from A+B minus individual promoters when needed.
        if promoter_group_sh == 0 and promoters_total_sh > 0 and promoters_sh > 0 and promoters_total_sh >= promoters_sh:
            promoter_group_sh = promoters_total_sh - promoters_sh
        if promoter_group_pct == 0 and promoters_total_pct > 0 and promoters_pct > 0 and promoters_total_pct >= promoters_pct:
            promoter_group_pct = promoters_total_pct - promoters_pct

        if total_sh == 0:
            total_sh = promoters_total_sh + public_sh
        if total_pct == 0:
            total_pct = 100.0 if total_sh > 0 else 0.0

        # If percentages are still missing but shares are available, compute from total.
        if total_sh > 0:
            if promoters_total_pct == 0 and promoters_total_sh > 0:
                promoters_total_pct = (promoters_total_sh / total_sh) * 100
            if promoters_pct == 0 and promoters_sh > 0:
                promoters_pct = (promoters_sh / total_sh) * 100
            if promoter_group_pct == 0 and promoter_group_sh > 0:
                promoter_group_pct = (promoter_group_sh / total_sh) * 100
            if public_pct == 0 and public_sh > 0:
                public_pct = (public_sh / total_sh) * 100

        if total_sh == 0:
            return ""

        return (
            "### Pre-Issue Shareholding Table (Corrected from Shareholding Pattern)\n\n"
            "| Shareholder Category | Number of Equity Shares | Percentage (%) |\n"
            "|---|---:|---:|\n"
            f"| Promoters & Promoter Group | {promoters_total_sh:,} | {promoters_total_pct:.2f} |\n"
            f"| - Individual Promoters | {promoters_sh:,} | {promoters_pct:.2f} |\n"
            f"| - Promoter Group Entities | {promoter_group_sh:,} | {promoter_group_pct:.2f} |\n"
            f"| Public Shareholders | {public_sh:,} | {public_pct:.2f} |\n"
            f"| Total | {total_sh:,} | {total_pct:.2f} |\n"
        )

    async def _get_toc(self, namespace: str) -> List[Dict[str, Any]]:
        """
        Retrieve TOC metadata from document_metadata collection.
        """
        try:
            from app.db.mongo import mongodb
            await mongodb.connect()
            coll = mongodb.get_collection("document_metadata")
            doc = await coll.find_one({"filename": namespace})
            return doc.get("toc", []) if doc else []
        except Exception as e:
            logger.warning("Failed to get TOC metadata", error=str(e))
            return []
        
    async def _retrieve_context(
        self,
        queries: List[str],
        namespace: str,
        index_name: str = None,
        host: str = None,
        vector_top_k: int = 12,
        rerank_top_n: int = 12,
        metadata_filter: Optional[Dict[str, Any]] = None
    ) -> str:
        """
        Retrieves context from Pinecone with Cohere reranking.
        Matches n8n workflow retrieval logic.
        """
        index_name = index_name or settings.PINECONE_INDEX
        host = host or settings.PINECONE_INDEX_HOST
        
        all_context = []
        for query in queries:
            try:
                # 1. Vector Search
                query_vector = await self.embedding.embed_text(query)
                index = vector_store_service.get_index(index_name, host=host)
                
                # Construct Filter
                # Default filter by documentName (namespace)
                filter_criteria = {"documentName": namespace} if namespace and namespace != "" else {}
                
                # Merge with metadata_filter if provided via API (e.g. documentId, domainId)
                if metadata_filter:
                    filter_criteria.update(metadata_filter)
                
                # If criteria is empty, set to None to allow querying (though generally unsafe without namespace)
                query_filter = filter_criteria if filter_criteria else None
                
                # First try: Query the default namespace ("") with filters
                # This matches the single-index strategy where we rely on metadata for separation
                safe_namespace = ""
                
                # Try default namespace with filter
                search_res = index.query(
                    vector=query_vector,
                    top_k=vector_top_k,
                    namespace=safe_namespace,
                    include_metadata=True,
                    filter=query_filter
                )
                initial_chunks = [m['metadata']['text'] for m in search_res['matches']]
                
                # Fallback: Query specific namespace (legacy support)
                if not initial_chunks and namespace and namespace != "":
                    # Remove "documentName" from filter for legacy namespace search
                    # Legacy documents using namespace for isolation might NOT have documentName metadata
                    # Create filtered copy without "documentName"
                    legacy_filter_dict = {k: v for k, v in (query_filter or {}).items() if k != "documentName"}
                    legacy_filter: Optional[Dict[str, Any]] = legacy_filter_dict if legacy_filter_dict else None
                        
                    # logger.info(f"Fallback search in legacy namespace {namespace} with filter {legacy_filter}")
                    search_res = index.query(
                        vector=query_vector,
                        top_k=vector_top_k,
                        namespace=namespace,
                        include_metadata=True,
                        filter=legacy_filter
                    )
                    initial_chunks = [m['metadata']['text'] for m in search_res['matches']]

                # 2. Reranking (Disabled as requested)
                if initial_chunks:
                    all_context.extend(initial_chunks[:rerank_top_n])
                    
            except Exception as e:
                logger.error(f"Context retrieval failed for query", query=query, error=str(e))
                continue
        
        # Deduplicate
        unique_context = []
        seen = set()
        for chunk in all_context:
            if chunk not in seen:
                unique_context.append(chunk)
                seen.add(chunk)
        
        return "\n---\n".join(unique_context)
    
    async def _agent_1_investor_extractor(
        self,
        namespace: str,
        custom_prompt: Optional[str] = None,
        custom_subqueries: Optional[List[str]] = None,
        index_name: str = None,
        host: str = None,
        metadata_filter: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Agent 1: Investor Extractor
        Node: A-1:-sectionVI investor extractor
        Returns: JSON with investor data
        """
        logger.info("Agent 1: Investor Extractor - Starting", namespace=namespace)
        
        # Retrieve context (50 chunks, reranked via Cohere)
        investor_query = custom_subqueries or ["Extract complete shareholding pattern, investor list, and capital structure from DRHP"]
        toc = await self._get_toc(namespace)
        investor_query = self._build_toc_guided_queries(
            investor_query,
            toc,
            target_terms=[
                "CAPITAL STRUCTURE",
                "SHAREHOLDING",
                "PRE-ISSUE SHAREHOLDING",
                "POST-ISSUE SHAREHOLDING",
                "CAPITALISATION",
                "ISSUE STRUCTURE",
            ],
        )
        context = await self._retrieve_context(
            investor_query,
            namespace,
            index_name,
            host,
            vector_top_k=10,
            rerank_top_n=10,
            metadata_filter=metadata_filter
        )
        context = self._clip_chunk_context(
            context,
            SUMMARY_AGENT_CONTEXT_MAX_CHARS,
            "[Additional retrieved chunks omitted for length.]",
        )

        if not context:
            logger.warning("Agent 1: No context found")
            return {"error": "No investor data found", "extraction_status": "failed"}
        
        try:
            response = await self.client.chat.completions.create(
                model="gpt-4.1-mini",
                messages=[
                    {"role": "system", "content": custom_prompt or INVESTOR_EXTRACTOR_SYSTEM_PROMPT},
                    {"role": "user", "content": f"TARGET INVESTORS TO SEARCH AND MATCH:\n{TARGET_INVESTORS}\n\nExtract investor data and matched target investors from this DRHP context:\n\n{context}"}
                ],
                temperature=0.1,
                max_tokens=8192,
                response_format={"type": "json_object"}
            )
            
            investor_json = json.loads(response.choices[0].message.content)
            usage = response.usage
            
            logger.info("Agent 1: Completed", 
                        investors_count=investor_json.get("extraction_metadata", {}).get("total_investors_extracted", 0),
                        input_tokens=usage.prompt_tokens,
                        output_tokens=usage.completion_tokens)
            
            # Store usage in dict for pipeline aggregation
            investor_json["_usage"] = {
                "input": usage.prompt_tokens,
                "output": usage.completion_tokens
            }
            return investor_json
            
        except Exception as e:
            logger.error("Agent 1: Failed", error=str(e), exc_info=True)
            return {"error": str(e), "extraction_status": "failed"}
    
    async def _agent_2_capital_history_extractor(
        self,
        namespace: str,
        custom_prompt: Optional[str] = None,
        custom_subqueries: Optional[List[str]] = None,
        index_name: str = None,
        host: str = None,
        metadata_filter: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Agent 2: Capital History & Valuation Extractor + Section VI Summary
        Node: A-2:-sectionVI capital history extractor3
        Returns: JSON with share capital table and SECTION VI markdown
        """
        logger.info("Agent 2: Capital History Extractor - Starting", namespace=namespace)
        
        # Retrieve context
        capital_query = custom_subqueries or ["Extract complete equity share capital history table and premium rounds from DRHP"]
        capital_query = capital_query + [
            "Extract COMPLETE share capital history table across all pages with every row and every column, including bonus/subdivision/allotment rounds and valuation fields."
        ]
        toc = await self._get_toc(namespace)
        capital_query = self._build_toc_guided_queries(
            capital_query,
            toc,
            target_terms=[
                "CAPITAL STRUCTURE",
                "SHARE CAPITAL",
                "EQUITY SHARE CAPITAL",
                "HISTORY OF SHARE CAPITAL",
                "CHANGES IN SHARE CAPITAL",
                "CAPITAL HISTORY",
            ],
        )
        context = await self._retrieve_context(
            capital_query,
            namespace,
            index_name,
            host,
            vector_top_k=20,
            rerank_top_n=20,
            metadata_filter=metadata_filter
        )
        context = self._clip_chunk_context(
            context,
            SUMMARY_AGENT_CONTEXT_MAX_CHARS,
            "[Additional retrieved chunks omitted for length.]",
        )

        if not context:
            logger.warning("Agent 2: No context found")
            return {"error": "No capital history data found", "type": "calculation_data"}
        
        try:
            response = await self.client.chat.completions.create(
                model="gpt-4.1-mini",
                messages=[
                    {"role": "system", "content": custom_prompt or CAPITAL_HISTORY_EXTRACTOR_SYSTEM_PROMPT},
                    {"role": "user", "content": f"Extract and summarize share capital from this DRHP context. Do not drop any row or any column from share capital history tables; preserve complete tabular coverage across all pages. Ensure chronology is complete from earliest to latest event.\n\n{context}"}
                ],
                temperature=0.0,
                max_tokens=16384,
                response_format={"type": "json_object"}
            )
            
            # The agent now returns {"json_data": {...}, "markdown_summary": "..."}
            result_json = json.loads(response.choices[0].message.content)
            capital_json = result_json.get("json_data", {})
            markdown_summary = result_json.get("markdown_summary", "")
            usage = response.usage
            
            logger.info("Agent 2: Completed", 
                        input_tokens=usage.prompt_tokens,
                        output_tokens=usage.completion_tokens)
            
            # Store usage
            capital_json["_usage"] = {
                "input": usage.prompt_tokens,
                "output": usage.completion_tokens
            }
            # Attach the markdown summary to the JSON for the orchestrator to pick up
            capital_json["_markdown_summary"] = markdown_summary
            
            return capital_json
            
        except Exception as e:
            logger.error("Agent 2: Failed", error=str(e), exc_info=True)
            return {"error": str(e), "type": "calculation_data"}

    async def _agent_4_generator(
        self,
        namespace: str,
        doc_type: str = "DRHP",
        custom_prompt: Optional[str] = None,
        custom_subqueries: Optional[List[str]] = None,
        index_name: str = None,
        host: str = None,
        metadata_filter: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Agent 4: Section I & II Generator"""
        logger.info("Agent 4: Section I & II Starting")
        # SUBQUERIES[0] = Section I, SUBQUERIES[1] = Section II
        queries = custom_subqueries or [SUBQUERIES[0], SUBQUERIES[1]]
        queries = queries + [
            "Extract complete key document information exactly: statutory and peer review auditors, registrar to the issue, book running lead manager, banker to our company, bankers to the issue / refund banker / sponsor bank, issue opening date, issue closing date, RHP filing date.",
            "Focus on sections/tables titled GENERAL INFORMATION, KEY DOCUMENT INFORMATION, STATUTORY AND PEER REVIEW AUDITORS, REGISTRAR TO THE ISSUE, BANKER TO OUR COMPANY, BANKERS TO THE ISSUE.",
            "Banker synonyms to search: bankers, banking partners, escrow bank, collecting bank, sponsor bank, refund banker, SCSB, self certified syndicate bank.",
            "Extract ISIN exactly using keywords/synonyms: ISIN, International Securities Identification Number, security code/identifier.",
            "Extract filing date exactly with doc-type aware keywords: RHP Filing Date, DRHP Filing Date, date of filing this red herring prospectus, filed with ROC/SEBI.",
        ]
        toc = await self._get_toc(namespace)
        queries = self._build_toc_guided_queries(
            queries,
            toc,
            target_terms=[
                "GENERAL INFORMATION",
                "COMPANY INFORMATION",
                "KEY DOCUMENT INFORMATION",
                "REGISTRAR",
                "BOOK RUNNING LEAD MANAGER",
                "BANKER",
                "AUDITOR",
            ],
            max_entries=12,
        )
        context = await self._retrieve_context(queries, namespace, index_name, host, vector_top_k=28, metadata_filter=metadata_filter)
        if not context.strip():
            relaxed_filter = dict(metadata_filter or {})
            relaxed_filter.pop("type", None)
            context = await self._retrieve_context(
                queries,
                namespace,
                index_name,
                host,
                vector_top_k=34,
                metadata_filter=relaxed_filter,
            )
        context = self._clip_chunk_context(
            context,
            SUMMARY_AGENT_CONTEXT_MAX_CHARS,
            "[Additional retrieved chunks omitted for length.]",
        )

        response = await self.client.chat.completions.create(
            model="gpt-4.1-mini",
            messages=[
                {"role": "system", "content": self._localize_prompt(custom_prompt or AGENT_4_SECTION_I_II_PROMPT, doc_type)},
                {"role": "user", "content": f"Context:\n\n{context}"}
            ],
            temperature=0.1,
            max_tokens=8192
        )
        usage = self._usage_payload(response)
        logger.info("Agent 4: Completed", input_tokens=usage["input"], output_tokens=usage["output"])
        return {"content": response.choices[0].message.content or "", "_usage": usage}

    async def _agent_5_generator(
        self,
        namespace: str,
        doc_type: str = "DRHP",
        custom_prompt: Optional[str] = None,
        custom_subqueries: Optional[List[str]] = None,
        index_name: str = None,
        host: str = None,
        metadata_filter: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Agent 5: Section IV & V Generator (Pinecone semantic-only)"""
        logger.info("Agent 5: Section IV & V Starting")
        # Build dedicated retrieval paths for Section IV and Section V to reduce context contamination.
        toc = await self._get_toc(namespace)
        base_queries = custom_subqueries or [SUBQUERIES[2], SUBQUERIES[3]]
        section4_query = base_queries[0] if base_queries else SUBQUERIES[2]
        section5_query = base_queries[1] if len(base_queries) > 1 else SUBQUERIES[3]

        section4_queries = self._build_toc_guided_queries(
            [
                section4_query,
                "Extract SECTION IV only: industry size in India, global and domestic trends, projected growth/CAGR, government policies/support, market share, market opportunities, industry risk factors, and exact peer comparison disclosures.",
                "For peer comparison, extract only the table titled 'Comparison of accounting ratios with Industry Peers' or equivalent wording and do not substitute financial performance tables.",
            ],
            toc,
            target_terms=[
                "INDUSTRY OVERVIEW",
                "ABOUT OUR INDUSTRY",
                "BASIS FOR ISSUE PRICE",
                "MARKET OVERVIEW",
                "COMPARISON OF ACCOUNTING RATIOS WITH INDUSTRY PEERS",
                "COMPARISON OF KPIS WITH LISTED INDUSTRY PEERS",
            ],
            max_entries=16,
        )
        section5_queries = self._build_toc_guided_queries(
            [
                section5_query,
                "Extract SECTION V only: complete promoters/directors/KMP profiles including age, education, experience, previous employment, pre-offer shareholding.",
                "Compensation is mandatory for each promoter/director/KMP. Search compensation synonyms: remuneration, managerial remuneration, salary, perquisites, commission, sitting fees, benefits, emoluments, pay package, annual compensation in Rs lakh.",
                "Focus on sections/tables titled OUR MANAGEMENT, OUR PROMOTERS AND PROMOTER GROUP, REMUNERATION, KEY MANAGERIAL PERSONNEL, KMP.",
            ],
            toc,
            target_terms=[
                "OUR MANAGEMENT",
                "OUR PROMOTERS",
                "PROMOTER GROUP",
                "REMUNERATION",
                "COMPENSATION",
                "KMP",
                "KEY MANAGERIAL PERSONNEL",
                "DIRECTORS",
            ],
            max_entries=16,
        )

        section4_ctx = await self._retrieve_context(section4_queries, namespace, index_name, host, vector_top_k=22, metadata_filter=metadata_filter)
        section5_ctx = await self._retrieve_context(section5_queries, namespace, index_name, host, vector_top_k=24, metadata_filter=metadata_filter)
        context = f"--- SECTION IV RETRIEVAL CONTEXT ---\n{section4_ctx}\n\n--- SECTION V RETRIEVAL CONTEXT ---\n{section5_ctx}"
        if not context.strip() or (not section4_ctx.strip() and not section5_ctx.strip()):
            relaxed_filter = dict(metadata_filter or {})
            relaxed_filter.pop("type", None)
            section4_ctx = await self._retrieve_context(
                section4_queries,
                namespace,
                index_name,
                host,
                vector_top_k=28,
                metadata_filter=relaxed_filter,
            )
            section5_ctx = await self._retrieve_context(
                section5_queries,
                namespace,
                index_name,
                host,
                vector_top_k=30,
                metadata_filter=relaxed_filter,
            )
            context = f"--- SECTION IV RETRIEVAL CONTEXT ---\n{section4_ctx}\n\n--- SECTION V RETRIEVAL CONTEXT ---\n{section5_ctx}"
        context = self._clip_chunk_context(
            context,
            SUMMARY_AGENT_CONTEXT_MAX_CHARS,
            "[Additional retrieved chunks omitted for length.]",
        )

        response = await self.client.chat.completions.create(
            model="gpt-4.1-mini",
            messages=[
                {"role": "system", "content": self._localize_prompt(custom_prompt or AGENT_5_SECTION_IV_V_PROMPT, doc_type)},
                {"role": "user", "content": f"Context:\n\n{context}"}
            ],
            temperature=0.1,
            max_tokens=8192
        )
        usage = self._usage_payload(response)
        logger.info("Agent 5: Completed", input_tokens=usage["input"], output_tokens=usage["output"])
        return {"content": response.choices[0].message.content or "", "_usage": usage}

    async def _agent_6_generator(
        self,
        namespace: str,
        doc_type: str = "DRHP",
        custom_prompt: Optional[str] = None,
        custom_subqueries: Optional[List[str]] = None,
        index_name: str = None,
        host: str = None,
        metadata_filter: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Agent 6: Section VII Generator (Financials, Pinecone semantic-only)"""
        logger.info("Agent 6: Section VII Starting")
        # SUBQUERIES[5] = Section VII
        queries = custom_subqueries or [SUBQUERIES[5]]
        queries = queries + [
            "Extract the exact Financial Ratios table from Financial Information / Restated Financial Information subsection. Preserve row names, columns, period labels, units, and values exactly as shown.",
            "Search specifically in subsection: RESTATED CONSOLIDATED FINANCIAL INFORMATION. Also search synonyms: Restated Financial Information, Key Financial Ratios, significant changes (25% or more), ratio analysis.",
            "Extract table heading variants: 'The following are the key financial ratios...' and ratio table containing columns like Numerator, Denominator, period-end dates, and Variance.",
            "Extract the exact Utilisation of Net Proceeds tables from Objects of the Issue subsection, including 'Utilisation of Net Proceeds' and 'Proposed schedule of deployment of Net Proceeds'. Preserve values and notes exactly.",
        ]
        toc = await self._get_toc(namespace)
        queries = self._build_toc_guided_queries(
            queries,
            toc,
            target_terms=[
                "FINANCIAL PERFORMANCE",
                "FINANCIAL INFORMATION",
                "RESTATED FINANCIAL",
                "RESTATED CONSOLIDATED FINANCIAL INFORMATION",
                "FINANCIAL INDICATORS",
                "KEY FINANCIAL RATIOS",
                "SIGNIFICANT CHANGES",
                "RATIOS",
                "CASH FLOW",
                "OBJECTS OF THE ISSUE",
                "UTILISATION OF NET PROCEEDS",
                "DEPLOYMENT OF NET PROCEEDS",
            ],
            max_entries=20,
        )
        context = await self._retrieve_context(queries, namespace, index_name, host, vector_top_k=20, metadata_filter=metadata_filter)
        context = self._clip_chunk_context(
            context,
            SUMMARY_AGENT_CONTEXT_MAX_CHARS,
            "[Additional retrieved chunks omitted for length.]",
        )
        if not context.strip():
            # Fallback retry with lighter metadata filter in case strict type/doc filters suppress valid chunks.
            relaxed_filter = dict(metadata_filter or {})
            relaxed_filter.pop("type", None)
            context = await self._retrieve_context(
                queries,
                namespace,
                index_name,
                host,
                vector_top_k=32,
                metadata_filter=relaxed_filter,
            )
        context = self._clip_chunk_context(
            context,
            SUMMARY_AGENT_CONTEXT_MAX_CHARS,
            "[Additional retrieved chunks omitted for length.]",
        )

        response = await self.client.chat.completions.create(
            model="gpt-4.1-mini",
            messages=[
                {"role": "system", "content": self._localize_prompt(custom_prompt or AGENT_6_SECTION_VII_PROMPT, doc_type)},
                {"role": "user", "content": (
                    "Generate SECTION VII using ONLY these two table groups from the retrieved context:\n"
                    "1) Financial Ratios table from Financial Statements / Financial Information section.\n"
                    "2) Utilisation of Net Proceeds tables from Objects of the Issue subsection.\n"
                    "Do not substitute with other financial tables. Reproduce these tables verbatim with exact periods, units, values, and notes.\n"
                    "For Financial Ratios: prioritize the exact table from 'RESTATED CONSOLIDATED FINANCIAL INFORMATION'.\n"
                    "Do NOT create additional rows, do NOT expand into a generic ratio matrix, and do NOT fill 'Information not found' for ratios that are not present in that exact source table.\n\n"
                    f"Context:\n\n{context}"
                )}
            ],
            temperature=0.0,
            max_tokens=16384
        )
        usage = self._usage_payload(response)
        logger.info("Agent 6: Completed", input_tokens=usage["input"], output_tokens=usage["output"])
        return {"content": response.choices[0].message.content or "", "_usage": usage}

    async def _agent_7_generator(
        self,
        namespace: str,
        doc_type: str = "DRHP",
        custom_prompt: Optional[str] = None,
        custom_subqueries: Optional[List[str]] = None,
        index_name: str = None,
        host: str = None,
        metadata_filter: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Agent 7: Section VIII & IX Generator"""
        logger.info("Agent 7: Section VIII & IX Starting")
        # SUBQUERIES[6] = VIII, SUBQUERIES[7] = IX
        queries = custom_subqueries or [SUBQUERIES[6], SUBQUERIES[7]]
        toc = await self._get_toc(namespace)
        queries = queries + [
            "Extract the exact table titled 'Summary of outstanding litigations' (or close variant) from Legal and Other Information section.",
            "Search specifically under headings/subsections: SUMMARY OF THE ISSUE DOCUMENTS, SUMMARY OF THE OFFER DOCUMENTS, OUTSTANDING LITIGATION AND MATERIAL DEVELOPMENTS, Summary of outstanding litigations.",
            "Preserve all row groups exactly: Company, Directors, Promoters, KMPs, SMPs, Subsidiaries and both 'By' and 'Against' rows, including aggregate amount involved.",
            "Do not merge rows, do not infer values, and do not convert units.",
        ]
        queries = self._build_toc_guided_queries(
            queries,
            toc,
            target_terms=[
                "LEGAL AND OTHER INFORMATION",
                "SUMMARY OF THE ISSUE DOCUMENTS",
                "SUMMARY OF THE OFFER DOCUMENTS",
                "OUTSTANDING LITIGATION",
                "MATERIAL DEVELOPMENTS",
                "SUMMARY OF OUTSTANDING LITIGATIONS",
            ],
            max_entries=18,
        )
        context = await self._retrieve_context(queries, namespace, index_name, host, vector_top_k=20, metadata_filter=metadata_filter)
        if not context.strip():
            relaxed_filter = dict(metadata_filter or {})
            relaxed_filter.pop("type", None)
            context = await self._retrieve_context(
                queries,
                namespace,
                index_name,
                host,
                vector_top_k=20,
                metadata_filter=relaxed_filter,
            )
        # Reduce hallucination risk: keep litigation-focused chunks for table reconstruction.
        if context:
            chunks = [c.strip() for c in context.split("\n---\n") if c.strip()]
            litigation_keywords = [
                "summary of outstanding litigation",
                "outstanding litigation",
                "materiality policy",
                "aggregate amount involved",
                "by the company",
                "against the company",
                "directors",
                "promoters",
                "kmps",
                "smps",
                "subsidiaries",
            ]
            focused = [
                c for c in chunks
                if any(k in c.lower() for k in litigation_keywords)
            ]
            if focused:
                context = "\n---\n".join(focused)
        context = self._clip_chunk_context(
            context,
            SUMMARY_AGENT_CONTEXT_MAX_CHARS,
            "[Additional retrieved chunks omitted for length.]",
        )

        response = await self.client.chat.completions.create(
            model="gpt-4.1-mini",
            messages=[
                {"role": "system", "content": self._localize_prompt(custom_prompt or AGENT_7_SECTION_VIII_IX_PROMPT, doc_type)},
                {"role": "user", "content": (
                    "For SECTION IX litigation analysis, reproduce the exact 'Summary of outstanding litigations' table from context.\n"
                    "Prefer the table under 'SUMMARY OF THE ISSUE/OFFER DOCUMENTS' if present.\n"
                    "Do not synthesize additional rows, do not aggregate beyond source, do not recompute totals, and keep original amounts/units as-is.\n"
                    "If exact row values are not visible in context, leave those specific cells as '*Information not found in provided chunks.*' rather than guessing.\n\n"
                    f"Context:\n\n{context}"
                )}
            ],
            temperature=0.0,
            max_tokens=8192
        )
        usage = self._usage_payload(response)
        logger.info("Agent 7: Completed", input_tokens=usage["input"], output_tokens=usage["output"])
        return {"content": response.choices[0].message.content or "", "_usage": usage}

    async def _agent_8_generator(
        self,
        namespace: str,
        doc_type: str = "DRHP",
        custom_prompt: Optional[str] = None,
        custom_subqueries: Optional[List[str]] = None,
        index_name: str = None,
        host: str = None,
        metadata_filter: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Agent 8: Section X Generator"""
        logger.info("Agent 8: Section X Starting")
        # SUBQUERIES[8] = X
        queries = custom_subqueries or [SUBQUERIES[8]]
        context = await self._retrieve_context(queries, namespace, index_name, host, vector_top_k=10, metadata_filter=metadata_filter)
        context = self._clip_chunk_context(
            context,
            SUMMARY_AGENT_CONTEXT_MAX_CHARS,
            "[Additional retrieved chunks omitted for length.]",
        )

        response = await self.client.chat.completions.create(
            model="gpt-4.1-mini",
            messages=[
                {"role": "system", "content": self._localize_prompt(custom_prompt or AGENT_8_SECTION_X_PROMPT, doc_type)},
                {"role": "user", "content": f"Context:\n\n{context}"}
            ],
            temperature=0.1,
            max_tokens=8192
        )
        usage = self._usage_payload(response)
        logger.info("Agent 8: Completed", input_tokens=usage["input"], output_tokens=usage["output"])
        return {"content": response.choices[0].message.content or "", "_usage": usage}

    async def _agent_9_generator(
        self,
        namespace: str,
        doc_type: str = "DRHP",
        custom_prompt: Optional[str] = None,
        custom_subqueries: Optional[List[str]] = None,
        index_name: str = None,
        host: str = None,
        metadata_filter: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Agent 9: Section XI & XII Generator"""
        logger.info("Agent 9: Section XI & XII Starting")
        # SUBQUERIES[9] = XI, SUBQUERIES[10] = XII
        queries = custom_subqueries or [SUBQUERIES[9], SUBQUERIES[10]]
        toc = await self._get_toc(namespace)
        queries = queries + [
            "For SECTION XI extract awards and recognitions, certifications/accreditations (ISO/HACCP/Halal/Kosher/NSF etc.), CSR initiatives, R&D activities/facilities, and international operations/global presence exactly from source.",
            "Use synonyms: awards, recognitions, accolades, certifications, accreditations, approvals, registrations, quality certificates, compliance certificates, CSR, corporate social responsibility, R&D, research and development, innovation, global operations, exports, international markets.",
        ]
        queries = self._build_toc_guided_queries(
            queries,
            toc,
            target_terms=[
                "ADDITIONAL INFORMATION",
                "AWARDS",
                "RECOGNITIONS",
                "CERTIFICATIONS",
                "ACCREDITATIONS",
                "CSR",
                "CORPORATE SOCIAL RESPONSIBILITY",
                "RESEARCH AND DEVELOPMENT",
                "R&D",
                "INTERNATIONAL OPERATIONS",
                "GLOBAL PRESENCE",
            ],
            max_entries=16,
        )
        context = await self._retrieve_context(queries, namespace, index_name, host, vector_top_k=22, metadata_filter=metadata_filter)
        if not context.strip():
            relaxed_filter = dict(metadata_filter or {})
            relaxed_filter.pop("type", None)
            context = await self._retrieve_context(
                queries,
                namespace,
                index_name,
                host,
                vector_top_k=20,
                metadata_filter=relaxed_filter,
            )
        context = self._clip_chunk_context(
            context,
            SUMMARY_AGENT_CONTEXT_MAX_CHARS,
            "[Additional retrieved chunks omitted for length.]",
        )

        response = await self.client.chat.completions.create(
            model="gpt-4.1-mini",
            messages=[
                {"role": "system", "content": self._localize_prompt(custom_prompt or AGENT_9_SECTION_XI_XII_PROMPT, doc_type)},
                {"role": "user", "content": f"Context:\n\n{context}"}
            ],
            temperature=0.1,
            max_tokens=16384
        )
        usage = self._usage_payload(response)
        logger.info("Agent 9: Completed", input_tokens=usage["input"], output_tokens=usage["output"])
        return {"content": response.choices[0].message.content or "", "_usage": usage}

    async def _agent_3_business_table_extractor(
        self,
        namespace: str,
        custom_business_sop: Optional[str] = None,
        custom_business_subqueries: Optional[List[str]] = None,
        index_name: str = None,
        host: str = None,
        metadata_filter: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        A-3: Section III Business Table Extractor
        Matches n8n node: "A-3: Section III Table Extractor"

        Uses 16 dedicated extraction queries ((custom_business_subqueries if custom_business_subqueries else BUSINESS_EXTRACTION_QUERIES)) focused
        exclusively on the "Our Business" chapter. Retrieves topK=12 chunks per query
        (matches n8n DRHP/RHP Vector Store - Business Chapter topK: 12).
        Returns extracted markdown plus token usage.
        """
        logger.info("A-3 Business Table Extractor: Starting", namespace=namespace)

        # Always enforce full 16-query coverage for Agent 3.
        # If tenant config overrides only a subset, fill missing slots from defaults.
        extraction_queries = BUSINESS_EXTRACTION_QUERIES.copy()
        if custom_business_subqueries:
            for idx, query in enumerate(custom_business_subqueries[:len(extraction_queries)]):
                if isinstance(query, str) and query.strip():
                    extraction_queries[idx] = query.strip()
        total_queries = len(extraction_queries)

        # Matches n8n "Extraction Queries - All Tables" → joined with \n\n as prompt
        user_prompt = (
            f"You will receive {total_queries} sequential extraction queries, each focusing on a specific "
            "category of tables from the \"Our Business\" chapter.\n\n"
            "For EACH query:\n"
            "1. Search the vector store comprehensively\n"
            "2. Extract EVERY table that matches the query\n"
            "3. Return tables in perfect Markdown format\n"
            "4. Preserve all data exactly as shown\n\n"
            "MANDATORY COVERAGE CHECKLIST (never skip if present in context):\n"
            "- Properties/Facilities (owned/leased/registered office/units)\n"
            "- Manufacturing/Plant & Machinery\n"
            "- Installed Capacity / Actual Production / Capacity Utilization\n"
            "- Customer Concentration tables (Top 1/5/10, major/key)\n"
            "- Supplier Concentration tables (Top 1/5/10, major/key)\n"
            "- Employees / Human Resources tables\n"
            "- Intellectual Property (trademark/patent/IPR) tables\n"
            "- Projects / Order book / pipeline tables\n"
            "- Product/Service and Raw Material tables\n\n"
            "If a category is truly absent from retrieved context, write exactly: "
            "'*Information not found in provided chunks.*' and do not fabricate.\n\n"
            "Queries to process:\n"
            + "\n\n".join(extraction_queries)
        )

        # 1. PRE-COLLECT MONGO TABLES (High-Fidelity)
        # Try to find "Our Business" page range from TOC to focus the high-fidelity extraction
        toc = await self._get_toc(namespace)
        matched_subsections: List[Dict[str, str]] = []
        matched_ranges: List[tuple[int, int]] = []
        primary_our_business_range: Optional[str] = None
        business_toc_terms = [
            "OUR BUSINESS",
            "BUSINESS MODEL",
            "CAPACITY AND CAPACITY UTILIZATION",
            "INFRASTRUCTURE",
            "PLANT",
            "MACHINERY",
            "PERFORMANCE INDICATORS",
            "INTELLECTUAL PROPERTY",
            "TRADEMARK",
            "SWOT",
            "PROPERTIES",
            "FACILITIES",
            "HOSPITAL",
        ]
        for item in toc:
            raw_title = str(item.get("title", "")).strip()
            title = raw_title.upper()
            if title == "OUR BUSINESS" and primary_our_business_range is None:
                ps, pe = self._toc_page_span(item)
                primary_our_business_range = f"{ps}-{pe}"
            if any(term in title for term in business_toc_terms):
                ps, pe = self._toc_page_span(item)
                matched_ranges.append((ps, pe))
                matched_subsections.append({
                    "subsection": raw_title,
                    "subsection_range": f"{ps}-{pe}",
                })

        if matched_subsections:
            logger.info(
                "A-3: Using subsection keyed high-fidelity extraction",
                subsection_count=len(matched_subsections),
            )

        # Strict subsection retrieval for Agent-3:
        # exactly these keys -> filename(namespace) + subsection + subsection_range.
        mongo_table_parts: List[str] = []
        seen_table_blocks: Set[str] = set()
        remaining_chars = SUMMARY_MONGO_AGENT3_MAX_CHARS
        # Primary exact query requested by user:
        # { filename: "...", subsection: "OUR BUSINESS", subsection_range: "start-end" }
        if primary_our_business_range:
            logger.info(
                "A-3 Mongo primary exact query",
                filename=namespace,
                subsection="OUR BUSINESS",
                subsection_range=primary_our_business_range,
            )
            primary_block = await self._retrieve_tables(
                namespace=namespace,
                subsection="OUR BUSINESS",
                subsection_range=primary_our_business_range,
                min_cells=2,
                max_tables=1000,
                max_chars=None,
            )
            if primary_block:
                for table_block in primary_block.split("\n\n### "):
                    normalized = table_block.strip()
                    if not normalized:
                        continue
                    if not normalized.startswith("### "):
                        normalized = f"### {normalized}"
                    if normalized in seen_table_blocks:
                        continue
                    seen_table_blocks.add(normalized)
                    mongo_table_parts.append(normalized)
                    remaining_chars -= len(normalized) + 2
                    if remaining_chars <= 0:
                        break
        for sub_entry in matched_subsections:
            if remaining_chars <= 0:
                break
            logger.info(
                "A-3 Mongo subsection query",
                filename=namespace,
                subsection=sub_entry["subsection"],
                subsection_range=sub_entry["subsection_range"],
            )
            block = await self._retrieve_tables(
                namespace=namespace,
                subsection=sub_entry["subsection"],
                subsection_range=sub_entry["subsection_range"],
                min_cells=2,
                max_tables=SUMMARY_MONGO_AGENT3_MAX_TABLES,
                max_chars=remaining_chars,
            )
            if not block:
                # Fallback 1: keep filename + subsection (ignore subsection_range mismatch).
                block = await self._retrieve_tables(
                    namespace=namespace,
                    subsection=sub_entry["subsection"],
                    min_cells=2,
                    max_tables=SUMMARY_MONGO_AGENT3_MAX_TABLES,
                    max_chars=remaining_chars,
                )
            if not block:
                continue
            for table_block in block.split("\n\n### "):
                normalized = table_block.strip()
                if not normalized:
                    continue
                if not normalized.startswith("### "):
                    normalized = f"### {normalized}"
                if normalized in seen_table_blocks:
                    continue
                seen_table_blocks.add(normalized)
                mongo_table_parts.append(normalized)
                remaining_chars -= len(normalized) + 2
                if remaining_chars <= 0:
                    break

        mongo_tables = "\n\n".join(mongo_table_parts)
        if not mongo_tables and matched_ranges:
            # Fallback 2: broad capture of our-business page window if subsection labels are inconsistent.
            page_range = (min(r[0] for r in matched_ranges), max(r[1] for r in matched_ranges))
            logger.info("A-3 Mongo fallback query by page range", filename=namespace, page_range=page_range)
            mongo_tables = await self._retrieve_tables(
                namespace=namespace,
                page_range=page_range,
                min_cells=2,
                max_tables=SUMMARY_MONGO_AGENT3_MAX_TABLES,
                max_chars=SUMMARY_MONGO_AGENT3_MAX_CHARS,
            )
        
        all_context_parts = []
        if mongo_tables:
            all_context_parts.append(f"### MONGODB HIGH-FIDELITY TABLES (PRIMARY SOURCE)\n{mongo_tables}")
        seen = set()

        # 2. COLLECT PIECONE CONTEXT (Narrative and secondary table fragments)
        for i, query in enumerate(extraction_queries):
            try:
                ctx = await self._retrieve_context(
                    [query],
                    namespace,
                    index_name,
                    host,
                    vector_top_k=12,
                    rerank_top_n=12,
                    metadata_filter=metadata_filter,
                )
                
                if ctx:
                    for chunk in ctx.split("\n---\n"):
                        c = chunk.strip()
                        if c and c not in seen:
                            all_context_parts.append(c)
                            seen.add(c)
                logger.debug(f"A-3: Query {i+1}/{total_queries} retrieved", chars=len(ctx) if ctx else 0)
            except Exception as qe:
                logger.warning(f"A-3: Query {i+1}/{total_queries} failed", error=str(qe))

        # 3. MANDATORY CATEGORY COVERAGE RETRY (SME-focused)
        # If core table families are missing, run targeted semantic retrieval passes.
        combined_context = "\n\n".join(all_context_parts).lower()
        mandatory_category_queries = {
            "properties_facilities": (
                ["owned", "leased", "property", "properties", "facility", "facilities", "registered office", "manufacturing unit"],
                "OUR BUSINESS: Extract all owned/leased properties, facilities, manufacturing units, warehouses, and office/location tables verbatim with full rows and columns."
            ),
            "manufacturing_capacity": (
                ["capacity utilization", "installed capacity", "actual production", "plant", "machinery"],
                "OUR BUSINESS: Extract plant/machinery and capacity utilization tables exactly (Installed Capacity, Actual Production, Capacity Utilization)."
            ),
            "customer_concentration": (
                ["customer concentration", "top 5 customers", "top 10 customers", "major customers", "key customers"],
                "OUR BUSINESS: Extract customer concentration tables (top 1/5/10, customer names, contribution amounts and percentages) verbatim."
            ),
            "supplier_concentration": (
                ["supplier concentration", "top 5 suppliers", "top 10 suppliers", "major suppliers", "key suppliers"],
                "OUR BUSINESS: Extract supplier concentration tables (top 1/5/10, supplier names, purchase amounts and percentages) verbatim."
            ),
            "employees_hr": (
                ["employee", "employees", "human resource", "hr", "department-wise"],
                "OUR BUSINESS: Extract employee and HR tables (department-wise strength, employee counts, workforce composition) verbatim."
            ),
            "intellectual_property": (
                ["intellectual property", "trademark", "patent", "copyright", "ipr"],
                "OUR BUSINESS: Extract intellectual property tables (trademarks/patents/registrations) verbatim."
            ),
            "projects_orderbook": (
                ["project", "order book", "pipeline", "ongoing projects", "contract"],
                "OUR BUSINESS: Extract projects/order-book/pipeline tables with project names and values verbatim."
            ),
            "products_services": (
                ["products", "services", "product mix", "product wise", "product-wise"],
                "OUR BUSINESS: Extract products/services and product-wise revenue tables verbatim."
            ),
            "raw_materials": (
                ["raw material", "materials consumed", "domestic", "imported", "procurement"],
                "OUR BUSINESS: Extract raw material/procurement tables including domestic vs imported and percentages verbatim."
            ),
        }

        retry_queries: List[str] = []
        for category, (keywords, query_text) in mandatory_category_queries.items():
            if not any(k in combined_context for k in keywords):
                retry_queries.append(query_text)

        if retry_queries:
            logger.info("A-3: Running mandatory coverage retry", missing_categories=len(retry_queries))
            for rq in retry_queries:
                try:
                    extra_ctx = await self._retrieve_context(
                        [rq],
                        namespace,
                        index_name,
                        host,
                        vector_top_k=20,
                        rerank_top_n=20,
                        metadata_filter=metadata_filter,
                    )
                    if extra_ctx:
                        for chunk in extra_ctx.split("\n---\n"):
                            c = chunk.strip()
                            if c and c not in seen:
                                all_context_parts.append(c)
                                seen.add(c)
                except Exception as re_try_err:
                    logger.warning("A-3: Coverage retry query failed", error=str(re_try_err))

        if not all_context_parts:
            logger.warning("A-3: No business chapter context found")
            return {"content": "", "_usage": {"input": 0, "output": 0}}

        full_context = "\n\n---\n\n".join(all_context_parts)
        full_context = self._clip_chunk_context(
            full_context,
            SUMMARY_AGENT_A3_CONTEXT_MAX_CHARS,
            "[Additional business-chapter context omitted for length.]",
        )
        logger.info("A-3: Context collected", chunks=len(all_context_parts), chars=len(full_context))

        try:
            response = await self.client.chat.completions.create(
                model="gpt-4.1-mini",
                messages=[
                    {"role": "system", "content": custom_business_sop if custom_business_sop else BUSINESS_TABLE_EXTRACTOR_SYSTEM_PROMPT},
                    {
                        "role": "user",
                        "content": (
                            f"{user_prompt}\n\n"
                            f"--- RETRIEVED CONTEXT ---\n\n{full_context}"
                        ),
                    },
                ],
                temperature=0.0,
                max_tokens=16384,
            )
            section3_content = response.choices[0].message.content or ""
            usage = self._usage_payload(response)
            logger.info(
                "A-3: Completed",
                output_chars=len(section3_content),
                input_tokens=usage["input"],
                output_tokens=usage["output"],
            )

            # Clean output: Remove any repeating subqueries (OUR BUSINESS: ...)
            if section3_content:
                lines = section3_content.split('\n')
                cleaned_lines = [l for l in lines if not l.strip().startswith("OUR BUSINESS:")]
                section3_content = '\n'.join(cleaned_lines).strip()

            return {"content": section3_content, "_usage": usage}
        except Exception as e:
            logger.error("A-3: Failed", error=str(e), exc_info=True)
            return {"content": "", "_usage": {"input": 0, "output": 0}}

    @staticmethod
    def _insert_section3_into_summary(full_summary: str, section3_content: str) -> str:
        """
        Inserts Section III (Our Business) content between SECTION II and SECTION IV.
        Direct Python port of n8n "Code in JavaScript4" code node.

        n8n logic:
          1. Find ## SECTION IV: ... using regex
          2. Verify ## SECTION II: exists
          3. Insert section3_content right before SECTION IV with separators
        """
        if not section3_content or not section3_content.strip():
            logger.info("Section III insertion skipped: no content")
            return full_summary

        if not full_summary or not isinstance(full_summary, str):
            return full_summary or ""

        # Find the start of SECTION IV (matches n8n regex: /##\s+SECTION IV:/i)
        section4_match = re.search(r"##\s+SECTION IV:", full_summary, re.IGNORECASE)
        if not section4_match:
            # Section IV not found — append at end
            logger.warning("Section III insertion: SECTION IV not found, appending at end")
            return full_summary + f"\n\n---\n\n{section3_content.strip()}\n\n---\n\n"

        # Verify SECTION II exists (sanity check, matches n8n)
        if not re.search(r"##\s+SECTION II:", full_summary, re.IGNORECASE):
            logger.warning("Section III insertion: SECTION II not found")
            return full_summary

        # Wrap the content (matches n8n's cleanedSection3 padding)
        cleaned_section3 = section3_content.strip()

        # Ensure proper header: SECTION III: OUR BUSINESS (requested by user)
        # 1. First, remove any existing "OUR BUSINESS ANALYSIS" heading (from prompts or previous generation)
        cleaned_section3 = re.sub(r"^#+\s*OUR BUSINESS ANALYSIS[^\n]*", "", cleaned_section3, count=1, flags=re.IGNORECASE).strip()
        
        # 2. Enforce the canonical header
        if not re.match(r"^##\s+SECTION III: OUR BUSINESS", cleaned_section3, re.IGNORECASE):
            # If it already has some other SECTION III heading, replace it
            if re.search(r"^#+\s*SECTION III:", cleaned_section3, re.IGNORECASE):
                cleaned_section3 = re.sub(r"^#+\s*SECTION III:[^\n]*", "## SECTION III: OUR BUSINESS", cleaned_section3, count=1, flags=re.IGNORECASE)
            else:
                # Otherwise, prepend the requested header
                cleaned_section3 = f"## SECTION III: OUR BUSINESS\n\n{cleaned_section3}"

        insertion_block = f"\n\n---\n\n{cleaned_section3}\n\n---\n\n"

        idx = section4_match.start()
        merged = full_summary[:idx] + insertion_block + full_summary[idx:]
        logger.info(
            "Section III inserted successfully",
            insertion_point=idx,
            section3_chars=len(cleaned_section3),
        )
        return merged

    async def generate_summary(
        self,
        namespace: str,
        domain_id: str,
        doc_type: str = "DRHP",
        tenant_config: Optional[Dict[str, Any]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        index_name: str = None,
        host: str = None
    ) -> Dict[str, Any]:
        """
        Main summary generation method.
        Orchestrates 9-agent pipeline with sequential assembly.
        """
        start_time = time.time()
        logger.info("Starting 9-Agent Pipeline", namespace=namespace, domain=domain_id)
        
        # Build Metadata Filter for Tenant Isolation
        metadata_filter = {}
        if namespace: metadata_filter["documentName"] = namespace
        if domain_id: metadata_filter["domainId"] = domain_id
        if metadata and "domain" in metadata: metadata_filter["domain"] = metadata["domain"]
        if metadata and "documentId" in metadata: metadata_filter["documentId"] = metadata["documentId"]
        
        # Pull high-fidelity Job ID if available
        job_id = metadata.get("job_id") if metadata else None
        if job_id: metadata_filter["job_id"] = job_id

        resolved_doc_type = doc_type or (metadata.get("documentType") if metadata else "DRHP")
        if isinstance(resolved_doc_type, str): resolved_doc_type = resolved_doc_type.upper()
        metadata_filter["type"] = resolved_doc_type
        doc_type = resolved_doc_type
            
        if not tenant_config: tenant_config = {}
        
        # Feature Toggles (default to True for core functionality)
        investor_match_enabled = tenant_config.get("investor_match_only", True)
        valuation_enabled = tenant_config.get("valuation_matching", True)
        adverse_enabled = tenant_config.get("adverse_finding", True)
        
        # Agent 3 (Business) Prompts
        a3_prompt = BUSINESS_TABLE_EXTRACTOR_SYSTEM_PROMPT
        a3_subqueries = [] # Force fallback to BUSINESS_EXTRACTION_QUERIES from prompts.py
        if doc_type == "RHP":
            a3_prompt = self._localize_prompt(a3_prompt, "RHP")

        try:
            # PHASE 1: Parallel Data Extraction and Specialized Generation
            logger.info("Phase 1: Multi-Agent Parallel Processing (A1 - A9)")

            agent1_prompt, agent1_subqueries = self._resolve_agent_config(tenant_config, 1)
            agent2_prompt, agent2_subqueries = self._resolve_agent_config(tenant_config, 2)
            agent3_prompt_cfg, agent3_subqueries_cfg = self._resolve_agent_config(tenant_config, 3)
            agent4_prompt, agent4_subqueries = self._resolve_agent_config(tenant_config, 4)
            agent5_prompt, agent5_subqueries = self._resolve_agent_config(tenant_config, 5)
            agent6_prompt, agent6_subqueries = self._resolve_agent_config(tenant_config, 6)
            agent7_prompt, agent7_subqueries = self._resolve_agent_config(tenant_config, 7)
            agent8_prompt, agent8_subqueries = self._resolve_agent_config(tenant_config, 8)
            agent9_prompt, agent9_subqueries = self._resolve_agent_config(tenant_config, 9)

            investor_task = self._agent_1_investor_extractor(
                namespace,
                agent1_prompt,
                agent1_subqueries,
                index_name, host, metadata_filter
            )
            capital_task = self._agent_2_capital_history_extractor(
                namespace,
                agent2_prompt,
                agent2_subqueries,
                index_name, host, metadata_filter
            )
            sec3_task = self._agent_3_business_table_extractor(
                namespace,
                agent3_prompt_cfg or a3_prompt,
                agent3_subqueries_cfg or a3_subqueries,
                index_name, host, metadata_filter
            )
            sec1_2_task = self._agent_4_generator(
                namespace, doc_type,
                agent4_prompt,
                agent4_subqueries,
                index_name, host, metadata_filter
            )
            sec4_5_task = self._agent_5_generator(
                namespace, doc_type,
                agent5_prompt,
                agent5_subqueries,
                index_name, host, metadata_filter
            )
            sec7_task = self._agent_6_generator(
                namespace, doc_type,
                agent6_prompt,
                agent6_subqueries,
                index_name, host, metadata_filter
            )
            sec8_9_task = self._agent_7_generator(
                namespace, doc_type,
                agent7_prompt,
                agent7_subqueries,
                index_name, host, metadata_filter
            )
            sec10_task = self._agent_8_generator(
                namespace, doc_type,
                agent8_prompt,
                agent8_subqueries,
                index_name, host, metadata_filter
            )
            sec11_12_task = self._agent_9_generator(
                namespace, doc_type,
                agent9_prompt,
                agent9_subqueries,
                index_name, host, metadata_filter
            )

            (
                investor_json, 
                capital_json, 
                section3_res, 
                section1_2_res,
                section4_5_res,
                section7_res,
                section8_9_res,
                section10_res,
                section11_12_res
            ) = await asyncio.gather(
                investor_task, 
                capital_task, 
                sec3_task, 
                sec1_2_task,
                sec4_5_task,
                sec7_task,
                sec8_9_task,
                sec10_task,
                sec11_12_task,
                return_exceptions=True
            )
            maybe_collect(stage="summary.phase1_parallel_complete", size_hint_mb=220.0)

            # Extract Section VI from Agent 2
            section6_md = ""
            total_usage = {"input": 0, "output": 0}
            usage_breakdown: Dict[str, Dict[str, int]] = {}

            def unpack_section_result(res: Any, agent_name: str) -> str:
                if isinstance(res, Exception):
                    logger.error(f"{agent_name} task failed", error=str(res))
                    usage_breakdown[agent_name] = {"input": 0, "output": 0}
                    return f"\n\n> Error generating this section: {str(res)}\n\n"
                if isinstance(res, dict):
                    usage = res.get("_usage", {"input": 0, "output": 0})
                    usage_breakdown[agent_name] = usage
                    total_usage["input"] += int(usage.get("input", 0) or 0)
                    total_usage["output"] += int(usage.get("output", 0) or 0)
                    return str(res.get("content", "") or "")
                usage_breakdown[agent_name] = {"input": 0, "output": 0}
                return str(res or "")

            section3_md = unpack_section_result(section3_res, "agent3")
            section1_2_md = unpack_section_result(section1_2_res, "agent4")
            section4_5_md = unpack_section_result(section4_5_res, "agent5")
            section7_md = unpack_section_result(section7_res, "agent6")
            section8_9_md = unpack_section_result(section8_9_res, "agent7")
            section10_md = unpack_section_result(section10_res, "agent8")
            section11_12_md = unpack_section_result(section11_12_res, "agent9")

            if isinstance(capital_json, dict):
                section6_md = capital_json.get("_markdown_summary", "")
                u = capital_json.get("_usage", {"input": 0, "output": 0})
                agent2_in = int(u.get("input", 0) or 0)
                agent2_out = int(u.get("output", 0) or 0)
                usage_breakdown["agent2"] = {"input": agent2_in, "output": agent2_out}
                total_usage["input"] += agent2_in; total_usage["output"] += agent2_out
            
            if isinstance(investor_json, dict):
                u = investor_json.get("_usage", {"input": 0, "output": 0})
                agent1_in = int(u.get("input", 0) or 0)
                agent1_out = int(u.get("output", 0) or 0)
                usage_breakdown["agent1"] = {"input": agent1_in, "output": agent1_out}
                total_usage["input"] += agent1_in; total_usage["output"] += agent1_out
                corrected_preissue_table = self._build_section6_preissue_table_from_investor(investor_json, section6_md)
                if corrected_preissue_table:
                    # Avoid duplicating corrected table if already present.
                    section6_md = re.sub(
                        r"### Pre-Issue Shareholding Table \(Corrected from Shareholding Pattern\)[\s\S]*?(?=\n## |\n### |\Z)",
                        "",
                        section6_md,
                        flags=re.IGNORECASE,
                    ).strip()
                    section6_md = f"{section6_md}\n\n{corrected_preissue_table}"

            logger.info(
                "Summary token usage aggregated",
                total_input_tokens=total_usage["input"],
                total_output_tokens=total_usage["output"],
            )

            # =====================================================================
            # PHASE 2: Final Sequential Assembly
            # =====================================================================
            logger.info("Phase 2: Final Assembly & Sequencing via MarkdownConverter")
            
            # Inject Agent 1 & 2 extra data if enabled
            if investor_match_enabled and isinstance(investor_json, dict) and "error" not in investor_json:
                investor_md = self.md_converter.convert_investor_json_to_markdown(investor_json, doc_type=doc_type)
                section6_md = f"{section6_md}\n\n{investor_md}"
            
            if valuation_enabled and isinstance(capital_json, dict) and "error" not in capital_json:
                valuation_md = self.md_converter.convert_capital_json_to_markdown(capital_json)
                section7_md = f"{valuation_md}\n\n{section7_md}"

            # Map company name early for research
            company_name = namespace.replace('.pdf', '').replace('_', ' ')
            
            if adverse_enabled:
                directory_name = ""
                if metadata:
                    directory_name = (
                        metadata.get("directoryName")
                        or metadata.get("directory_name")
                        or metadata.get("directoryId")
                        or metadata.get("directory_id")
                        or ""
                    )
                promoters_context = section4_5_md[:6000] if section4_5_md else ""
                research_res = await research_service.research_company(
                    company_name,
                    promoters=promoters_context,
                    directory_name=directory_name,
                )
                if research_res and "error" not in research_res:
                    adverse_md = self.md_converter.convert_research_json_to_markdown(research_res)
                    # Use MarkdownConverter utility or manual insertion to place before Section XII
                    if "## SECTION XII:" in section11_12_md:
                        xi_part, xii_part = section11_12_md.split("## SECTION XII:", 1)
                        section11_12_md = f"{xi_part.strip()}\n\n{adverse_md.strip()}\n\n---\n\n## SECTION XII:{xii_part}"
                    else:
                        section11_12_md = f"{section11_12_md}\n\n{adverse_md}"

            # Organize sections for final assembly
            sections_dict = {
                'sec1_2': section1_2_md,
                'sec3': section3_md,
                'sec4_5': section4_5_md,
                'sec6': section6_md,
                'sec7': section7_md,
                'sec8_9': section8_9_md,
                'sec10': section10_md,
                'sec11_12': section11_12_md
            }
            
            # Sequential Assembly via MarkdownConverter
            combined_summary = self.md_converter.assemble_final_summary(
                sections=sections_dict,
                doc_type=doc_type,
                company_name=company_name
            )
            
            # Final Post-processing
            final_markdown = self._post_process_final_markdown(combined_summary, doc_type)
            maybe_collect(stage="summary.post_assembly", size_hint_mb=160.0)
            
            # Wrap with Timestamp
            dateTime = datetime.now().strftime("%d/%m/%Y, %I:%M:%S %p")
            header_metadata = f"---\nGenerated: {dateTime}\n---\n\n"
            final_markdown = header_metadata + final_markdown
            duration = time.time() - start_time
            logger.info("Pipeline completed successfully", duration=f"{duration:.2f}s")
            
            return {
                "status": "success",
                "markdown": final_markdown,
                "html": final_markdown,
                "duration": duration,
                "usage": {
                    "input": total_usage["input"],
                    "output": total_usage["output"],
                    "total": total_usage,
                    "by_agent": usage_breakdown
                }
            }

        except Exception as e:
            logger.error("Global Pipeline Failure", error=str(e), exc_info=True)
            return {
                "status": "error",
                "message": f"Summary generation failed: {str(e)}",
                "duration": time.time() - start_time,
                "markdown": f"# Global Pipeline Error\n\n{str(e)}",
                "usage": {"input": 0, "output": 0}
            }


# Singleton instance
summary_pipeline = SummaryPipeline()
