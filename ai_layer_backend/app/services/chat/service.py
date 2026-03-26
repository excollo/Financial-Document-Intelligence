"""
Chat Service for real-time document interaction.
Handles RAG (Retrieval-Augmented Generation) based on document type (DRHP/RHP).
"""
import time
from typing import Dict, Any, List, Optional
import openai
from app.core.config import settings
from app.core.logging import get_logger
from app.services.vector_store import vector_store_service
from app.services.embedding import EmbeddingService
from app.services.rerank import rerank_service
from app.services.chat.prompts import CHAT_SYSTEM_PROMPT

logger = get_logger(__name__)

class ChatService:
    def __init__(self):
        self.embedding = EmbeddingService()
        self.client = openai.AsyncOpenAI(api_key=settings.OPENAI_API_KEY)

    async def _retrieve_context(
        self, 
        query: str, 
        namespace: str, 
        index_name: str, 
        host: str = "",
        top_k: int = 10,
        rerank_n: int = 5,
        metadata_filter: Optional[Dict[str, Any]] = None
    ) -> str:
        """
        Retrieves context with fallback logic.
        """
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

            # First try: Default namespace ("") with filters
            # This matches the single-index strategy where we rely on metadata for separation
            search_res = index.query(
                vector=query_vector,
                top_k=top_k,
                namespace="",
                include_metadata=True,
                filter=query_filter
            )
            initial_chunks = [m['metadata']['text'] for m in search_res['matches']]
            
            # Fallback 1: Specified namespace (legacy support)
            if not initial_chunks and namespace and namespace != "":
                # Remove "documentName" from filter for legacy namespace search
                # Legacy documents using namespace for isolation might NOT have documentName metadata
                legacy_filter = query_filter.copy() if query_filter else {}
                if "documentName" in legacy_filter:
                    del legacy_filter["documentName"]
                if not legacy_filter:
                    legacy_filter = None
                
                # logger.info(f"Chat retry in legacy namespace {namespace}")
                search_res = index.query(
                    vector=query_vector,
                    top_k=top_k,
                    namespace=namespace,
                    include_metadata=True,
                    filter=legacy_filter
                )
                initial_chunks = [m['metadata']['text'] for m in search_res['matches']]

            # Fallback 2: "" namespace WITHOUT filter
            # Skip if strict isolation is enforced via metadata_filter
            if not initial_chunks and not metadata_filter and namespace and namespace != "":
                logger.warning(f"Chat final fallback in \"\" for {namespace}")
                search_res = index.query(
                    vector=query_vector,
                    top_k=top_k,
                    namespace="",
                    include_metadata=True
                )
                initial_chunks = [m['metadata']['text'] for m in search_res['matches']]

            # 2. Rerank
            if initial_chunks:
                reranked_chunks = rerank_service.rerank(query, initial_chunks, top_n=rerank_n)
                return "\n---\n".join(reranked_chunks)
            
            return ""

        except Exception as e:
            logger.error(f"Chat retrieval failed", error=str(e))
            return ""

    async def chat(
        self, 
        message: str, 
        namespace: str, 
        document_type: str, # 'DRHP' or 'RHP'
        history: List[Dict[str, str]] = None,
        metadata_filter: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Main chat execution.
        """
        start_time = time.time()
        
        # Use consolidated index for both types
        index_name = settings.PINECONE_INDEX
        host = settings.PINECONE_INDEX_HOST

        logger.info("Chat query received", message=message, doc_type=document_type, namespace=namespace)

        # 1. Retrieve Context
        context = await self._retrieve_context(
            message, 
            namespace, 
            index_name, 
            host=host, 
            metadata_filter=metadata_filter
        )
        
        # 2. Prepare Messages
        messages = [{"role": "system", "content": CHAT_SYSTEM_PROMPT}]
        
        # Add History (Optional)
        if history:
            messages.extend(history[-5:]) # Last 5 turns
            
        # Add Context + Current Message
        user_content = f"CONTEXT FROM DOCUMENT:\n{context}\n\nUSER QUESTION: {message}"
        if not context:
            user_content = f"USER QUESTION: {message}\n(Note: No highly relevant sections were found in the document for this specific question.)"

        messages.append({"role": "user", "content": user_content})

        # 3. Request LLM
        try:
            response = await self.client.chat.completions.create(
                model=settings.SUMMARY_MODEL, # or hardcode "gpt-4o-mini"
                messages=messages,
                temperature=0.7,
                stream=False
            )
            
            answer = response.choices[0].message.content
            duration = time.time() - start_time
            
            return {
                "status": "success",
                "output": answer,
                "usage": {
                    "prompt_tokens": response.usage.prompt_tokens,
                    "completion_tokens": response.usage.completion_tokens,
                    "total_tokens": response.usage.total_tokens
                },
                "duration": duration
            }

        except Exception as e:
            logger.error("Chat LLM failed", error=str(e), exc_info=True)
            return {
                "status": "error",
                "message": f"Chat failed: {str(e)}"
            }

chat_service = ChatService()
