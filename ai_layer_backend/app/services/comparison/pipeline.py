"""
DRHP vs RHP Comparison Pipeline.
Orchestrates context retrieval from two separate indexes and generates comparison report.
"""
import asyncio
import time
from typing import Dict, Any, List, Optional
from app.core.config import settings
from app.core.logging import get_logger
from app.services.vector_store import vector_store_service
from app.services.embedding import EmbeddingService
from app.services.rerank import rerank_service
from app.services.comparison.prompts import COMPARISON_SYSTEM_PROMPT, COMPARISON_QUERIES
from app.services.comparison.formatter import comparison_formatter
import openai

logger = get_logger(__name__)

class ComparisonPipeline:
    def __init__(self):
        self.embedding = EmbeddingService()
        self.client = openai.AsyncOpenAI(api_key=settings.OPENAI_API_KEY)

    async def _retrieve_context_from_index(
        self, 
        queries: List[str], 
        namespace: str, 
        index_name: str, 
        host: str = "",
        vector_top_k: int = 50,
        rerank_top_n: int = 10,
        metadata_filter: Optional[Dict[str, Any]] = None
    ) -> str:
        """
        Retrieves context from a specific Pinecone index.
        Matches the robust fallback logic in SummaryPipeline.
        """
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

                logger.debug(f"Querying index {index_name}", namespace=namespace or "", filter=query_filter)

                # First try: Query the default namespace ("") with filters
                # This matches the single-index strategy where we rely on metadata for separation
                safe_namespace = ""
                
                logger.debug(f"Querying index {index_name}", namespace=safe_namespace, filter=query_filter)
                
                search_res = index.query(
                    vector=query_vector,
                    top_k=vector_top_k,
                    namespace=safe_namespace,
                    include_metadata=True,
                    filter=query_filter
                )
                initial_chunks = [m['metadata']['text'] for m in search_res['matches']]
                
                # Fallback: Query specific namespace (legacy support or if still used)
                if not initial_chunks and namespace and namespace != "":
                    # Remove "documentName" from filter for legacy namespace search
                    # Legacy documents using namespace for isolation might NOT have documentName metadata
                    legacy_filter = query_filter.copy() if query_filter else {}
                    if "documentName" in legacy_filter:
                        del legacy_filter["documentName"]
                    if not legacy_filter:
                        legacy_filter = None
                        
                    logger.warning(f"Fallback: Search in legacy namespace {namespace}")
                    search_res = index.query(
                        vector=query_vector,
                        top_k=vector_top_k,
                        namespace=namespace,
                        include_metadata=True,
                        filter=legacy_filter
                    )
                    initial_chunks = [m['metadata']['text'] for m in search_res['matches']]

                # 2. Rerank
                if initial_chunks:
                    try:
                        reranked_chunks = rerank_service.rerank(query, initial_chunks, top_n=rerank_top_n)
                        all_context.extend(reranked_chunks)
                    except Exception as re:
                        logger.error("Rerank failed, using initial chunks", error=str(re))
                        all_context.extend(initial_chunks[:rerank_top_n])
            except Exception as e:
                logger.error(f"Context retrieval failed for index {index_name}", query=query, error=str(e))
                continue
            
        # Deduplicate
        unique_context = []
        seen = set()
        for chunk in all_context:
            if chunk not in seen:
                unique_context.append(chunk)
                seen.add(chunk)
                
        return "\n---\n".join(unique_context)

    async def compare(
        self, 
        drhp_namespace: str, 
        rhp_namespace: str,
        drhp_index: str = None,
        rhp_index: str = None,
        drhp_host: str = None,
        rhp_host: str = None,
        drhp_filter: Optional[Dict[str, Any]] = None,
        rhp_filter: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Main comparison method.
        """
        drhp_index = drhp_index or settings.PINECONE_INDEX
        rhp_index = rhp_index or settings.PINECONE_INDEX # Same index
        drhp_host = drhp_host or settings.PINECONE_INDEX_HOST
        rhp_host = rhp_host or settings.PINECONE_INDEX_HOST # Same host
        start_time = time.time()
        logger.info("Starting DRHP vs RHP Comparison Pipeline", 
                    drhp=drhp_namespace, rhp=rhp_namespace)
        
        # Parallel retrieval from both indexes
        drhp_task = self._retrieve_context_from_index(
            COMPARISON_QUERIES, drhp_namespace, drhp_index, drhp_host, metadata_filter=drhp_filter
        )
        rhp_task = self._retrieve_context_from_index(
            COMPARISON_QUERIES, rhp_namespace, rhp_index, rhp_host, metadata_filter=rhp_filter
        )
        
        drhp_context, rhp_context = await asyncio.gather(drhp_task, rhp_task)
        
        if not drhp_context and not rhp_context:
            return {
                "status": "error",
                "message": "No context found for either document."
            }

        # Combine contexts with clear separation
        full_context = f"=== DRHP CONTEXT (FOR {drhp_namespace}) ===\n{drhp_context}\n\n"
        full_context += f"=== RHP CONTEXT (FOR {rhp_namespace}) ===\n{rhp_context}"

        logger.info("Context retrieval finished", 
                    drhp_len=len(drhp_context), 
                    rhp_len=len(rhp_context))

        try:
            response = await self.client.chat.completions.create(
                model=settings.SUMMARY_MODEL,
                messages=[
                    {"role": "system", "content": COMPARISON_SYSTEM_PROMPT},
                    {"role": "user", "content": f"Compare these contexts and highlight material changes:\n\n{full_context}"}
                ],
                temperature=0.1,
                max_tokens=16384
            )
            
            comparison_md = response.choices[0].message.content
            html_report = comparison_formatter.markdown_to_html(comparison_md)
            
            duration = time.time() - start_time
            return {
                "status": "success",
                "markdown": comparison_md,
                "html": html_report,
                "duration": duration,
                "usage": {
                    "prompt_tokens": response.usage.prompt_tokens,
                    "completion_tokens": response.usage.completion_tokens,
                    "total_tokens": response.usage.total_tokens
                }
            }

        except Exception as e:
            logger.error("LLM comparison failed", error=str(e), exc_info=True)
            return {
                "status": "error",
                "message": f"Comparison failed: {str(e)}"
            }

comparison_pipeline = ComparisonPipeline()
