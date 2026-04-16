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
import re
import time
from typing import Dict, Any, List, Optional
from datetime import datetime
from app.core.config import settings
from app.core.logging import get_logger
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
        
    async def _retrieve_tables(self, job_id: str = None, namespace: str = None, page_range: Optional[tuple] = None, min_cells: int = 15) -> str:
        """
        Retrieve structured tables from MongoDB extraction_results.
        Supports page_range=(start, end).
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

            # EXCLUSION: Skip RPT tables so Pinecone can handle them in Section X
            rpt_keywords = ["Related Party", "Transactions with Related Party", "Nature of Transaction", "RPT"]
            query["markdown"] = {
                "$not": {
                    "$regex": "|".join(rpt_keywords),
                    "$options": "i"
                }
            }

            cursor = collection.find(query).sort("page", 1)
            tables = await cursor.to_list(length=1000)
            
            if not tables: return ""
                
            table_md_blocks = []
            for t in tables:
                sec = t.get("section", t.get("chapter", "General"))
                pg = t.get("page", "?")
                md = t.get("markdown", "")
                
                # Ensure it's a meaningful markdown table, not a tiny glossary fragment.
                if len(md.split("|")) < min_cells or md.count("\n") < 2:
                    continue
                    
                table_md_blocks.append(f"### Table from {sec} (Page {pg})\n{md}")
                
            return "\n\n".join(table_md_blocks)
        except Exception as e:
            logger.warning(f"Failed to retrieve tables: {str(e)}")
            return ""

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
        context = await self._retrieve_context(
            investor_query,
            namespace,
            index_name,
            host,
            vector_top_k=10,
            rerank_top_n=10,
            metadata_filter=metadata_filter
        )
        
        # Pull high-fidelity tables from Mongo
        job_id = metadata_filter.get("job_id") if metadata_filter else None
        mongo_tables = await self._retrieve_tables(job_id=job_id, namespace=namespace, min_cells=4)
        if mongo_tables:
            context = f"--- STRUCTURED TABLES FROM EXTRACTION ---\n{mongo_tables}\n\n--- TEXT CONTEXT ---\n{context}"
        
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
        context = await self._retrieve_context(
            capital_query,
            namespace,
            index_name,
            host,
            vector_top_k=20,
            rerank_top_n=20,
            metadata_filter=metadata_filter
        )
        
        # Pull high-fidelity tables from Mongo
        job_id = metadata_filter.get("job_id") if metadata_filter else None
        mongo_tables = await self._retrieve_tables(job_id=job_id, namespace=namespace, min_cells=4)
        if mongo_tables:
            context = f"--- STRUCTURED TABLES FROM EXTRACTION ---\n{mongo_tables}\n\n--- TEXT CONTEXT ---\n{context}"
        
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
    ) -> str:
        """Agent 4: Section I & II Generator"""
        logger.info("Agent 4: Section I & II Starting")
        # SUBQUERIES[0] = Section I, SUBQUERIES[1] = Section II
        queries = custom_subqueries or [SUBQUERIES[0], SUBQUERIES[1]]
        context = await self._retrieve_context(queries, namespace, index_name, host, vector_top_k=8, metadata_filter=metadata_filter)
        
        response = await self.client.chat.completions.create(
            model="gpt-4.1-mini",
            messages=[
                {"role": "system", "content": self._localize_prompt(custom_prompt or AGENT_4_SECTION_I_II_PROMPT, doc_type)},
                {"role": "user", "content": f"Context:\n\n{context}"}
            ],
            temperature=0.1,
            max_tokens=8192
        )
        usage = response.usage
        logger.info("Agent 4: Completed", input_tokens=usage.prompt_tokens, output_tokens=usage.completion_tokens)
        return response.choices[0].message.content

    async def _agent_5_generator(
        self,
        namespace: str,
        doc_type: str = "DRHP",
        custom_prompt: Optional[str] = None,
        custom_subqueries: Optional[List[str]] = None,
        index_name: str = None,
        host: str = None,
        metadata_filter: Optional[Dict[str, Any]] = None
    ) -> str:
        """Agent 5: Section IV & V Generator"""
        logger.info("Agent 5: Section IV & V Starting")
        # SUBQUERIES[2] = Section IV, SUBQUERIES[3] = Section V
        queries = custom_subqueries or [SUBQUERIES[2], SUBQUERIES[3]]
        context = await self._retrieve_context(queries, namespace, index_name, host, vector_top_k=15, metadata_filter=metadata_filter)
        
        # Add high-fidelity tables from Mongo for Industry/Management
        job_id = metadata_filter.get("job_id") if metadata_filter else None
        toc = await self._get_toc(namespace)
        hi_fi_pages = []
        for item in toc:
            title = str(item.get("title", "")).upper()
            if any(term in title for term in ["INDUSTRY", "MARKET ANALYSIS", "MANAGEMENT", "PROMOTERS"]):
                hi_fi_pages.append((item.get("page_start", 1), item.get("page_end", 999)))
        
        # Retrieval for combined pages
        hi_fi_tables = ""
        for pr in hi_fi_pages:
            tables = await self._retrieve_tables(job_id=job_id, namespace=namespace, page_range=pr, min_cells=4)
            if tables: hi_fi_tables += f"\n{tables}"
            
        if hi_fi_tables:
            context = f"### MONGODB HIGH-FIDELITY TABLES (INDUSTRY & MANAGEMENT)\n{hi_fi_tables}\n\n{context}"
        
        response = await self.client.chat.completions.create(
            model="gpt-4.1-mini",
            messages=[
                {"role": "system", "content": self._localize_prompt(custom_prompt or AGENT_5_SECTION_IV_V_PROMPT, doc_type)},
                {"role": "user", "content": f"Context:\n\n{context}"}
            ],
            temperature=0.1,
            max_tokens=8192
        )
        usage = response.usage
        logger.info("Agent 5: Completed", input_tokens=usage.prompt_tokens, output_tokens=usage.completion_tokens)
        return response.choices[0].message.content

    async def _agent_6_generator(
        self,
        namespace: str,
        doc_type: str = "DRHP",
        custom_prompt: Optional[str] = None,
        custom_subqueries: Optional[List[str]] = None,
        index_name: str = None,
        host: str = None,
        metadata_filter: Optional[Dict[str, Any]] = None
    ) -> str:
        """Agent 6: Section VII Generator (Financials)"""
        logger.info("Agent 6: Section VII Starting")
        # SUBQUERIES[5] = Section VII
        queries = custom_subqueries or [SUBQUERIES[5]]
        context = await self._retrieve_context(queries, namespace, index_name, host, vector_top_k=12, metadata_filter=metadata_filter)
        
        # Add high-fidelity tables from Mongo for financials
        job_id = metadata_filter.get("job_id") if metadata_filter else None
        mongo_tables = await self._retrieve_tables(job_id=job_id, namespace=namespace)
        if mongo_tables:
            context = f"--- STRUCTURED FINANCIAL TABLES ---\n{mongo_tables}\n\n{context}"

        response = await self.client.chat.completions.create(
            model="gpt-4.1-mini",
            messages=[
                {"role": "system", "content": self._localize_prompt(custom_prompt or AGENT_6_SECTION_VII_PROMPT, doc_type)},
                {"role": "user", "content": f"Context:\n\n{context}"}
            ],
            temperature=0.0,
            max_tokens=16384
        )
        usage = response.usage
        logger.info("Agent 6: Completed", input_tokens=usage.prompt_tokens, output_tokens=usage.completion_tokens)
        return response.choices[0].message.content

    async def _agent_7_generator(
        self,
        namespace: str,
        doc_type: str = "DRHP",
        custom_prompt: Optional[str] = None,
        custom_subqueries: Optional[List[str]] = None,
        index_name: str = None,
        host: str = None,
        metadata_filter: Optional[Dict[str, Any]] = None
    ) -> str:
        """Agent 7: Section VIII & IX Generator"""
        logger.info("Agent 7: Section VIII & IX Starting")
        # SUBQUERIES[6] = VIII, SUBQUERIES[7] = IX
        queries = custom_subqueries or [SUBQUERIES[6], SUBQUERIES[7]]
        context = await self._retrieve_context(queries, namespace, index_name, host, vector_top_k=12, metadata_filter=metadata_filter)
        
        response = await self.client.chat.completions.create(
            model="gpt-4.1-mini",
            messages=[
                {"role": "system", "content": self._localize_prompt(custom_prompt or AGENT_7_SECTION_VIII_IX_PROMPT, doc_type)},
                {"role": "user", "content": f"Context:\n\n{context}"}
            ],
            temperature=0.1,
            max_tokens=8192
        )
        usage = response.usage
        logger.info("Agent 7: Completed", input_tokens=usage.prompt_tokens, output_tokens=usage.completion_tokens)
        return response.choices[0].message.content

    async def _agent_8_generator(
        self,
        namespace: str,
        doc_type: str = "DRHP",
        custom_prompt: Optional[str] = None,
        custom_subqueries: Optional[List[str]] = None,
        index_name: str = None,
        host: str = None,
        metadata_filter: Optional[Dict[str, Any]] = None
    ) -> str:
        """Agent 8: Section X Generator"""
        logger.info("Agent 8: Section X Starting")
        # SUBQUERIES[8] = X
        queries = custom_subqueries or [SUBQUERIES[8]]
        context = await self._retrieve_context(queries, namespace, index_name, host, vector_top_k=10, metadata_filter=metadata_filter)
        
        response = await self.client.chat.completions.create(
            model="gpt-4.1-mini",
            messages=[
                {"role": "system", "content": self._localize_prompt(custom_prompt or AGENT_8_SECTION_X_PROMPT, doc_type)},
                {"role": "user", "content": f"Context:\n\n{context}"}
            ],
            temperature=0.1,
            max_tokens=8192
        )
        usage = response.usage
        logger.info("Agent 8: Completed", input_tokens=usage.prompt_tokens, output_tokens=usage.completion_tokens)
        return response.choices[0].message.content

    async def _agent_9_generator(
        self,
        namespace: str,
        doc_type: str = "DRHP",
        custom_prompt: Optional[str] = None,
        custom_subqueries: Optional[List[str]] = None,
        index_name: str = None,
        host: str = None,
        metadata_filter: Optional[Dict[str, Any]] = None
    ) -> str:
        """Agent 9: Section XI & XII Generator"""
        logger.info("Agent 9: Section XI & XII Starting")
        # SUBQUERIES[9] = XI, SUBQUERIES[10] = XII
        queries = custom_subqueries or [SUBQUERIES[9], SUBQUERIES[10]]
        context = await self._retrieve_context(queries, namespace, index_name, host, vector_top_k=10, metadata_filter=metadata_filter)
        
        response = await self.client.chat.completions.create(
            model="gpt-4.1-mini",
            messages=[
                {"role": "system", "content": self._localize_prompt(custom_prompt or AGENT_9_SECTION_XI_XII_PROMPT, doc_type)},
                {"role": "user", "content": f"Context:\n\n{context}"}
            ],
            temperature=0.1,
            max_tokens=16384
        )
        usage = response.usage
        logger.info("Agent 9: Completed", input_tokens=usage.prompt_tokens, output_tokens=usage.completion_tokens)
        return response.choices[0].message.content

    async def _agent_3_business_table_extractor(
        self,
        namespace: str,
        custom_business_sop: Optional[str] = None,
        custom_business_subqueries: Optional[List[str]] = None,
        index_name: str = None,
        host: str = None,
        metadata_filter: Optional[Dict[str, Any]] = None,
    ) -> str:
        """
        A-3: Section III Business Table Extractor
        Matches n8n node: "A-3: Section III Table Extractor"

        Uses 16 dedicated extraction queries ((custom_business_subqueries if custom_business_subqueries else BUSINESS_EXTRACTION_QUERIES)) focused
        exclusively on the "Our Business" chapter. Retrieves topK=12 chunks per query
        (matches n8n DRHP/RHP Vector Store - Business Chapter topK: 12).
        Returns the extracted markdown string of all tables.
        """
        logger.info("A-3 Business Table Extractor: Starting", namespace=namespace)

        # Matches n8n "Extraction Queries - All Tables" → joined with \n\n as prompt
        user_prompt = (
            "You will receive 16 sequential extraction queries, each focusing on a specific "
            "category of tables from the \"Our Business\" chapter.\n\n"
            "For EACH query:\n"
            "1. Search the vector store comprehensively\n"
            "2. Extract EVERY table that matches the query\n"
            "3. Return tables in perfect Markdown format\n"
            "4. Preserve all data exactly as shown\n\n"
            "Queries to process:\n"
            + "\n\n".join((custom_business_subqueries if custom_business_subqueries else BUSINESS_EXTRACTION_QUERIES))
        )

        # 1. PRE-COLLECT MONGO TABLES (High-Fidelity)
        job_id = metadata_filter.get("job_id") if metadata_filter else None
        
        # Try to find "Our Business" page range from TOC to focus the high-fidelity extraction
        toc = await self._get_toc(namespace)
        page_range = None
        for item in toc:
            title = str(item.get("title", "")).upper()
            if any(term in title for term in ["OUR BUSINESS", "BUSINESS MODEL", "CAPACITY AND CAPACITY UTILIZATION"]):
                page_start = item.get("page_start", 1)
                page_end = item.get("page_end", 999)
                page_range = (page_start, page_end)
                logger.info("A-3: Focused high-fidelity extraction for Our Business / Capacity", page_range=page_range)
                break
        
        mongo_tables = await self._retrieve_tables(job_id=job_id, namespace=namespace, page_range=page_range, min_cells=6)
        
        all_context_parts = []
        if mongo_tables:
            all_context_parts.append(f"### MONGODB HIGH-FIDELITY TABLES (PRIMARY SOURCE)\n{mongo_tables}")
        seen = set()

        # 2. COLLECT PIECONE CONTEXT (Narrative and secondary table fragments)
        for i, query in enumerate((custom_business_subqueries if custom_business_subqueries else BUSINESS_EXTRACTION_QUERIES)):
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
                logger.debug(f"A-3: Query {i+1}/16 retrieved", chars=len(ctx) if ctx else 0)
            except Exception as qe:
                logger.warning(f"A-3: Query {i+1} failed", error=str(qe))

        if not all_context_parts:
            logger.warning("A-3: No business chapter context found")
            return ""

        full_context = "\n\n---\n\n".join(all_context_parts)
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
            usage = response.usage
            logger.info(
                "A-3: Completed",
                output_chars=len(section3_content),
                input_tokens=usage.prompt_tokens,
                output_tokens=usage.completion_tokens,
            )

            # Clean output: Remove any repeating subqueries (OUR BUSINESS: ...)
            if section3_content:
                lines = section3_content.split('\n')
                cleaned_lines = [l for l in lines if not l.strip().startswith("OUR BUSINESS:")]
                section3_content = '\n'.join(cleaned_lines).strip()

            return section3_content
        except Exception as e:
            logger.error("A-3: Failed", error=str(e), exc_info=True)
            return ""

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
                section3_md, 
                section1_2_md,
                section4_5_md,
                section7_md,
                section8_9_md,
                section10_md,
                section11_12_md
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
            
            # Handle possible exceptions
            results = [section1_2_md, section4_5_md, section7_md, section8_9_md, section10_md, section11_12_md, section3_md]
            for i, res in enumerate(results):
                if isinstance(res, Exception):
                    logger.error(f"Agent task failed at index {i}", error=str(res))
                    results[i] = f"\n\n> Error generating this section: {str(res)}\n\n"

            # Re-assign cleaned results
            section1_2_md, section4_5_md, section7_md, section8_9_md, section10_md, section11_12_md, section3_md = results

            # Extract Section VI from Agent 2
            section6_md = ""
            total_usage = {"input": 0, "output": 0}
            if isinstance(capital_json, dict):
                section6_md = capital_json.get("_markdown_summary", "")
                u = capital_json.get("_usage", {"input": 0, "output": 0})
                total_usage["input"] += u["input"]; total_usage["output"] += u["output"]
            
            if isinstance(investor_json, dict):
                u = investor_json.get("_usage", {"input": 0, "output": 0})
                total_usage["input"] += u["input"]; total_usage["output"] += u["output"]

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
                research_res = await research_service.research_company(company_name)
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
                "usage": total_usage
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
