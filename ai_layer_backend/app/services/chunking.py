"""
Text chunking service.
Splits large documents into manageable chunks for processing.
"""
from typing import List, Dict, Any
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


from langchain_text_splitters import RecursiveCharacterTextSplitter
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class ChunkingService:
    """Service for chunking large text documents using LangChain."""
    
    def __init__(self, chunk_size: int = None, chunk_overlap: int = None):
        """
        Initialize chunking service.
        """
        self.chunk_size = chunk_size or settings.MAX_CHUNK_SIZE
        self.chunk_overlap = chunk_overlap or settings.CHUNK_OVERLAP
        self.splitter = RecursiveCharacterTextSplitter(
            chunk_size=self.chunk_size,
            chunk_overlap=self.chunk_overlap,
            length_function=len,
            is_separator_regex=False,
        )
    
    def split_text(self, text: str) -> List[str]:
        """
        Split text into chunks using recursive character splitting.
        """
        if not text:
            return []
            
        chunks = self.splitter.split_text(text)
        
        logger.info(
            "Text split into chunks",
            total_chars=len(text),
            chunk_count=len(chunks),
            chunk_size=self.chunk_size,
            overlap=self.chunk_overlap
        )
        
        return chunks
    
    def chunk_with_metadata(
        self,
        text: str,
        metadata: Dict[str, Any] = None
    ) -> List[Dict[str, Any]]:
        """
        Chunk text and attach metadata to each chunk.
        """
        chunks = self.split_text(text)
        
        results = []
        for idx, chunk in enumerate(chunks):
            chunk_data = {
                "chunk_index": idx,
                "chunk_text": chunk,
                "chunk_size": len(chunk),
                "metadata": metadata or {}
            }
            results.append(chunk_data)
        
        logger.info(
            "Created chunks with metadata",
            chunk_count=len(results)
        )
        
        return results


# Global service instance
chunking_service = ChunkingService()
