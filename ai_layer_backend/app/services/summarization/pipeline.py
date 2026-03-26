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
    MAIN_SUMMARY_SYSTEM_PROMPT,
    BUSINESS_EXTRACTION_QUERIES,
    BUSINESS_TABLE_EXTRACTOR_SYSTEM_PROMPT,
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
    - Agent 2: Capital History & Valuation Extractor (returns JSON)
    - Agent 3: DRHP Summary Generator (returns markdown)
    - Agent 4: Summary Validator/Previewer (returns verified markdown)
    
    All outputs converted to markdown and merged based on tenant toggles.
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
        
    async def _retrieve_tables(self, job_id: str = None, namespace: str = None, page_range: Optional[tuple] = None) -> str:
        """
        Retrieve structured tables from MongoDB extraction_results.
        Supports page_range=(start, end).
        Automatically filters out RPT tables to allow Pinecone to handle them exclusively.
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
            # Matches the user directive: "remove rpt extraction table from mongo functionality"
            rpt_keywords = ["Related Party", "Transactions with Related Party", "Nature of Transaction", "RPT"]
            query["markdown"] = {
                "$not": {
                    "$regex": "|".join(rpt_keywords),
                    "$options": "i"
                }
            }

            if not query: return ""
                
            cursor = collection.find(query).sort("page", 1)
            tables = await cursor.to_list(length=200)
            
            if not tables: return ""
                
            table_md_blocks = []
            for t in tables:
                sec = t.get("section", "General")
                pg = t.get("page", "?")
                md = t.get("markdown", "")
                
                # Double-check: ensure it's not a generic glossary entry (small table)
                if len(md.split("|")) < 15:
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
        investor_query = ["Extract complete shareholding pattern, investor list, and capital structure from DRHP"]
        context = await self._retrieve_context(
            investor_query,
            namespace,
            index_name,
            host,
            vector_top_k=8,
            rerank_top_n=8,
            metadata_filter=metadata_filter
        )
        
        # Pull high-fidelity tables from Mongo
        job_id = metadata_filter.get("job_id") if metadata_filter else None
        mongo_tables = await self._retrieve_tables(job_id=job_id, namespace=namespace)
        if mongo_tables:
            context = f"--- STRUCTURED TABLES FROM EXTRACTION ---\n{mongo_tables}\n\n--- TEXT CONTEXT ---\n{context}"
        
        if not context:
            logger.warning("Agent 1: No context found")
            return {"error": "No investor data found", "extraction_status": "failed"}
        
        try:
            response = await self.client.chat.completions.create(
                model="gpt-4.1-mini",
                messages=[
                    {"role": "system", "content": INVESTOR_EXTRACTOR_SYSTEM_PROMPT},
                    {"role": "user", "content": f"Extract investor data from this DRHP context:\n\n{context}"}
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
        index_name: str = None,
        host: str = None,
        metadata_filter: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Agent 2: Capital History & Valuation Extractor
        Node: A-2:-sectionVI capital history extractor3
        Returns: JSON with share capital table and premium rounds
        """
        logger.info("Agent 2: Capital History Extractor - Starting", namespace=namespace)
        
        # Retrieve context (10 chunks, reranked via Cohere)
        capital_query = ["Extract complete equity share capital history table and premium rounds from DRHP"]
        context = await self._retrieve_context(
            capital_query,
            namespace,
            index_name,
            host,
            vector_top_k=10,
            rerank_top_n=10,
            metadata_filter=metadata_filter
        )
        
        # Pull high-fidelity tables from Mongo
        job_id = metadata_filter.get("job_id") if metadata_filter else None
        mongo_tables = await self._retrieve_tables(job_id=job_id, namespace=namespace)
        if mongo_tables:
            context = f"--- STRUCTURED TABLES FROM EXTRACTION ---\n{mongo_tables}\n\n--- TEXT CONTEXT ---\n{context}"
        
        if not context:
            logger.warning("Agent 2: No context found")
            return {"error": "No capital history data found", "type": "calculation_data"}
        
        try:
            response = await self.client.chat.completions.create(
                model="gpt-4.1-mini",
                messages=[
                    {"role": "system", "content": CAPITAL_HISTORY_EXTRACTOR_SYSTEM_PROMPT},
                    {"role": "user", "content": f"Extract share capital history from this DRHP context:\n\n{context}"}
                ],
                temperature=0.0,
                max_tokens=8192,
                response_format={"type": "json_object"}
            )
            
            capital_json = json.loads(response.choices[0].message.content)
            usage = response.usage
            
            logger.info("Agent 2: Completed", 
                        premium_rounds=capital_json.get("calculation_parameters", {}).get("total_premium_rounds", 0),
                        input_tokens=usage.prompt_tokens,
                        output_tokens=usage.completion_tokens)
            
            # Store usage
            capital_json["_usage"] = {
                "input": usage.prompt_tokens,
                "output": usage.completion_tokens
            }
            return capital_json
            
        except Exception as e:
            logger.error("Agent 2: Failed", error=str(e), exc_info=True)
            return {"error": str(e), "type": "calculation_data"}

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

        # Retrieve context for all 16 business queries (topK=12 per query, matches n8n)
        all_context_parts = []
        seen = set()
        for i, query in enumerate((custom_business_subqueries if custom_business_subqueries else BUSINESS_EXTRACTION_QUERIES)):
            try:
                ctx = await self._retrieve_context(
                    [query],
                    namespace,
                    index_name,
                    host,
                    vector_top_k=6,
                    rerank_top_n=6,
                    metadata_filter=metadata_filter,
                )
                
                # Pull high-fidelity tables for the business chapter
                job_id = metadata_filter.get("job_id") if metadata_filter else None
                mongo_tables = await self._retrieve_tables(job_id=job_id, namespace=namespace)
                if mongo_tables and i == 0: # Only add once
                    all_context_parts.append(f"--- HIGH-FIDELITY TABLES ---\n{mongo_tables}")

                if ctx:
                    for chunk in ctx.split("\n---\n"):
                        c = chunk.strip()
                        if c and c not in seen:
                            all_context_parts.append(c)
                            seen.add(c)
                logger.debug(f"A-3: Query {i+1}/7 retrieved", chars=len(ctx) if ctx else 0)
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
    
    async def _agent_3_summary_generator(
        self,
        namespace: str,
        doc_type: str = "DRHP",
        custom_sop: Optional[str] = None,
        custom_subqueries: Optional[List[str]] = None,
        index_name: str = None,
        host: str = None,
        metadata_filter: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Agent 3: DRHP Summary Generator (n8n-style: Collect-then-Generate)
        Node: A-3:-DRHP Summary Generator Agent1
        
        Flow (matching n8n workflow):
          Phase 1: Loop through ALL subqueries → retrieve chunks for each → collect ALL chunks
          Phase 2: ONE single LLM call with ALL collected context → generate full summary
        """
        logger.info("Agent 3: Summary Generator - Starting (n8n-style Collect-then-Generate)", namespace=namespace)
        
        # Resolve subqueries: use custom if provided, else fall back to defaults
        active_subqueries = custom_subqueries if custom_subqueries else SUBQUERIES
        logger.info(f"Agent 3: Using {len(active_subqueries)} subqueries (custom={bool(custom_subqueries)})")
        
        # ── PHASE 1: Collect ALL chunks from ALL subqueries ──
        logger.info("Agent 3 Phase 1: Retrieving chunks for all subqueries...")
        all_chunks = []
        seen_chunks = set()
        
        for i, query in enumerate(active_subqueries):
            try:
                context = await self._retrieve_context(
                    [query],
                    namespace,
                    index_name,
                    host,
                    vector_top_k=12,
                    rerank_top_n=12,
                    metadata_filter=metadata_filter
                )
                
                if not context:
                    logger.warning(f"Agent 3: No context found for subquery {i+1}/{len(active_subqueries)}", query=query[:80])
                    continue
                
                # Split retrieved context into individual chunks and deduplicate
                chunks = context.split("\n---\n")
                new_chunks = 0
                for chunk in chunks:
                    chunk_stripped = chunk.strip()
                    if chunk_stripped and chunk_stripped not in seen_chunks:
                        all_chunks.append(chunk_stripped)
                        seen_chunks.add(chunk_stripped)
                        new_chunks += 1
                
                logger.debug(f"Agent 3: Subquery {i+1}/{len(active_subqueries)} retrieved {new_chunks} new chunks (total: {len(all_chunks)})")
                
            except Exception as e:
                logger.error(f"Agent 3: Failed to retrieve for subquery {i+1}", error=str(e))
                continue
        
        if not all_chunks:
            return {"markdown": f"# Error\n\nNo {doc_type} data found for summary generation.", "usage": {"input": 0, "output": 0}}
        
        logger.info(f"Agent 3 Phase 1 Complete: Collected {len(all_chunks)} unique chunks from {len(active_subqueries)} subqueries")
        
        # ── PHASE 2: Single LLM call with ALL collected context ──
        logger.info("Agent 3 Phase 2: Generating full summary from collected context...")
        
        # Pull high-fidelity tables from Mongo for sections III-XII
        job_id = metadata_filter.get("job_id") if metadata_filter else None
        mongo_tables = await self._retrieve_tables(job_id=job_id, namespace=namespace)
        
        table_context = ""
        if mongo_tables:
            table_context = f"\n\n--- HIGH-FIDELITY TABLES (PRIORITIZE THESE FOR ALL SECTIONS EXCEPT I & II) ---\n{mongo_tables}\n\n"

        # Combine all chunks into one context block
        full_context = table_context + "\n\n--- TEXT CHUNKS ---\n\n" + "\n\n---\n\n".join(all_chunks)
        
        # Build the subqueries reference for the user message
        subqueries_list = "\n".join([f"{i+1}. {sq}" for i, sq in enumerate(active_subqueries)])
        
        # Use the domain SOP as the system prompt
        system_prompt = custom_sop if custom_sop and custom_sop.strip() else MAIN_SUMMARY_SYSTEM_PROMPT
        
        try:
            response = await self.client.chat.completions.create(
                model="gpt-4.1-mini",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": (
                        f"Generate a complete, comprehensive {doc_type} summary for the company. "
                        f"The TOP HEADING of the summary MUST be '# {doc_type} Summary: [Company Name]'.\n\n"
                        f"AREAS TO COVER:\n{subqueries_list}\n\n"
                        f"{doc_type} CONTEXT DATA:\n{full_context}"
                    )}
                ],
                temperature=0.1,
                max_tokens=24576
            )
            
            usage = response.usage
            full_summary = response.choices[0].message.content
            
            logger.info("Agent 3: Completed Full Summary Generation", 
                        context_chunks=len(all_chunks),
                        input_tokens=usage.prompt_tokens,
                        output_tokens=usage.completion_tokens)
            
            return {
                "markdown": full_summary,
                "usage": {
                    "input": usage.prompt_tokens,
                    "output": usage.completion_tokens
                }
            }
            
        except Exception as e:
            logger.error("Agent 3: Summary generation failed", error=str(e), exc_info=True)
            return {
                "markdown": f"# Error\n\nSummary generation failed: {str(e)}",
                "usage": {"input": 0, "output": 0}
            }
    

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
        Orchestrates 4-agent pipeline with conditional merging.
        """
        start_time = time.time()
        logger.info("Starting 4-Agent Summary Pipeline", namespace=namespace, domain=domain_id)
        
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
        
        logger.info(
            "Feature toggles resolved",
            investor_match=investor_match_enabled,
            valuation=valuation_enabled,
            adverse=adverse_enabled,
            tenant_keys=list(tenant_config.keys()) if tenant_config else []
        )
        
        # Agent 3 (Business)
        a3_prompt = tenant_config.get("agent3_prompt") or BUSINESS_TABLE_EXTRACTOR_SYSTEM_PROMPT
        a3_subqueries = tenant_config.get("agent3_subqueries", []) or []

        # Agent 4 (Summary)
        a4_prompt = tenant_config.get("agent4_prompt") or MAIN_SUMMARY_SYSTEM_PROMPT
        a4_subqueries = tenant_config.get("agent4_subqueries", []) or []
        if a4_subqueries:
            a4_subqueries = [self._localize_prompt(sq, doc_type) for sq in a4_subqueries if isinstance(sq, str)]
        else:
            a4_subqueries = None

        # Localize prompts for RHP
        if doc_type == "RHP":
            a3_prompt = self._localize_prompt(a3_prompt, "RHP")
            a4_prompt = self._localize_prompt(a4_prompt, "RHP")

        try:
            # PHASE 1: Parallel Data Extraction
            logger.info("Phase 1: Parallel Extraction (A-1, A-2, A-3, A-4)")

            agent_1_task = self._agent_1_investor_extractor(namespace, index_name, host, metadata_filter)
            agent_2_task = self._agent_2_capital_history_extractor(namespace, index_name, host, metadata_filter)
            agent_3b_task = self._agent_3_business_table_extractor(namespace, a3_prompt, a3_subqueries, index_name, host, metadata_filter)
            agent_4_task = self._agent_3_summary_generator(namespace, doc_type, a4_prompt, a4_subqueries, index_name, host, metadata_filter)

            investor_json, capital_json, section3_content, draft_summary_result = await asyncio.gather(
                agent_1_task, agent_2_task, agent_3b_task, agent_4_task, return_exceptions=True
            )
            
            total_usage = {"input": 0, "output": 0}

            # Extract output and usage
            if isinstance(investor_json, dict):
                u = investor_json.get("_usage", {"input": 0, "output": 0})
                total_usage["input"] += u["input"]; total_usage["output"] += u["output"]
            else: investor_json = {"error": str(investor_json)}

            if isinstance(capital_json, dict):
                u = capital_json.get("_usage", {"input": 0, "output": 0})
                total_usage["input"] += u["input"]; total_usage["output"] += u["output"]
            else: capital_json = {"error": str(capital_json)}

            if isinstance(section3_content, Exception): section3_content = ""
            
            # =====================================================================
            # FIRST: Set draft_markdown from Agent 4 (Summary Generator) result
            # This MUST happen before any injection/modification!
            # =====================================================================
            if isinstance(draft_summary_result, dict):
                draft_markdown = draft_summary_result.get("markdown", "")
                u = draft_summary_result.get("usage", {"input": 0, "output": 0})
                total_usage["input"] += u["input"]; total_usage["output"] += u["output"]
            else: draft_markdown = f"# Error\n\nSummary generation failed: {str(draft_summary_result)}"

            # =====================================================================
            # PHASE 2: Assembly & Merging (on the fully populated draft_markdown)
            # =====================================================================
            logger.info("Phase 2: Final Assembly & Merging")
            
            # --- Step 1: Insert Section III (Our Business) between SECTION II and SECTION IV ---
            if section3_content and isinstance(section3_content, str) and section3_content.strip():
                logger.info(f"Inserting Section III content ({len(section3_content)} chars)")
                draft_markdown = self._insert_section3_into_summary(draft_markdown, section3_content)
            else:
                logger.warning("Section III content is empty, skipping insertion")

            # (Direct MongoDB table injection removed: Agent 3 & 4 now incorporate these via context)

            # --- Step 3: Convert and Merge Agent 1 & 2 data into SECTION VI ---
            investor_md = ""
            if isinstance(investor_json, dict) and not investor_json.get("error"):
                investor_md = self.md_converter.convert_investor_json_to_markdown(
                    investor_json, 
                    target_investors=tenant_config.get("target_investors"),
                    investor_match_only=investor_match_enabled,
                    doc_type=doc_type
                )
                logger.info(f"Agent 1: Investor markdown generated ({len(investor_md)} chars)")
            else:
                logger.warning(f"Agent 1: Investor data not available: {investor_json.get('error', 'unknown') if isinstance(investor_json, dict) else str(investor_json)}")
            
            capital_md = ""
            if isinstance(capital_json, dict) and not capital_json.get("error"):
                capital_md = self.md_converter.convert_capital_json_to_markdown(
                    capital_json, include_valuation_analysis=valuation_enabled
                )
                logger.info(f"Agent 2: Capital markdown generated ({len(capital_md)} chars)")
            else:
                logger.warning(f"Agent 2: Capital data not available: {capital_json.get('error', 'unknown') if isinstance(capital_json, dict) else str(capital_json)}")

            # Merge Agent 1 & 2: Insert between SECTION VI and SECTION VII
            combined_capital_investor = ""
            if investor_md:
                combined_capital_investor += investor_md + "\n\n"
            if capital_md:
                combined_capital_investor += capital_md

            if combined_capital_investor.strip():
                logger.info(f"Merging Agent 1 & 2 data ({len(combined_capital_investor)} chars) before SECTION VII")
                draft_markdown = self.md_converter.insert_markdown_before_section(
                    draft_markdown,
                    combined_capital_investor,
                    section_header="SECTION VII",
                    section_label="Matched Investors & Capital Structure Analysis"
                )
            else:
                logger.warning("Agent 1 & 2: No capital/investor data to merge")

            # --- Step 4: Handle Adverse Findings Research (A-5) ---

            research_markdown = ""
            if adverse_enabled:
                logger.info("Phase 3: Adverse Findings Research")
                company_name = investor_json.get("company_name") or namespace
                research_json = await research_service.research_company(company_name=company_name)
                research_markdown = self.md_converter.convert_research_json_to_markdown(research_json)
                u = research_json.get("_usage", {"input": 0, "output": 0})
                total_usage["input"] += u["input"]; total_usage["output"] += u["output"]

            if research_markdown:
                # Insert before XII = end of XI
                draft_markdown = self.md_converter.insert_markdown_before_section(
                    draft_markdown,
                    research_markdown,
                    section_header="SECTION XII",
                    section_label="ADVERSE FINDINGS & COMPLIANCE RESEARCH"
                )

            # Final Cleanup
            final_markdown = self._post_process_final_markdown(draft_markdown, doc_type)
            
            # Wrap with Timestamp
            dateTime = datetime.now().strftime("%d/%m/%Y, %I:%M:%S %p")
            header_metadata = f"---\nGenerated: {dateTime}\n---\n\n"
            final_markdown = header_metadata + final_markdown

            duration = time.time() - start_time
            logger.info("Pipeline Complete", duration=duration)
            
            return {
                "status": "success",
                "markdown": final_markdown,
                "html": final_markdown,
                "duration": duration,
                "usage": total_usage
            }
            
        except Exception as e:
            logger.error("Summary pipeline failed", error=str(e), exc_info=True)
            return {
                "status": "error",
                "message": f"Summary generation failed: {str(e)}",
                "duration": time.time() - start_time
            }


# Singleton instance
summary_pipeline = SummaryPipeline()
