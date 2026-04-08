"""
Embedding service.
Generates vector embeddings for text chunks.
"""
from typing import List, Dict, Any
import numpy as np
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


from langchain_openai import OpenAIEmbeddings
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class EmbeddingService:
    """Service for generating text embeddings using OpenAI."""
    
    def __init__(self, model: str = None):
        """
        Initialize embedding service.
        """
        self.model_name = model or settings.EMBEDDING_MODEL
        self.embeddings = OpenAIEmbeddings(
            model=self.model_name,
            openai_api_key=settings.OPENAI_API_KEY
        )
    
    def generate_embeddings_batch(self, texts: List[str]) -> List[List[float]]:
        """
        Generate embeddings for multiple texts in batch.
        """
        try:
            logger.info("Generating batch embeddings", batch_size=len(texts), model=self.model_name)
            vectors = self.embeddings.embed_documents(texts)
            logger.info("Batch embeddings generated", count=len(vectors))
            return vectors
        except Exception as e:
            logger.error("Batch embedding generation failed", error=str(e), exc_info=True)
            raise
    
    async def embed_chunks(self, chunks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Generate embeddings for text chunks.
        Runs the blocking OpenAI call in a thread pool executor to avoid
        blocking the event loop (was the #2 latency bottleneck).
        """
        import asyncio
        import time
        texts = [chunk["chunk_text"] for chunk in chunks]
        
        t0 = time.time()
        loop = asyncio.get_event_loop()
        # Run synchronous embedding in thread pool so event loop stays free
        embeddings = await loop.run_in_executor(
            None,  # default ThreadPoolExecutor
            self.generate_embeddings_batch,
            texts
        )
        elapsed = time.time() - t0
        logger.info(
            "Chunks embedded",
            chunk_count=len(chunks),
            embedding_seconds=round(elapsed, 2),
            tokens_approx=sum(len(t.split()) for t in texts)
        )
        
        for chunk, embedding in zip(chunks, embeddings):
            chunk["embedding"] = embedding
        
        return chunks


    async def embed_text(self, text: str) -> List[float]:
        """
        Generate embedding for a single text.
        """
        try:
            return self.embeddings.embed_query(text)
        except Exception as e:
            logger.error("Text embedding failed", error=str(e))
            raise


# Global service instance
embedding_service = EmbeddingService()
