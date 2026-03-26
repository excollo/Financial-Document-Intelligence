"""
Rerank service using Cohere API.
Matches n8n "Reranker Cohere" behavior.
"""
from typing import List, Dict, Any
import cohere
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

class RerankService:
    def __init__(self):
        self.client = None
        if settings.COHERE_API_KEY:
            self.client = cohere.Client(settings.COHERE_API_KEY)
        else:
            logger.warning("COHERE_API_KEY not set. Reranking will be skipped.")

    def rerank(self, query: str, documents: List[str], top_n: int = 15) -> List[str]:
        """
        Rerank documents based on query using Cohere.
        """
        if not self.client or not documents:
            return documents[:top_n]

        try:
            # Cohere expects limited number of docs per call, but top_k from vector search is usually fine (~50-100)
            response = self.client.rerank(
                query=query,
                documents=documents,
                top_n=top_n,
                model="rerank-v4.0-fast"  # Latest recommended model
            )
            
            reranked_docs = []
            for result in response.results:
                reranked_docs.append(documents[result.index])
            
            logger.info("Cohere rerank successful", query=query, original_count=len(documents), returned_count=len(reranked_docs))
            return reranked_docs
        except Exception as e:
            logger.error("Cohere rerank failed", error=str(e))
            return documents[:top_n]

rerank_service = RerankService()
